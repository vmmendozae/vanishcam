"""Headless engine for the notch app (VanishCam.app/Contents/Resources/engine).

Build:  .venv/bin/pyinstaller --noconfirm VanishCamEngine.spec
Output: dist/VanishCamEngine/ (folder with the VanishCamEngine binary)
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs


root = Path(SPECPATH).resolve()
resources = (
    (root / "hand_landmarker.task", "."),
    (root / "models" / "selfie_segmenter_landscape.tflite", "models"),
    (root / "models" / "gesture_recognizer.task", "models"),
    (root / "models" / "blaze_face_short_range.tflite", "models"),
    (root / "assets" / "substitution_log.png", "assets"),
    (root / "assets" / "vanish.MP3", "assets"),
    (root / "assets" / "teleport.MP3", "assets"),
    (root / "assets" / "itachi_crow_sheet.png", "assets"),
    (root / "assets" / "sharingan.png", "assets"),
    (root / "editions" / "full" / "edition.txt", "."),
    (root / "editions" / "mac" / "personal_build.txt", "."),
)
missing = [str(path) for path, _ in resources if not path.is_file()]
if missing:
    raise SystemExit("Missing build files:\n" + "\n".join(missing))

analysis = Analysis(
    [str(root / "vanish_cam.py")],
    pathex=[str(root)],
    binaries=collect_dynamic_libs("mediapipe"),
    datas=[(str(path), dest) for path, dest in resources] + collect_data_files("mediapipe"),
    hiddenimports=["pygame.mixer", "mediapipe.tasks.c", "control_panel", "setup_window", "background_onboarding", "auto_gestures", "notch_bridge"],
    excludes=["tkinter"],  # mediapipe imports matplotlib, so it stays.
    noarchive=False,
)
archive = PYZ(analysis.pure)
exe = EXE(
    archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="VanishCamEngine",
    console=True,
    upx=False,
)
COLLECT(exe, analysis.binaries, analysis.datas, name="VanishCamEngine", upx=False)
