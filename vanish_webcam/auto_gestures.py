"""Automatic mode: watch every gesture at once and pick the matching effect.

One hand landmarker and one face detector feed all the checks:
- Goku: index and middle fingers together on the forehead (held, see GokuGestureGate).
- Naruto: palms joined at face height.
- Itachi: hands touching at chest height.
- V sign: index and middle spread, ignored near the forehead so Goku never fires it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Callable

import numpy as np

try:
    from .goku_effect import fingers_on_forehead
    from .itachi_effect import hands_touch_at_chest
    from .naruto_effect import joined_hands_from_landmarks
except ImportError:
    from goku_effect import fingers_on_forehead
    from itachi_effect import hands_touch_at_chest
    from naruto_effect import joined_hands_from_landmarks

VICTORY_MIN_SCORE = 0.62
STREAK_TO_FIRE = 2          # consecutive checks (~0.2 s) for Naruto, Itachi and V
RELEASE_SECONDS = 0.35      # all gestures off this long before the next trigger


@dataclass
class AutoReading:
    goku: bool = False
    naruto: bool = False
    itachi: bool = False
    touching: bool = False      # hands touching at chest, any height split (Itachi return)
    victory: float = 0.0
    hands: int = 0
    faces: int = 0

    @property
    def any(self) -> bool:
        return (self.goku or self.naruto or self.itachi or self.touching
                or self.victory >= VICTORY_MIN_SCORE)


def _palm_center(hands, width: int, height: int) -> np.ndarray | None:
    centers = []
    for hand in hands[:2]:
        if len(hand) != 21:
            return None
        pts = np.asarray([(hand[i].x * width, hand[i].y * height) for i in (0, 5, 9, 13, 17)])
        centers.append(pts.mean(axis=0))
    return np.mean(centers, axis=0) if centers else None


def _near_forehead(hands, faces, width: int, height: int) -> bool:
    """An index fingertip above the chin and over the face: Goku territory."""
    for hand in hands:
        if len(hand) != 21:
            continue
        tip_x, tip_y = hand[8].x * width, hand[8].y * height
        for x, y, w, h in faces:
            if x - w * 0.5 <= tip_x <= x + w * 1.5 and tip_y <= y + h:
                return True
    return False


def classify_auto(hands, world_hands, faces, mask, width: int, height: int,
                  victory_score: Callable[[object], float]) -> AutoReading:
    """Decide which gestures are visible in one frame. Pure, so it is testable."""
    reading = AutoReading(hands=len(hands), faces=len(faces))
    reading.goku = bool(faces) and fingers_on_forehead(hands, faces, width, height)

    joined = joined_hands_from_landmarks(hands, width, height)
    touching = mask is not None and hands_touch_at_chest(hands, mask)
    reading.touching = touching
    if joined or touching:
        center = _palm_center(hands, width, height)
        if faces and center is not None:
            chin = max(y + h for _, y, _, h in faces)
            at_face = center[1] < chin
            reading.naruto = joined and at_face
            reading.itachi = touching and not at_face
        else:
            reading.itachi = touching
            reading.naruto = joined and not touching

    two_hands_together = joined or touching
    if not reading.goku and not two_hands_together and not _near_forehead(hands, faces, width, height):
        reading.victory = victory_score(SimpleNamespace(
            hand_landmarks=hands, hand_world_landmarks=world_hands, gestures=[]))
    return reading


class AutoGestureRecognizer:
    def __init__(self, hand_detector, face_detector, victory_score: Callable[[object, object], float]):
        self.hand_detector = hand_detector
        self.face_detector = face_detector
        self.victory_score = victory_score
        self.last_hand_count = 0
        self.last_face_count = 0
        self._faces: list[tuple[float, float, float, float]] = []
        self._face_seen_ms = -1000

    def read(self, image, timestamp_ms: int, mask) -> AutoReading:
        detected = self.face_detector.detect_for_video(image, timestamp_ms).detections
        if detected:
            self._faces = [(d.bounding_box.origin_x, d.bounding_box.origin_y,
                            d.bounding_box.width, d.bounding_box.height) for d in detected]
            self._face_seen_ms = timestamp_ms
        elif timestamp_ms - self._face_seen_ms > 250:
            self._faces = []
        result = self.hand_detector.detect_for_video(image, timestamp_ms)
        reading = classify_auto(
            result.hand_landmarks, result.hand_world_landmarks, self._faces, mask,
            image.width, image.height, lambda res: self.victory_score(res, image),
        )
        self.last_hand_count, self.last_face_count = reading.hands, reading.faces
        return reading

    def close(self) -> None:
        self.hand_detector.close()
        self.face_detector.close()


@dataclass
class AutoGate:
    """Turn readings into one effect, with a release between triggers."""

    v_effect: str = "normal"
    armed: bool = True
    clear_since: float | None = None
    streaks: dict = field(default_factory=dict)

    def disarm(self) -> None:
        self.armed = False
        self.clear_since = None
        self.streaks.clear()

    def update(self, reading: AutoReading, now: float, goku_gate) -> str | None:
        if not self.armed:
            if reading.any:
                self.clear_since = None
                goku_gate.update(False, now)
                return None
            if self.clear_since is None:
                self.clear_since = now
            if now - self.clear_since < RELEASE_SECONDS:
                goku_gate.update(False, now)
                return None
            self.armed = True

        if goku_gate.update(reading.goku, now):
            self.disarm()
            return "goku"
        for name, active in (("itachi", reading.itachi), ("naruto", reading.naruto),
                             (self.v_effect, reading.victory >= VICTORY_MIN_SCORE)):
            self.streaks[name] = self.streaks.get(name, 0) + 1 if active else 0
        if goku_gate.hold_started is not None:
            return None  # A Goku hold is in progress: do not let anything else fire.
        for name in ("itachi", "naruto", self.v_effect):
            if self.streaks.get(name, 0) >= STREAK_TO_FIRE:
                self.disarm()
                return name
        return None
