"""Channel between the notch app (Swift) and the headless engine.

JSON lines. Engine -> app on the original stdout:
  {"type": "status", "phase": ..., "title": ..., "detail": ..., "color": ..., ...}
  {"type": "preview", "kind": "live" | "background", "jpeg": "<base64>"}
  {"type": "error", "message": ...} and finally {"type": "stopped"}
App -> engine on stdin:
  {"cmd": "mode" | "goku_delay" | "auto_v", "value": ...}
  {"cmd": "vanish" | "appear" | "background" | "quit"}
  {"cmd": "bg_capture" | "bg_accept" | "bg_retry" | "bg_cancel"}
  {"cmd": "preview", "value": true | false}   (thumbnails only while the notch is open)

Anything else the engine prints (Python or MediaPipe's C++ logs) is moved off
stdout so it cannot corrupt the protocol.
"""

from __future__ import annotations

import base64
import json
import os
import queue
import sys
import threading
import time

import cv2

try:
    from .control_panel import AMBER, BLUE, GREEN, RED
except ImportError:
    from control_panel import AMBER, BLUE, GREEN, RED

COLOR_NAMES = {tuple(RED): "red", tuple(GREEN): "green", tuple(AMBER): "amber", tuple(BLUE): "blue"}
PUBLIC_PHASES = {"calibrating", "ready", "vanished"}
PREVIEW_WIDTH = 320
PREVIEW_INTERVAL = 0.2


class NotchBridge:
    def __init__(self, out=None, inp=None):
        if out is None:
            protocol_fd = os.dup(1)
            os.dup2(2, 1)  # stray writes to stdout (Python or C++) now go to stderr
            out = os.fdopen(protocol_fd, "w", buffering=1, encoding="utf-8")
        self.out = out
        self.lock = threading.Lock()
        self.commands: queue.Queue = queue.Queue()
        self.previews = False
        self.last_status = None
        self.last_status_at = 0.0
        self.last_preview_at = 0.0
        threading.Thread(target=self._read, args=(inp or sys.stdin,), daemon=True).start()

    def _read(self, inp) -> None:
        for line in inp:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("cmd") == "preview":
                self.previews = bool(message.get("value"))
                self.last_status = None  # resend the status right away
                continue
            self.commands.put(message)
        self.commands.put({"cmd": "quit"})  # stdin closed: the notch app is gone

    def emit(self, message: dict) -> None:
        with self.lock:
            try:
                self.out.write(json.dumps(message, ensure_ascii=False) + "\n")
                self.out.flush()
            except (BrokenPipeError, OSError, ValueError):
                pass

    def drain(self) -> list[dict]:
        found = []
        while True:
            try:
                found.append(self.commands.get_nowait())
            except queue.Empty:
                return found

    def status(self, phase: str, title: str, detail: str, color: str, **extra) -> None:
        message = {"type": "status", "phase": phase, "title": title, "detail": detail,
                   "color": color, **extra}
        now = time.monotonic()
        if message != self.last_status or now - self.last_status_at > 1.0:
            self.emit(message)
            self.last_status, self.last_status_at = message, now

    def preview(self, frame, kind: str = "live", force: bool = False) -> None:
        now = time.monotonic()
        if not force and (not self.previews or now - self.last_preview_at < PREVIEW_INTERVAL):
            return
        self.last_preview_at = now
        height = max(1, round(PREVIEW_WIDTH * frame.shape[0] / frame.shape[1]))
        small = cv2.resize(frame, (PREVIEW_WIDTH, height), interpolation=cv2.INTER_AREA)
        ok, jpeg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 72])
        if ok:
            self.emit({"type": "preview", "kind": kind, "jpeg": base64.b64encode(jpeg).decode()})

    # ---- same interface as ControlPanel, so run_camera() can use either ----
    def draw(self, mode, title, detail, color, virtual_ok, loading=False, phase=None, **extra) -> None:
        public = "loading" if loading else (phase if phase in PUBLIC_PHASES else "effect")
        self.status(public, title, detail, COLOR_NAMES.get(tuple(color), "gray"),
                    mode=mode, virtual=virtual_ok, **extra)

    def actions(self, key: int) -> list:
        found = []
        for message in self.drain():
            command, value = message.get("cmd"), message.get("value")
            if command in ("mode", "goku_delay", "auto_v"):
                found.append((command, value))
            elif command in ("vanish", "appear", "background", "quit"):
                found.append(command)
        return found
