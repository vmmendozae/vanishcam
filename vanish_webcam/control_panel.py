"""Separate control window: effect selector, action buttons and status.

It is its own OpenCV window, so nothing drawn here reaches the virtual camera.
OpenCV text has no accents, so the Spanish labels are written without them.
"""

from __future__ import annotations

import cv2
import numpy as np

PANEL_NAME = "VanishCam - Controles"

PANEL_MODES = ("auto", "goku", "naruto", "normal", "particles", "itachi")
MODE_LABELS = {
    "auto": "AUTO",
    "goku": "GOKU",
    "naruto": "NARUTO",
    "normal": "NORMAL",
    "particles": "PARTICULAS",
    "itachi": "ITACHI",
}
MODE_HINTS = {
    "auto": "Cualquier gesto: Goku, Naruto, Itachi o V",
    "goku": "Dos dedos juntos en la frente {delay:g} s",
    "naruto": "Junta las palmas frente a la camara",
    "normal": "Haz la V con indice y medio",
    "particles": "Haz la V con indice y medio",
    "itachi": "Junta las manos frente al pecho",
}

WIDTH, HEIGHT = 580, 470
MARGIN = 15

BG = (26, 29, 34)
BUTTON = (48, 54, 62)
BORDER = (111, 142, 153)
TEXT = (235, 235, 235)
MUTED = (160, 165, 170)
SELECTED = (60, 150, 230)    # orange (BGR)
RED = (50, 50, 210)
GREEN = (80, 170, 60)
BLUE = (200, 120, 40)
AMBER = (40, 170, 230)

ACTIONS = (
    ("vanish", "DESAPARECER (V)"),
    ("appear", "REAPARECER (R)"),
    ("background", "NUEVO FONDO (ESPACIO)"),
    ("quit", "SALIR (Q)"),
)

KEY_ACTIONS = {
    ord("q"): "quit", 27: "quit",
    ord(" "): "background",
    ord("r"): "appear",
    ord("v"): "vanish",
    ord("f"): "fullscreen",
}


def _text(img, text, org, scale=0.5, color=TEXT, thickness=1):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def _centered(img, text, box, scale, color=TEXT, thickness=1):
    x1, y1, x2, y2 = box
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    _text(img, text, (x1 + (x2 - x1 - w) // 2, y1 + (y2 - y1 + h) // 2), scale, color, thickness)


class ControlPanel:
    def __init__(self, modes: tuple[str, ...]):
        self.modes = tuple(m for m in PANEL_MODES if m in modes)
        self.clicks: list = []
        self.mode_boxes: dict[str, tuple[int, int, int, int]] = {}
        self.action_boxes: dict[str, tuple[int, int, int, int]] = {}
        self._layout()
        cv2.namedWindow(PANEL_NAME, cv2.WINDOW_AUTOSIZE)
        cv2.setMouseCallback(PANEL_NAME, self._on_mouse)
        try:
            cv2.setWindowProperty(PANEL_NAME, cv2.WND_PROP_TOPMOST, 1)
        except cv2.error:
            pass

    def _layout(self) -> None:
        gap = 6
        count = max(1, len(self.modes))
        width = (WIDTH - 2 * MARGIN - gap * (count - 1)) // count
        for i, mode in enumerate(self.modes):
            x = MARGIN + i * (width + gap)
            self.mode_boxes[mode] = (x, 222, x + width, 266)
        width = (WIDTH - 2 * MARGIN - 10) // 2
        for i, (action, _) in enumerate(ACTIONS):
            x = MARGIN + (i % 2) * (width + 10)
            y = 316 + (i // 2) * 54
            self.action_boxes[action] = (x, y, x + width, y + 44)

    def _on_mouse(self, event, x, y, _flags, _param) -> None:
        if event != cv2.EVENT_LBUTTONUP:
            return
        for mode, (x1, y1, x2, y2) in self.mode_boxes.items():
            if x1 <= x <= x2 and y1 <= y <= y2:
                self.clicks.append(("mode", mode))
                return
        for action, (x1, y1, x2, y2) in self.action_boxes.items():
            if x1 <= x <= x2 and y1 <= y <= y2:
                self.clicks.append(action)
                return

    def actions(self, key: int) -> list:
        """Clicks since the last call plus the action for the pressed key."""
        found, self.clicks = self.clicks, []
        if key in KEY_ACTIONS:
            found.append(KEY_ACTIONS[key])
        elif ord("1") <= key < ord("1") + len(self.modes):
            found.append(("mode", self.modes[key - ord("1")]))
        return found

    def draw(self, mode: str, title: str, detail: str, color, virtual_ok: bool | None,
             loading: bool = False, **_extra) -> None:
        img = np.full((HEIGHT, WIDTH, 3), BG, dtype=np.uint8)
        _text(img, "VANISHCAM", (MARGIN, 36), 0.85, TEXT, 2)
        _text(img, "Esta ventana NO sale en Meet", (WIDTH - MARGIN - 205, 34), 0.42, MUTED)

        cv2.rectangle(img, (MARGIN, 52), (WIDTH - MARGIN, 150), color, -1)
        _centered(img, title, (MARGIN, 58, WIDTH - MARGIN, 104), 0.85, (255, 255, 255), 2)
        _centered(img, detail, (MARGIN, 104, WIDTH - MARGIN, 140), 0.5, (255, 255, 255))

        if virtual_ok is None:
            line, line_color = "Salida a Meet: conectando...", MUTED
        elif virtual_ok:
            line, line_color = "Salida a Meet: OBS Virtual Camera activa", (90, 200, 90)
        else:
            line, line_color = "Salida a Meet: NO (solo vista previa)", (90, 90, 230)
        _text(img, line, (MARGIN, 178), 0.5, line_color)

        _text(img, "EFECTO  (teclas 1-%d)" % len(self.modes), (MARGIN, 210), 0.45, MUTED)
        for i, (m, box) in enumerate(self.mode_boxes.items()):
            selected = m == mode
            cv2.rectangle(img, box[:2], box[2:], SELECTED if selected else BUTTON, -1)
            cv2.rectangle(img, box[:2], box[2:], (255, 255, 255) if selected else BORDER, 1)
            _centered(img, MODE_LABELS[m], box, 0.4, TEXT, 2 if selected else 1)

        _text(img, "ACCIONES", (MARGIN, 304), 0.45, MUTED)
        for action, label in ACTIONS:
            box = self.action_boxes[action]
            fill = (40, 40, 110) if action == "quit" else BUTTON
            if loading and action != "quit":
                fill = (38, 41, 46)
            cv2.rectangle(img, box[:2], box[2:], fill, -1)
            cv2.rectangle(img, box[:2], box[2:], BORDER, 1)
            _centered(img, label, box, 0.45)

        _text(img, "F: pantalla completa en la vista previa", (MARGIN, HEIGHT - 16), 0.42, MUTED)
        cv2.imshow(PANEL_NAME, img)


def status_for(phase: str, mode: str, calibration_left: int | None, goku_delay: float,
               countdown: float | None) -> tuple[str, str, tuple[int, int, int]]:
    """Map the app phase to the big status box of the panel."""
    if phase == "calibrating":
        left = "" if calibration_left is None else f"  {calibration_left} s"
        return f"CAPTURANDO FONDO{left}", "Sal del encuadre y no te muevas", RED
    if phase == "ready":
        if countdown is not None:
            return f"TELETRANSPORTE EN {countdown:g}...", "Manten el gesto", AMBER
        return "LISTO", MODE_HINTS[mode].format(delay=goku_delay), GREEN
    if phase == "vanished":
        hint = "Repite el gesto o pulsa REAPARECER" if mode in ("goku", "itachi") \
            else "Pulsa REAPARECER para volver"
        return "DESAPARECIDO", hint, BLUE
    return "EFECTO EN CURSO", "", AMBER
