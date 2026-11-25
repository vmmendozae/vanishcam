# VanishCam para Chrome (prototipo)

Desaparece de tu cámara en **Google Meet** con un gesto. Sin OBS: la extensión
procesa la cámara dentro del navegador y Meet recibe el video con el efecto.

| Gesto | Efecto | Para volver |
|---|---|---|
| Dos dedos juntos en la frente (1 s) | Goku | Repetir el gesto o «Reaparecer» |
| Palmas juntas frente a la cámara | Naruto (humo y tronco) | «Reaparecer» |
| V con índice y medio | Partículas | «Reaparecer» |

En **Auto** vale cualquiera de los tres gestos; también puedes fijar uno solo.

## Instalar (modo desarrollador, sin tienda)

1. Abre `chrome://extensions` en Chrome (sirve también en Edge o Brave).
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige esta carpeta (la que tiene `manifest.json`).
4. Fija el icono de VanishCam en la barra (pieza de puzle → chincheta).

La carpeta debe quedarse donde está: Chrome la lee desde ahí cada vez.
Tras cambiar archivos, pulsa ↻ en la tarjeta de la extensión y recarga Meet.

## Usar

1. Entra a una reunión de Meet y enciende la cámara. Aparece el panel de VanishCam
   (no sale en la llamada; muévelo arrastrando el título).
2. **Capturar fondo**: tienes 3 s (pitidos) para salir del encuadre; captura 2 s.
   Revisa la imagen y pulsa «Listo, empezar». Si avisa que todavía apareces, repite.
3. Elige el efecto (o deja **Auto**) y haz el gesto.
4. «Efectos activos» apagado = Meet ve tu cámara normal.
5. El icono de la extensión muestra u oculta el panel.

Silencia el micrófono antes de desaparecer: el efecto es solo de video.

## Cómo funciona

- `src/page.js` (mundo de la página): cambia la pista de cámara que recibe Meet por
  una procesada fotograma a fotograma (`MediaStreamTrackProcessor`/`Generator`), así
  sigue funcionando aunque la pestaña quede en segundo plano.
- `src/content.js` (mundo aislado de la extensión): MediaPipe (manos, cara, silueta) y
  los efectos. Ambos mundos comparten dos `<canvas>` ocultos y un evento síncrono.
- MediaPipe se carga desde la propia extensión (`lib/`, versión 0.10.35), sin inyectar
  scripts en Meet, y usa la GPU (WebGL) con vuelta automática a CPU.
- `src/gestures.js` y `src/effects.js` son la traducción de la app de Mac (Python).

## Pruebas

- `node test/gestures.test.js`: la detección de gestos da lo mismo que la versión Python.
- `test/harness.html`: imita Meet con una cámara sintética. Sírvela con
  `python3 -m http.server 8765 --directory .` y abre `http://localhost:8765/test/harness.html`.

## Límites conocidos

- Solo Google Meet en el navegador (no apps de escritorio de Zoom/Teams).
- Uso personal: los efectos vienen del repo `Nicovic17/vanish_webcam`, que no tiene
  licencia; no la publiques en la Chrome Web Store.
