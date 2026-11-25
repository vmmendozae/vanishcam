// Extension side (isolated world): loads MediaPipe, watches gestures and paints
// each processed frame. page.js hands over every camera frame through a shared
// <canvas> and a synchronous "vanishcam:frame" event.
(function () {
  "use strict";
  const VC = globalThis.VanishCam;
  const { gestures: G, effects: FX } = VC;
  const url = (path) => chrome.runtime.getURL(path);
  const root = document.documentElement;

  // vision_wasm_internal.js (loaded just before) defines ModuleFactory; MediaPipe
  // clears it after creating each task, so keep it and restore it per task.
  const MODULE_FACTORY = globalThis.ModuleFactory;

  const DETECT_EVERY = 0.10;        // seconds between gesture checks
  const DETECT_WIDTH = 640;         // detection runs on a downscaled copy
  const LEAVE_SECONDS = 3;
  const CAPTURE_SECONDS = 2;
  const CAPTURE_FRAMES = 7;
  const PERSON_LIMIT = 0.03;

  const settings = { mode: "auto", enabled: true, gokuDelay: 1, panel: null };
  const state = {
    phase: "waiting",          // waiting | loading | need_background | countdown | capturing | review
                               // | ready | effect | vanished | error
    source: null, input: null, output: null, ctx: null,
    background: null, pendingBackground: null, personShare: 0,
    effect: null, effectName: null, effectStarted: 0, appearing: false,
    lastCheck: 0, lastTs: 0, countdownStart: 0, lastTick: -1, samples: [], captureStart: 0,
    gokuGate: new G.GokuGate(1), gate: new G.TriggerGate("particles"), gokuLeft: null,
    error: "",
  };
  let tasks = null, loading = null, logImage = null, audio = null;
  const small = FX.canvas(DETECT_WIDTH, 360);
  const smallCtx = small.getContext("2d", { willReadFrequently: true });

  // ------------------------------------------------------------ settings & panel
  const panel = new VC.Panel({
    onMode(mode) { settings.mode = mode; resetGates(); save(); refresh(); },
    onEnabled(on) { settings.enabled = on; root.dataset.vanishcamEnabled = on ? "on" : "off"; save(); refresh(); },
    onDelay(sec) { settings.gokuDelay = sec; state.gokuGate.holdSeconds = sec; save(); refresh(); },
    onMoved(pos) { settings.panel = pos; save(); },
    onAction: handleAction,
  });
  chrome.storage.local.get(["mode", "enabled", "gokuDelay", "panel"]).then((stored) => {
    Object.assign(settings, Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== undefined)));
    state.gokuGate.holdSeconds = settings.gokuDelay;
    root.dataset.vanishcamEnabled = settings.enabled ? "on" : "off";
    panel.setPosition(settings.panel);
    refresh();
  });
  const save = () => chrome.storage.local.set(settings);
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "toggle-panel") panel.toggle();
  });

  // ------------------------------------------------------------ sounds
  let audioCtx = null;
  function beep(freq, ms, when = 0) {
    try {
      audioCtx = audioCtx || new AudioContext();
      const t = audioCtx.currentTime + when;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + ms / 1000 + 0.02);
    } catch (_) { /* no audio: silent */ }
  }
  function playEffectSound(name) {
    audio = audio || { goku: new Audio(url("assets/teleport.mp3")), naruto: new Audio(url("assets/vanish.mp3")) };
    const a = audio[name];
    if (a) { a.currentTime = 0; a.play().catch(() => {}); }
  }

  // ------------------------------------------------------------ MediaPipe
  async function loadTasks() {
    if (tasks) return tasks;
    if (loading) return loading;
    loading = (async () => {
      const vision = await import(url("lib/vision_bundle.mjs"));
      const fileset = { wasmLoaderPath: "", wasmBinaryPath: url("lib/vision_wasm_internal.wasm") };
      // GPU (WebGL) is several times faster for hands and face; fall back to CPU
      // if this machine or browser cannot create the GPU graph.
      const create = async (Task, options) => {
        for (const delegate of ["GPU", "CPU"]) {
          try {
            globalThis.ModuleFactory = MODULE_FACTORY;
            options.baseOptions.delegate = delegate;
            const task = await Task.createFromOptions(fileset, options);
            VC.debug.delegates = Object.assign(VC.debug.delegates || {}, { [Task.name || "task"]: delegate });
            return task;
          } catch (error) {
            if (delegate === "CPU") throw error;
            console.warn("[VanishCam] GPU no disponible, uso CPU:", error);
          }
        }
      };
      const base = (file) => ({ modelAssetPath: url("models/" + file) });
      const hands = await create(vision.HandLandmarker, {
        baseOptions: base("hand_landmarker.task"), runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.45,
      });
      const faces = await create(vision.FaceDetector, {
        baseOptions: base("blaze_face_short_range.tflite"), runningMode: "VIDEO", minDetectionConfidence: 0.5,
      });
      const segmenter = await create(vision.ImageSegmenter, {
        baseOptions: base("selfie_segmenter_landscape.tflite"), runningMode: "IMAGE",
        outputConfidenceMasks: true, outputCategoryMask: false,
      });
      // Warm up: the first GPU inference compiles shaders and can block for
      // seconds. Do it now, while the panel says "Cargando", not mid-call.
      const warm = FX.canvas(DETECT_WIDTH, 360);
      warm.getContext("2d").fillRect(0, 0, warm.width, warm.height);
      hands.detectForVideo(warm, 1);
      faces.detectForVideo(warm, 1);
      segmenter.segment(warm, () => {});
      state.lastTs = 1;
      logImage = new Image();
      logImage.src = url("assets/substitution_log.png");
      await logImage.decode().catch(() => {});
      tasks = { hands, faces, segmenter, faceBoxes: [], faceSeen: -1000 };
      return tasks;
    })();
    return loading;
  }

  // Isolated world: only the extension (and the local test page) can reach this.
  VC.debug = { state, settings, segmentOverride: null };

  function segment(source) {
    if (VC.debug.segmentOverride) return VC.debug.segmentOverride(source);
    let mask = null;
    tasks.segmenter.segment(source, (result) => {
      const m = result.confidenceMasks && result.confidenceMasks[0];
      if (m) mask = { data: m.getAsFloat32Array().slice(), width: m.width, height: m.height };
    });
    return mask || { data: new Float32Array(4), width: 2, height: 2 };
  }

  function readGestures(now) {
    const w = small.width, h = small.height;
    let ts = Math.round(now * 1000);
    if (ts <= state.lastTs) ts = state.lastTs + 1;
    state.lastTs = ts;
    // Faces move little: detect them every other check (hands every check).
    tasks.checks = (tasks.checks || 0) + 1;
    if (tasks.checks % 2 === 1) {
      const detected = tasks.faces.detectForVideo(small, ts).detections || [];
      if (detected.length) {
        tasks.faceBoxes = detected.map((d) => [d.boundingBox.originX, d.boundingBox.originY,
                                               d.boundingBox.width, d.boundingBox.height]);
        tasks.faceSeen = ts;
      } else if (ts - tasks.faceSeen > 400) tasks.faceBoxes = [];
    }
    const result = tasks.hands.detectForVideo(small, ts);
    const mode = settings.mode;
    const wanted = { goku: mode === "auto" || mode === "goku", naruto: mode === "auto" || mode === "naruto",
                     victory: mode === "auto" || mode === "particles" };
    return G.classify(result.landmarks || [], result.worldLandmarks || [], tasks.faceBoxes, w, h, wanted);
  }

  // ------------------------------------------------------------ effects
  function resetGates() {
    state.gokuGate.reset();
    state.gate = new G.TriggerGate("particles");
    state.gokuLeft = null;
  }

  function startEffect(name, appearing, now) {
    const { input } = state, w = input.width, h = input.height;
    const mask = segment(small);
    if (name === "goku") state.effect = new FX.GokuTeleport(input, state.background, mask, w, h);
    else if (name === "naruto") state.effect = new FX.NarutoSubstitution(input, state.background, mask, logImage, w, h);
    else state.effect = new FX.ParticleEffect(input, mask, w, h);
    state.effectName = name;
    state.appearing = appearing;
    state.effectStarted = now;
    state.phase = "effect";
    state.gate.disarm();
    if (name === "goku") { state.gokuGate.reset(); state.gokuGate.armed = false; }
    if (name !== "particles") playEffectSound(name);
  }

  const effectSeconds = (name) => name === "goku" ? FX.TELEPORT_SECONDS
    : name === "naruto" ? FX.NARUTO_SECONDS : FX.PARTICLE_SECONDS;
  const modeEffect = () => settings.mode === "auto" ? (state.effectName || "particles") : settings.mode;

  function handleAction(action) {
    const now = performance.now() / 1000;
    if (action === "background") return startCountdown(now);
    if (action === "retry") { state.pendingBackground = null; panel.showReview(null); return startCountdown(now); }
    if (action === "accept") {
      state.background = state.pendingBackground;
      state.pendingBackground = null;
      panel.showReview(null);
      state.phase = state.source ? "ready" : "waiting";
      resetGates();
      state.gate.disarm();
      return refresh();
    }
    if (!tasks || !state.input || !state.background) return;
    if (action === "vanish" && state.phase === "ready") {
      drawSmall();
      startEffect(modeEffect(), false, now);
    } else if (action === "appear" && state.phase === "vanished") {
      if (state.effectName === "goku") { drawSmall(); startEffect("goku", true, now); }
      else { state.phase = "ready"; state.effect = null; state.gate.disarm(); }
    }
    refresh();
  }

  // ------------------------------------------------------------ background capture
  function startCountdown(now) {
    if (!state.input) return;
    beep(660, 60);
    state.phase = "countdown";
    state.countdownStart = now;
    state.lastTick = -1;
    refresh();
  }

  function captureFrame() {
    const { input } = state;
    const c = FX.canvas(input.width, input.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(input, 0, 0);
    state.samples.push(ctx.getImageData(0, 0, c.width, c.height).data);
  }

  function finishCapture() {
    const { input } = state, w = input.width, h = input.height;
    const frames = state.samples;
    const n = frames.length, out = new Uint8ClampedArray(w * h * 4), v = new Uint8Array(n);
    for (let i = 0; i < out.length; i++) {
      if ((i & 3) === 3) { out[i] = 255; continue; }
      for (let k = 0; k < n; k++) v[k] = frames[k][i];
      v.sort();
      out[i] = v[n >> 1];
    }
    state.samples = [];
    const bg = FX.canvas(w, h);
    bg.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
    smallCtx.drawImage(bg, 0, 0, small.width, small.height);
    state.personShare = FX.personFraction(segment(small));
    state.pendingBackground = bg;
    state.phase = "review";
    const thumb = FX.canvas(280, Math.round(280 * h / w));
    thumb.getContext("2d").drawImage(bg, 0, 0, thumb.width, thumb.height);
    panel.showReview(thumb.toDataURL("image/jpeg", 0.8), state.personShare);
    if (state.personShare > PERSON_LIMIT) beep(220, 350);
    else { beep(880, 120); beep(1320, 180, 0.13); }
    refresh();
  }

  // ------------------------------------------------------------ per-frame work
  function drawSmall() {
    const h = Math.round(DETECT_WIDTH * state.input.height / state.input.width);
    if (small.height !== h) small.height = h;
    smallCtx.drawImage(state.input, 0, 0, small.width, small.height);
  }

  function onFrame() {
    const id = root.dataset.vanishcamFrame;
    if (!state.source || state.source.id !== id) attach(id);
    const { input, output, ctx } = state;
    if (!input || !output) return;
    const w = input.width, h = input.height;
    if (output.width !== w || output.height !== h) { output.width = w; output.height = h; }
    if (state.background && (state.background.width !== w || state.background.height !== h)) {
      state.background = null;  // camera resolution changed: the old background no longer fits
      if (["ready", "vanished", "effect"].includes(state.phase)) state.phase = "need_background";
    }
    const now = performance.now() / 1000;
    try {
      step(now);
    } catch (error) {
      console.error("[VanishCam]", error);
      state.phase = "error"; state.error = String(error && error.message || error);
    }
    if (state.phase === "effect") {
      const age = now - state.effectStarted;
      if (state.effectName === "goku") state.effect.render(ctx, state.background, age, state.appearing);
      else state.effect.render(ctx, state.background, age);
    } else if (state.phase === "vanished") {
      if (state.effectName === "naruto") state.effect.render(ctx, state.background, 99);
      else ctx.drawImage(state.background, 0, 0, w, h);
    } else {
      ctx.drawImage(input, 0, 0, w, h);
    }
    output.dataset.drawn = "1";
    if (now - (state.lastRefresh || 0) > 0.2) refresh(now);
  }

  function step(now) {
    switch (state.phase) {
      case "countdown": {
        const left = LEAVE_SECONDS - Math.floor(now - state.countdownStart);
        if (left !== state.lastTick && left > 0) { beep(880, 80); state.lastTick = left; }
        if (left <= 0) { state.phase = "capturing"; state.captureStart = now; state.samples = []; beep(523, 160); }
        break;
      }
      case "capturing": {
        const wantFrames = Math.floor((now - state.captureStart) / (CAPTURE_SECONDS / CAPTURE_FRAMES));
        if (state.samples.length < Math.min(CAPTURE_FRAMES, wantFrames + 1)) captureFrame();
        if (now - state.captureStart >= CAPTURE_SECONDS && state.samples.length) finishCapture();
        break;
      }
      case "effect": {
        if (now - state.effectStarted >= effectSeconds(state.effectName)) {
          state.phase = state.appearing ? "ready" : "vanished";
          if (state.appearing) state.effect = null;
        }
        break;
      }
      case "ready":
      case "vanished": {
        if (!tasks || now - state.lastCheck < DETECT_EVERY) break;
        state.lastCheck = now;
        drawSmall();
        const reading = readGestures(now);
        if (state.phase === "ready") {
          const fired = state.gate.update(reading, now, state.gokuGate);
          if (fired) { startEffect(fired, false, now); break; }
          const holding = reading.goku && state.gokuGate.armed && state.gokuGate.holdStarted !== null;
          state.gokuLeft = holding ? Math.max(0.1, state.gokuGate.holdSeconds - (now - state.gokuGate.holdStarted)) : null;
        } else if (state.effectName === "goku") {
          if (state.gokuGate.update(reading.goku, now)) startEffect("goku", true, now);
        }
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------ camera lifecycle
  function attach(id) {
    const input = id && document.getElementById(id + "-in");
    const output = id && document.getElementById(id + "-out");
    if (!input || !output) { state.source = null; state.input = state.output = null; return; }
    state.source = { id };
    state.input = input; state.output = output;
    state.ctx = output.getContext("2d", { alpha: false });
    if (state.phase === "waiting" || state.phase === "error") {
      state.phase = state.background ? "ready" : "loading";
    }
    panel.setVisible(true);
    loadTasks().then(() => {
      if (state.phase === "loading") state.phase = state.background ? "ready" : "need_background";
      refresh();
    }).catch((error) => {
      console.error("[VanishCam] MediaPipe:", error);
      state.phase = "error"; state.error = String(error && error.message || error);
      refresh();
    });
    refresh();
  }

  document.addEventListener("vanishcam:frame", onFrame);
  document.addEventListener("vanishcam:source", () => attach(root.dataset.vanishcamSource));
  document.addEventListener("vanishcam:ended", () => {
    if (state.source && state.source.id === root.dataset.vanishcamEnded) {
      state.source = null; state.input = state.output = null;
      if (!["review"].includes(state.phase)) state.phase = "waiting";
      refresh();
    }
  });

  // ------------------------------------------------------------ status text
  const HINTS = {
    auto: "Goku: dos dedos juntos en la frente. Naruto: palmas juntas. Partículas: V con los dedos.",
    goku: "Dos dedos juntos en la frente; repite el gesto para volver.",
    naruto: "Junta las palmas frente a la cámara.",
    particles: "Haz la V con índice y medio.",
  };

  function refresh(now = performance.now() / 1000) {
    state.lastRefresh = now;
    const s = state.phase;
    const delay = settings.gokuDelay;
    let title, detail, color;
    if (!settings.enabled && s !== "waiting") [title, detail, color] = ["EFECTOS APAGADOS", "Meet ve tu cámara normal", "gray"];
    else if (s === "waiting") [title, detail, color] = ["ESPERANDO LA CÁMARA", "Activa la cámara en Meet", "gray"];
    else if (s === "loading") [title, detail, color] = ["CARGANDO…", "Preparando la detección de gestos", "gray"];
    else if (s === "error") [title, detail, color] = ["ERROR", state.error.slice(0, 90), "red"];
    else if (s === "need_background") [title, detail, color] = ["CAPTURA TU FONDO", "Pulsa «Capturar fondo» y sal del encuadre", "amber"];
    else if (s === "countdown") {
      const left = Math.max(1, LEAVE_SECONDS - Math.floor(now - state.countdownStart));
      [title, detail, color] = [`SAL DEL ENCUADRE: ${left}`, "Captura el fondo al terminar los pitidos", "amber"];
    } else if (s === "capturing") [title, detail, color] = ["CAPTURANDO FONDO", "No entres todavía", "red"];
    else if (s === "review") [title, detail, color] = ["REVISA EL FONDO", "Es lo que verán cuando desaparezcas", "blue"];
    else if (s === "ready") {
      if (state.gokuLeft !== null) [title, detail, color] = [`TELETRANSPORTE EN ${state.gokuLeft.toFixed(1)} s`, "Mantén el gesto", "amber"];
      else [title, detail, color] = ["LISTO", HINTS[settings.mode].replace("frente;", `frente ${delay} s;`), "green"];
    } else if (s === "vanished") {
      [title, detail, color] = ["DESAPARECIDO", state.effectName === "goku"
        ? "Repite el gesto o pulsa «Reaparecer»" : "Pulsa «Reaparecer» para volver", "blue"];
    } else [title, detail, color] = ["EFECTO EN CURSO", "", "amber"];
    panel.setStatus(title, detail, color);
    panel.setSettings(settings);
    const live = !!state.input && settings.enabled && !!tasks;
    const busy = ["countdown", "capturing", "review", "loading"].includes(s);
    panel.setButtons({
      vanish: live && s === "ready" && !!state.background,
      appear: live && s === "vanished",
      background: !!state.input && settings.enabled && !busy && s !== "effect",
      backgroundLabel: state.background ? "Nuevo fondo" : "Capturar fondo",
    });
    panel.setHint(state.input
      ? "La llamada solo ve el video. Este panel es solo para ti."
      : "VanishCam se activa cuando enciendes la cámara en Meet.");
  }
  refresh();
})();
