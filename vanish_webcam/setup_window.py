"""Start-up window for the Mac app: camera, effect, Goku hold time, OBS check.

Drawn with OpenCV like the rest of the app (no Tk needed). OpenCV text has no
accents, so the Spanish labels are written without them.
"""

from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

try:
    from .control_panel import MODE_LABELS, PANEL_MODES
except ImportError:
    from control_panel import MODE_LABELS, PANEL_MODES

SETUP_NAME = "VanishCam - Configuracion"
WIDTH, HEIGHT = 760, 640
PREVIEW = (40, 70, 440, 295)  # x1, y1, x2, y2 (16:9)

BG = (26, 29, 34)
BUTTON = (48, 54, 62)
BORDER = (111, 142, 153)
TEXT = (235, 235, 235)
MUTED = (160, 165, 170)
SELECTED = (60, 150, 230)
GREEN = (80, 170, 60)
AMBER = (40, 170, 230)
RED = (50, 50, 210)

OBS_APP = Path("/Applications/OBS.app")
EXTENSIONS_SETTINGS = "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
OBS_DOWNLOAD = "https://obsproject.com/download"
MAX_CAMERAS = 4


@dataclass
class SetupResult:
    camera: int
    mode: str
    goku_delay: float
    auto_v: str = "normal"


def virtual_camera_status() -> str:
    """'ready', 'approval', 'missing' or 'no_obs' for the OBS camera extension."""
    if sys.platform != "darwin":
        return "ready"
    if not OBS_APP.is_dir():
        return "no_obs"
    try:
        listing = subprocess.run(
            ["systemextensionsctl", "list"], capture_output=True, text=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return "missing"
    lines = [line for line in listing.splitlines() if "OBS Virtual Camera" in line]
    if any("[activated enabled]" in line for line in lines):
        return "ready"
    return "approval" if lines else "missing"


STATUS_TEXT = {
    "ready": ("Camara virtual de OBS: LISTA", "Meet vera el efecto. Deja la camara virtual",
              "detenida dentro de OBS.", GREEN),
    "approval": ("Camara virtual: FALTA APROBARLA", "Ajustes > Inicio de sesion y extensiones >",
                 "Extensiones de camara > activa OBS.", AMBER),
    "missing": ("Camara virtual: NO INSTALADA", "En OBS pulsa 'Iniciar camara virtual',",
                "apruebala y luego detenla.", RED),
    "no_obs": ("OBS NO ESTA INSTALADO", "Instala OBS Studio para enviar el efecto",
               "a Meet, Zoom o Teams.", RED),
}
FIX_BUTTON = {"approval": "ABRIR AJUSTES", "missing": "ABRIR OBS", "no_obs": "DESCARGAR OBS"}


def _text(img, text, org, scale=0.5, color=TEXT, thickness=1):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def _button(img, box, label, fill=BUTTON, scale=0.5, bold=False, border=BORDER):
    x1, y1, x2, y2 = box
    cv2.rectangle(img, (x1, y1), (x2, y2), fill, -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), border, 1)
    thickness = 2 if bold else 1
    (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    _text(img, label, (x1 + (x2 - x1 - w) // 2, y1 + (y2 - y1 + h) // 2), scale, TEXT, thickness)


def _inside(box, x, y):
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def _open(target: str) -> None:
    try:
        subprocess.Popen(["open", target] if "://" in target or ":" in target
                         else ["open", "-a", target])
    except OSError:
        pass


class _Camera:
    def __init__(self):
        self.index = 0
        self.capture = None
        self.frame = None
        self.failed = False

    def open(self, index: int) -> None:
        self.close()
        self.index = index
        self.frame = None
        self.failed = False
        capture = cv2.VideoCapture(index)
        if capture.isOpened():
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 540)
            self.capture = capture
        else:
            capture.release()
            self.failed = True

    def read(self, mirror: bool):
        if self.capture is None:
            return None
        ok, frame = self.capture.read()
        if ok:
            self.frame = cv2.flip(frame, 1) if mirror else frame
        return self.frame

    def close(self) -> None:
        if self.capture is not None:
            self.capture.release()
            self.capture = None


def choose_setup(modes: tuple[str, ...], mode: str = "goku", camera: int = 0,
                 goku_delay: float = 1.0, mirror: bool = True,
                 auto_v: str = "normal") -> SetupResult | None:
    """Show the setup window until the user presses INICIAR (or quits: None)."""
    modes = tuple(m for m in PANEL_MODES if m in modes)
    mode = mode if mode in modes else modes[0]
    clicks: list[tuple[int, int]] = []

    gap = 8
    mode_w = (WIDTH - 80 - gap * (len(modes) - 1)) // len(modes)
    mode_boxes = {m: (40 + i * (mode_w + gap), 378, 40 + i * (mode_w + gap) + mode_w, 420)
                  for i, m in enumerate(modes)}
    cam_prev, cam_next = (40, 305, 90, 340), (390, 305, 440, 340)
    delay_minus, delay_plus = (40, 470, 90, 510), (210, 470, 260, 510)
    v_boxes = {"normal": (430, 470, 570, 510), "particles": (580, 470, 720, 510)}
    fix_box = (470, 240, 720, 280)
    refresh_box = (470, 290, 720, 325)
    start_box = (300, 560, 720, 615)
    quit_box = (40, 560, 280, 615)

    cv2.namedWindow(SETUP_NAME, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(SETUP_NAME, lambda e, x, y, f, p: clicks.append((x, y))
                         if e == cv2.EVENT_LBUTTONUP else None)
    cam = _Camera()
    cam.open(camera)
    status = virtual_camera_status()
    checked_at = time.monotonic()
    try:
        while True:
            if time.monotonic() - checked_at > 3.0:
                status = virtual_camera_status()
                checked_at = time.monotonic()
            frame = cam.read(mirror)

            img = np.full((HEIGHT, WIDTH, 3), BG, np.uint8)
            _text(img, "VANISHCAM", (40, 45), 0.95, TEXT, 2)
            _text(img, "Configuracion", (230, 45), 0.6, MUTED)

            x1, y1, x2, y2 = PREVIEW
            if frame is not None:
                img[y1:y2, x1:x2] = cv2.resize(frame, (x2 - x1, y2 - y1))
            else:
                cv2.rectangle(img, (x1, y1), (x2, y2), (38, 41, 46), -1)
                msg = "Camara no disponible" if cam.failed else "Abriendo camara..."
                _text(img, msg, (x1 + 110, (y1 + y2) // 2), 0.55, MUTED)
            cv2.rectangle(img, (x1, y1), (x2, y2), BORDER, 1)
            _button(img, cam_prev, "<")
            _button(img, cam_next, ">")
            _text(img, f"CAMARA {cam.index}", (190, 329), 0.55)

            title, line1, line2, color = STATUS_TEXT[status]
            cv2.rectangle(img, (470, 70), (720, 230), color, -1)
            _text(img, "SALIDA A MEET", (485, 98), 0.45, (255, 255, 255))
            words = title.split(": ")
            _text(img, words[0] + (":" if len(words) > 1 else ""), (485, 130), 0.5, (255, 255, 255), 2)
            if len(words) > 1:
                _text(img, words[1], (485, 158), 0.6, (255, 255, 255), 2)
            _text(img, line1, (485, 192), 0.38, (255, 255, 255))
            _text(img, line2, (485, 212), 0.38, (255, 255, 255))
            if status in FIX_BUTTON:
                _button(img, fix_box, FIX_BUTTON[status], bold=True)
            _button(img, refresh_box, "VOLVER A COMPROBAR", scale=0.45)

            _text(img, f"EFECTO  (teclas 1-{len(modes)})", (40, 368), 0.45, MUTED)
            for m, box in mode_boxes.items():
                sel = m == mode
                _button(img, box, MODE_LABELS[m], SELECTED if sel else BUTTON, 0.45, sel,
                        (255, 255, 255) if sel else BORDER)

            _text(img, "TIEMPO DEL GESTO DE GOKU", (40, 455), 0.45, MUTED)
            _button(img, delay_minus, "-", scale=0.7)
            _button(img, delay_plus, "+", scale=0.7)
            _text(img, f"{goku_delay:.1f} s", (118, 498), 0.7, TEXT, 2)
            _text(img, "LA V EN MODO AUTO LANZA", (430, 455), 0.45, MUTED)
            for v, box in v_boxes.items():
                sel = v == auto_v
                _button(img, box, MODE_LABELS[v], SELECTED if sel else BUTTON, 0.45, sel,
                        (255, 255, 255) if sel else BORDER)
            if mode == "auto":
                _text(img, "AUTO: Goku = 2 dedos en la frente | Naruto = palmas juntas a la altura"
                      " de la cara", (40, 530), 0.36, MUTED)

            _text(img, ("Itachi = manos juntas en el pecho | V = indice y medio separados"
                        if mode == "auto" else
                        "Al iniciar te guiaremos para capturar el fondo."),
                  (40, 548), 0.36 if mode == "auto" else 0.42, MUTED)
            _button(img, quit_box, "SALIR", (40, 40, 110))
            start_label = "INICIAR" if status == "ready" else "INICIAR (solo vista previa)"
            _button(img, start_box, start_label, GREEN, 0.65 if status == "ready" else 0.55, True)

            cv2.imshow(SETUP_NAME, img)
            key = cv2.waitKey(15) & 0xFF
            if cv2.getWindowProperty(SETUP_NAME, cv2.WND_PROP_VISIBLE) < 1:
                return None

            actions = []
            for x, y in clicks:
                if _inside(cam_prev, x, y):
                    actions.append("cam_prev")
                elif _inside(cam_next, x, y):
                    actions.append("cam_next")
                elif _inside(delay_minus, x, y):
                    actions.append("delay_minus")
                elif _inside(delay_plus, x, y):
                    actions.append("delay_plus")
                elif status in FIX_BUTTON and _inside(fix_box, x, y):
                    actions.append("fix")
                elif _inside(refresh_box, x, y):
                    actions.append("refresh")
                elif _inside(start_box, x, y):
                    actions.append("start")
                elif _inside(quit_box, x, y):
                    actions.append("quit")
                else:
                    for m, box in mode_boxes.items():
                        if _inside(box, x, y):
                            actions.append(("mode", m))
                    for v, box in v_boxes.items():
                        if _inside(box, x, y):
                            actions.append(("auto_v", v))
            clicks.clear()
            if key in (13, 10):
                actions.append("start")
            elif key in (27, ord("q")):
                actions.append("quit")
            elif ord("1") <= key < ord("1") + len(modes):
                actions.append(("mode", modes[key - ord("1")]))

            for action in actions:
                if action == "start":
                    return SetupResult(cam.index, mode, round(goku_delay, 1), auto_v)
                if action == "quit":
                    return None
                if isinstance(action, tuple) and action[0] == "auto_v":
                    auto_v = action[1]
                elif isinstance(action, tuple):
                    mode = action[1]
                elif action == "cam_prev":
                    cam.open((cam.index - 1) % MAX_CAMERAS)
                elif action == "cam_next":
                    cam.open((cam.index + 1) % MAX_CAMERAS)
                elif action == "delay_minus":
                    goku_delay = max(0.1, goku_delay - 0.1)
                elif action == "delay_plus":
                    goku_delay = min(3.0, goku_delay + 0.1)
                elif action == "refresh":
                    status = virtual_camera_status()
                    checked_at = time.monotonic()
                elif action == "fix":
                    _open({"approval": EXTENSIONS_SETTINGS, "missing": "OBS",
                           "no_obs": OBS_DOWNLOAD}[status])
    finally:
        cam.close()
        cv2.destroyWindow(SETUP_NAME)
        cv2.waitKey(1)
