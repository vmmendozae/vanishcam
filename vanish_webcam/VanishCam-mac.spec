"""Personal macOS build: VanishCam.app with every effect, no online license.

Build:  .venv/bin/pyinstaller --noconfirm VanishCam-mac.spec
Output: dist/VanishCam.app
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
    hiddenimports=["pygame.mixer", "mediapipe.tasks.c", "control_panel", "setup_window", "background_onboarding", "auto_gestures"],
    excludes=["tkinter"],  # mediapipe imports matplotlib, so it stays.
    noarchive=False,
)
archive = PYZ(analysis.pure)
exe = EXE(
    archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="VanishCam",
    console=False,
    upx=False,
    icon=str(root / "assets" / "vanish_icon.icns"),
)
collected = COLLECT(exe, analysis.binaries, analysis.datas, name="VanishCam", upx=False)
app = BUNDLE(
    collected,
    name="VanishCam.app",
    icon=str(root / "assets" / "vanish_icon.icns"),
    bundle_identifier="local.vanishcam.personal",
    info_plist={
        "CFBundleDisplayName": "VanishCam",
        "CFBundleShortVersionString": "1.0",
        "NSCameraUsageDescription": "VanishCam usa la camara para aplicar los efectos en tu video.",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "12.0",
    },
)
