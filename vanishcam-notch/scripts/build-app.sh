#!/usr/bin/env bash
# Builds dist/VanishCam.app: the notch app (Swift) with the Python engine inside.
#
#   1. Engine:  vanish_webcam/.venv/bin/pyinstaller --noconfirm VanishCamEngine.spec
#   2. App:     vanishcam-notch/scripts/build-app.sh
#
# Optional: ENGINE_DIR=/path/to/VanishCamEngine (defaults to ../vanish_webcam/dist).
set -euo pipefail
cd "$(dirname "$0")/.."

ENGINE_DIR="${ENGINE_DIR:-../vanish_webcam/dist/VanishCamEngine}"
ICON="../vanish_webcam/assets/vanish_icon.icns"
APP="dist/VanishCam.app"

[ -x "$ENGINE_DIR/VanishCamEngine" ] || { echo "Falta el motor en $ENGINE_DIR"; exit 1; }

echo "▶ Compilando la app del notch..."
swift build -c release

echo "▶ Armando $APP"
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/engine"
cp .build/release/VanishCamNotch "$APP/Contents/MacOS/VanishCam"
cp "$ICON" "$APP/Contents/Resources/AppIcon.icns"
ditto "$ENGINE_DIR" "$APP/Contents/Resources/engine/VanishCamEngine"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>es</string>
    <key>CFBundleDisplayName</key><string>VanishCam</string>
    <key>CFBundleName</key><string>VanishCam</string>
    <key>CFBundleExecutable</key><string>VanishCam</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIdentifier</key><string>local.vanishcam.personal</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>2.0</string>
    <key>CFBundleVersion</key><string>2</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSCameraUsageDescription</key>
    <string>VanishCam usa la cámara para aplicar los efectos en tu video.</string>
</dict>
</plist>
PLIST

echo "▶ Firmando (ad hoc)..."
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "✓ $APP listo"
du -sh "$APP"
