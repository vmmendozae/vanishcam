# VanishCam: cómo recompilar

Dos piezas:

- `vanish_webcam/`: el motor en Python (efectos, gestos, captura del fondo). Basado en
  `github.com/Nicovic17/vanish_webcam` (sin licencia: uso personal) con nuestros cambios:
  modo Auto, panel, asistente del fondo, modo sin ventanas (`--headless`) y `notch_bridge.py`.
- `vanishcam-notch/`: la app del notch en Swift/SwiftUI. Lanza el motor por dentro y le
  habla con JSON por stdin/stdout.

- `vanishcam-extension/`: la extensión de Chrome para Meet (no se compila: se carga la carpeta
  en `chrome://extensions` con «Cargar descomprimida»). Ver su README.

## 1. Entorno de Python (una vez)

```bash
cd ~/Documents/VanishCam/vanish_webcam
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt pyinstaller
```

MediaPipe debe ser 0.10.x (`requirements.txt` ya lo fija): la 1.0.1 se cae en macOS.

## 2. Tests

```bash
mkdir -p /tmp/vc-tests && ln -sfn ~/Documents/VanishCam/vanish_webcam /tmp/vc-tests/local_app
cd /tmp/vc-tests && local_app/.venv/bin/python -m unittest local_app.test_notch_bridge local_app.test_auto_gestures local_app.test_vanish_cam local_app.test_goku_effect local_app.test_naruto_effect local_app.test_particles_effect local_app.test_itachi_effect local_app.test_video_output
```

Los tests importan un paquete `local_app`, por eso el enlace simbólico.

## 3. Motor empaquetado

```bash
cd ~/Documents/VanishCam/vanish_webcam
.venv/bin/pyinstaller --noconfirm VanishCamEngine.spec
```

Sale en `dist/VanishCamEngine/`.

## 4. App del notch

```bash
~/Documents/VanishCam/vanishcam-notch/scripts/build-app.sh
```

Sale en `vanishcam-notch/dist/VanishCam.app`. Para instalarla, cierra VanishCam (⏻ en el notch) y:

```bash
rm -rf /Applications/VanishCam.app && ditto ~/Documents/VanishCam/vanishcam-notch/dist/VanishCam.app /Applications/VanishCam.app
```

Para revisar el diseño sin cámara: `vanishcam-notch/.build/release/VanishCamNotch --snapshot /tmp/notch-shots`.

## 5. DMG

```bash
mkdir -p /tmp/dmg && ditto ~/Documents/VanishCam/vanishcam-notch/dist/VanishCam.app /tmp/dmg/VanishCam.app && ln -sfn /Applications /tmp/dmg/Aplicaciones
hdiutil create -volname VanishCam -srcfolder /tmp/dmg -ov -format UDZO -fs HFS+ ~/Downloads/VanishCam.dmg
```

## Registro

Errores del motor: `~/Library/Logs/VanishCam.log`.
