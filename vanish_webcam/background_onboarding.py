"""Guided background capture shown every time the Mac app starts.

Three steps: frame the camera, leave the frame (countdown with sounds, since
the person cannot see the screen), review the captured background. OpenCV text
has no accents, so the Spanish labels are written without them.
"""

from __future__ import annotations

import subprocess
import sys
import time
from typing import Callable

import cv2
import numpy as np

ONBOARDING_NAME = "VanishCam - Fondo"
WIDTH, HEIGHT = 760, 600
PREVIEW = (60, 110, 700, 470)  # 640x360

BG = (26, 29, 34)
BUTTON = (48, 54, 62)
BORDER = (111, 142, 153)
TEXT = (235, 235, 235)
MUTED = (160, 165, 170)
GREEN = (80, 170, 60)
AMBER = (40, 170, 230)
RED = (50, 50, 210)

LEAVE_SECONDS = 3       # countdown to walk out of the frame
CAPTURE_SECONDS = 2.0   # frames averaged into the background
PERSON_LIMIT = 0.03     # share of the image that may still look like a person

SOUNDS = {
    "tick": "/System/Library/Sounds/Tink.aiff",
    "start": "/System/Library/Sounds/Pop.aiff",
    "done": "/System/Library/Sounds/Glass.aiff",
    "warn": "/System/Library/Sounds/Basso.aiff",
}


def play(name: str) -> None:
    if sys.platform != "darwin":
        return
    try:
        subprocess.Popen(["afplay", SOUNDS[name]], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    except OSError:
        pass


def _text(img, text, org, scale=0.5, color=TEXT, thickness=1):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def _centered(img, text, box, scale, color=TEXT, thickness=1):
    x1, y1, x2, y2 = box
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    _text(img, text, (x1 + (x2 - x1 - w) // 2, y1 + (y2 - y1 + h) // 2), scale, color, thickness)


def _button(img, box, label, fill=BUTTON, bold=False):
    cv2.rectangle(img, box[:2], box[2:], fill, -1)
    cv2.rectangle(img, box[:2], box[2:], BORDER, 1)
    _centered(img, label, box, 0.55, TEXT, 2 if bold else 1)


def _inside(box, x, y):
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def _header(img, step: int, title: str, subtitle: str) -> None:
    _text(img, f"PASO {step} DE 3", (60, 40), 0.5, MUTED)
    _text(img, title, (60, 74), 0.85, TEXT, 2)
    _text(img, subtitle, (60, 98), 0.45, MUTED)
    for i in range(3):
        color = GREEN if i < step else (60, 64, 70)
        cv2.rectangle(img, (520 + i * 62, 30), (575 + i * 62, 36), color, -1)


def _preview(img, frame) -> None:
    x1, y1, x2, y2 = PREVIEW
    if frame is None:
        cv2.rectangle(img, (x1, y1), (x2, y2), (38, 41, 46), -1)
        _centered(img, "Esperando la camara...", PREVIEW, 0.6, MUTED)
    else:
        img[y1:y2, x1:x2] = cv2.resize(frame, (x2 - x1, y2 - y1))
    cv2.rectangle(img, (x1, y1), (x2, y2), BORDER, 1)


def _banner(img, text: str, color, sub: str = "") -> None:
    """Big translucent label over the preview, readable from across the room."""
    x1, y1, x2, y2 = PREVIEW
    overlay = img.copy()
    cv2.rectangle(overlay, (x1, y1 + 110), (x2, y2 - 110), color, -1)
    cv2.addWeighted(overlay, 0.82, img, 0.18, 0, img)
    _centered(img, text, (x1, y1 + 110, x2, y2 - 140 if sub else y2 - 110), 1.6, (255, 255, 255), 4)
    if sub:
        _centered(img, sub, (x1, y2 - 150, x2, y2 - 115), 0.7, (255, 255, 255), 2)


def capture_background(capture: cv2.VideoCapture, mirror: bool,
                       person_fraction: Callable[[np.ndarray], float] | None = None,
                       ) -> np.ndarray | None:
    """Run the guided capture. Returns the background, or None if the user quits."""
    clicks: list[tuple[int, int]] = []
    cv2.namedWindow(ONBOARDING_NAME, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(ONBOARDING_NAME, lambda e, x, y, f, p: clicks.append((x, y))
                         if e == cv2.EVENT_LBUTTONUP else None)

    left_box, right_box = (60, 500, 330, 555), (370, 500, 700, 555)
    step = "frame"          # frame -> leave -> capturing -> review
    step_started = time.monotonic()
    last_tick = None
    samples: list[np.ndarray] = []
    background = None
    person_share = 0.0
    frame = None

    try:
        while True:
            ok, raw = capture.read()
            if ok:
                frame = cv2.flip(raw, 1) if mirror else raw
            now = time.monotonic()
            img = np.full((HEIGHT, WIDTH, 3), BG, np.uint8)
            left = right = None

            if step == "frame":
                _header(img, 1, "Encuadra la camara",
                        "Ponla donde la usaras en la reunion. Despues no la muevas.")
                _preview(img, frame)
                left, right = ("SALIR", (40, 40, 110)), ("SIGUIENTE", GREEN)

            elif step == "ready":
                _header(img, 2, "Sal del encuadre",
                        f"Al pulsar CAPTURAR tienes {LEAVE_SECONDS} s para salir. Suena al terminar.")
                _preview(img, frame)
                left, right = ("ATRAS", BUTTON), ("CAPTURAR FONDO", GREEN)

            elif step == "leave":
                _header(img, 2, "Sal del encuadre", "Escucha los pitidos: sal antes del ultimo.")
                _preview(img, frame)
                remaining = LEAVE_SECONDS - int(now - step_started)
                if remaining != last_tick and remaining > 0:
                    play("tick")
                    last_tick = remaining
                if remaining <= 0:
                    step, step_started, samples = "capturing", now, []
                    play("start")
                else:
                    _banner(img, str(remaining), AMBER, "SAL DEL ENCUADRE")
                left = ("CANCELAR", BUTTON)

            if step == "capturing":
                _header(img, 2, "Capturando el fondo", "No entres en la imagen todavia.")
                _preview(img, frame)
                if ok:
                    samples.append(frame.copy())
                progress = min(1.0, (now - step_started) / CAPTURE_SECONDS)
                _banner(img, "CAPTURANDO", RED, "no entres todavia")
                x1, _, x2, y2 = PREVIEW
                cv2.rectangle(img, (x1, y2 + 8), (x1 + int((x2 - x1) * progress), y2 + 16), RED, -1)
                left = ("CANCELAR", BUTTON)
                if progress >= 1.0 and samples:
                    stack = np.stack(samples[::max(1, len(samples) // 24)][-24:], axis=0)
                    background = np.median(stack, axis=0).astype(np.uint8)
                    person_share = person_fraction(background) if person_fraction else 0.0
                    step = "review"
                    play("warn" if person_share > PERSON_LIMIT else "done")

            elif step == "review":
                _header(img, 3, "Revisa el fondo",
                        "Esto es lo que vera la reunion cuando desaparezcas.")
                _preview(img, background)
                x1, y1, x2, _ = PREVIEW
                if person_share > PERSON_LIMIT:
                    cv2.rectangle(img, (x1, y1), (x2, y1 + 40), RED, -1)
                    _centered(img, "Parece que todavia apareces en la imagen. Repite la captura.",
                              (x1, y1, x2, y1 + 40), 0.55, (255, 255, 255), 1)
                else:
                    cv2.rectangle(img, (x1, y1), (x2, y1 + 40), GREEN, -1)
                    _centered(img, "Fondo limpio. Ya puedes volver a tu lugar.",
                              (x1, y1, x2, y1 + 40), 0.55, (255, 255, 255), 1)
                left, right = ("REPETIR", BUTTON), ("LISTO, EMPEZAR", GREEN)

            if left:
                _button(img, left_box, left[0], left[1])
            if right:
                _button(img, right_box, right[0], right[1], bold=True)
            _text(img, "Enter: continuar   Esc: atras", (60, 585), 0.4, MUTED)

            cv2.imshow(ONBOARDING_NAME, img)
            key = cv2.waitKey(15) & 0xFF
            if cv2.getWindowProperty(ONBOARDING_NAME, cv2.WND_PROP_VISIBLE) < 1:
                return None

            pressed = []
            for x, y in clicks:
                if left and _inside(left_box, x, y):
                    pressed.append("left")
                elif right and _inside(right_box, x, y):
                    pressed.append("right")
            clicks.clear()
            if key in (13, 10) and right:
                pressed.append("right")
            elif key == 27 and left:
                pressed.append("left")

            for button in pressed:
                if step == "frame":
                    if button == "left":
                        return None
                    step = "ready"
                elif step == "ready":
                    if button == "left":
                        step = "frame"
                    else:
                        step, step_started, last_tick = "leave", time.monotonic(), None
                elif step in ("leave", "capturing"):
                    step = "ready"
                elif step == "review":
                    if button == "right":
                        return background
                    step = "ready"
                break
    finally:
        cv2.destroyWindow(ONBOARDING_NAME)
        cv2.waitKey(1)
