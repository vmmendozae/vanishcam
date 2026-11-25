// Runs in the page (MAIN world) before Meet loads.
// It swaps the camera track Meet receives for a processed one. Every camera
// frame is drawn into a shared <canvas>; a synchronous DOM event lets the
// extension (isolated world, same thread) paint the effect into a second
// shared <canvas>, which becomes the frame Meet sends. Frame-driven, so it keeps
// running when the tab is in the background (timers would be throttled).
(() => {
  "use strict";
  if (window.__vanishcamPatched) return;
  window.__vanishcamPatched = true;

  const proto = window.MediaDevices && MediaDevices.prototype;
  if (!proto || !proto.getUserMedia) return;
  if (typeof MediaStreamTrackProcessor !== "function" ||
      typeof MediaStreamTrackGenerator !== "function") {
    console.warn("[VanishCam] Este navegador no soporta MediaStreamTrackProcessor.");
    return;
  }

  const originalGetUserMedia = proto.getUserMedia;
  const root = () => document.documentElement;
  let counter = 0;

  function hiddenCanvas(id) {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:fixed!important;left:-99999px!important;top:0!important;" +
      "width:2px!important;height:2px!important;opacity:0!important;pointer-events:none!important";
    (document.body || root()).appendChild(canvas);
    return canvas;
  }

  function wrap(cameraTrack) {
    const id = "vanishcam-" + Date.now().toString(36) + "-" + (++counter);
    const input = hiddenCanvas(id + "-in");
    const output = hiddenCanvas(id + "-out");
    const inputCtx = input.getContext("2d", { alpha: false, desynchronized: true });

    const processor = new MediaStreamTrackProcessor({ track: cameraTrack });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });

    const transformer = new TransformStream({
      transform(frame, controller) {
        const width = frame.displayWidth, height = frame.displayHeight;
        if (root().dataset.vanishcamEnabled === "off") {
          controller.enqueue(frame);
          return;
        }
        if (input.width !== width || input.height !== height) {
          input.width = width;
          input.height = height;
        }
        inputCtx.drawImage(frame, 0, 0, width, height);
        output.dataset.drawn = "0";
        root().dataset.vanishcamFrame = id;
        // Synchronous: the extension's listener paints `output` before this returns.
        document.dispatchEvent(new Event("vanishcam:frame"));
        if (output.dataset.drawn === "1" && output.width === width && output.height === height) {
          const processed = new VideoFrame(output, {
            timestamp: frame.timestamp,
            duration: frame.duration ?? undefined,
          });
          frame.close();
          controller.enqueue(processed);
        } else {
          controller.enqueue(frame);  // Extension not ready yet: pass the camera through.
        }
      },
    });

    processor.readable.pipeThrough(transformer).pipeTo(generator.writable).catch(() => {});

    const cleanup = () => {
      input.remove();
      output.remove();
      root().dataset.vanishcamEnded = id;
      document.dispatchEvent(new Event("vanishcam:ended"));
    };

    // Meet manages its track: stopping it must release the real camera too,
    // and settings/constraints keep reflecting the real device.
    const stopGenerator = generator.stop.bind(generator);
    generator.stop = () => { stopGenerator(); cameraTrack.stop(); cleanup(); };
    cameraTrack.addEventListener("ended", () => { stopGenerator(); cleanup(); });
    generator.getSettings = () => cameraTrack.getSettings();
    generator.getConstraints = () => cameraTrack.getConstraints();
    if (cameraTrack.getCapabilities) generator.getCapabilities = () => cameraTrack.getCapabilities();
    generator.applyConstraints = (constraints) => cameraTrack.applyConstraints(constraints);
    Object.defineProperty(generator, "label", { get: () => cameraTrack.label });

    root().dataset.vanishcamSource = id;
    document.dispatchEvent(new Event("vanishcam:source"));
    return generator;
  }

  proto.getUserMedia = async function getUserMedia(constraints) {
    const stream = await originalGetUserMedia.call(this, constraints);
    if (!constraints || !constraints.video) return stream;
    const cameraTrack = stream.getVideoTracks()[0];
    if (!cameraTrack) return stream;
    try {
      return new MediaStream([wrap(cameraTrack), ...stream.getAudioTracks()]);
    } catch (error) {
      console.warn("[VanishCam] No se pudo procesar la camara:", error);
      return stream;
    }
  };
})();
