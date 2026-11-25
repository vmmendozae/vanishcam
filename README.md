# VanishCam

Desaparece de tu cámara en una videollamada con un gesto, al estilo anime:
**Goku** (teletransporte), **Naruto** (humo y tronco), **Partículas**, **Normal** e **Itachi**.
Un modo **Auto** reconoce cualquiera de los gestos y lanza su efecto.

| Gesto | Efecto |
|---|---|
| Dos dedos juntos en la frente | Goku |
| Palmas juntas a la altura de la cara | Naruto |
| Manos juntas en el pecho | Itachi |
| V con índice y medio | Normal o Partículas |

## Qué hay aquí

| Carpeta | Qué es |
|---|---|
| [`vanish_webcam/`](vanish_webcam) | Motor en Python (OpenCV + MediaPipe): gestos, efectos, captura guiada del fondo, salida a la cámara virtual de OBS. Tiene un modo sin ventanas (`--headless`) que controla la app del notch. |
| [`vanishcam-notch/`](vanishcam-notch) | App de macOS en Swift/SwiftUI que vive en el **notch**: al pasar el mouse se despliega y desde ahí se inicia, se captura el fondo, se eligen efectos y se sale. Lleva el motor dentro. |
| [`vanishcam-extension/`](vanishcam-extension) | Extensión de Chrome para **Google Meet**, sin OBS: procesa la cámara en el navegador con MediaPipe web. Goku, Naruto, Partículas y Auto. |

Instrucciones para compilar e instalar: [COMO-COMPILAR.md](COMO-COMPILAR.md).
La extensión tiene las suyas en [vanishcam-extension/README.md](vanishcam-extension/README.md).

## Requisitos

- **App del notch**: Mac con Apple Silicon y macOS 14 o superior, y [OBS Studio](https://obsproject.com/)
  con la cámara virtual activada una vez (macOS pide aprobar su extensión). En Meet, Zoom o Teams
  se elige la cámara **OBS Virtual Camera**.
- **Extensión**: Chrome, Edge o Brave (111 o superior), instalada en modo desarrollador.

## Créditos y licencia

El motor, los efectos y sus recursos (tronco, cuervos, sonidos, Sharingan) vienen de
**[Nicovic17/vanish_webcam](https://github.com/Nicovic17/vanish_webcam)** (commit `ab30107`).
Ese repositorio **no publica una licencia**, así que su código y sus recursos
siguen siendo de su autor. Si el autor prefiere que no estén aquí, se retiran.

Sobre esa base, este repo agrega: modo Auto, panel y asistente de captura del fondo, modo sin
ventanas y puente JSON (`notch_bridge.py`), la app del notch y la extensión de Chrome, que porta
los gestos y tres efectos a JavaScript.

Los modelos de MediaPipe (`*.task`, `*.tflite`) y MediaPipe web (`vanishcam-extension/lib`) son
de Google, con licencia Apache 2.0. La forma de anclar una ventana al notch se inspiró en
[Notch Pilot](https://github.com/devmegablaster/Notch-Pilot) (MIT).
