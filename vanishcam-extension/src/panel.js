// Floating control panel inside Meet (shadow DOM, so Meet's CSS and ours never
// mix). It is page UI, not part of the video: nobody in the call sees it.
(function (root) {
  "use strict";

  const MODES = [
    ["auto", "Auto"], ["goku", "Goku"], ["naruto", "Naruto"], ["particles", "Partículas"],
  ];

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: "Google Sans", Roboto, system-ui, sans-serif; }
  .panel { position: fixed; z-index: 2147483646; width: 300px; color: #e8eaed;
    background: #202124; border: 1px solid #3c4043; border-radius: 14px;
    box-shadow: 0 8px 28px rgba(0,0,0,.45); overflow: hidden; font-size: 13px; }
  .panel[hidden] { display: none; }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    cursor: grab; user-select: none; background: #292a2d; }
  header:active { cursor: grabbing; }
  header b { font-size: 14px; letter-spacing: .3px; flex: 1; }
  header small { color: #9aa0a6; font-size: 11px; }
  .icon { background: none; border: 0; color: #9aa0a6; font-size: 16px; cursor: pointer;
    width: 26px; height: 26px; border-radius: 50%; }
  .icon:hover { background: #3c4043; color: #fff; }
  .body { padding: 12px; display: grid; gap: 12px; }
  .status { border-radius: 10px; padding: 12px; text-align: center; color: #fff;
    background: #5f6368; transition: background .2s; }
  .status .title { font-size: 17px; font-weight: 700; letter-spacing: .3px; }
  .status .detail { font-size: 12px; margin-top: 4px; opacity: .95; min-height: 15px; }
  .status.red { background: #c5221f; } .status.green { background: #188038; }
  .status.blue { background: #1967d2; } .status.amber { background: #e37400; }
  .status.gray { background: #5f6368; }
  .label { color: #9aa0a6; font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
    margin-bottom: 6px; }
  .seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  button.opt, button.act { border: 1px solid #5f6368; background: #303134; color: #e8eaed;
    border-radius: 8px; padding: 8px 4px; font-size: 12px; cursor: pointer; }
  button.opt:hover, button.act:hover { background: #3c4043; }
  button.opt.on { background: #8ab4f8; border-color: #8ab4f8; color: #202124; font-weight: 700; }
  button:disabled { opacity: .45; cursor: default; }
  .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .acts .wide { grid-column: 1 / -1; }
  button.primary { background: #8ab4f8; border-color: #8ab4f8; color: #202124; font-weight: 700; }
  button.primary:hover { background: #aecbfa; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  select { background: #303134; color: #e8eaed; border: 1px solid #5f6368; border-radius: 6px;
    padding: 4px 6px; font-size: 12px; }
  .switch { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .switch input { accent-color: #8ab4f8; width: 16px; height: 16px; }
  .preview { display: grid; gap: 6px; }
  .preview[hidden], .controls[hidden] { display: none; }
  .preview img { width: 100%; border-radius: 8px; border: 1px solid #3c4043; display: block; }
  .note { font-size: 12px; padding: 6px 8px; border-radius: 6px; }
  .note.ok { background: rgba(24,128,56,.25); color: #81c995; }
  .note.bad { background: rgba(197,34,31,.25); color: #f28b82; }
  .hint { color: #9aa0a6; font-size: 11px; line-height: 1.4; }
  `;

  class Panel {
    constructor(handlers) {
      this.handlers = handlers;
      this.host = document.createElement("vanishcam-panel");
      const shadow = this.host.attachShadow({ mode: "closed" });
      shadow.innerHTML = `<style>${CSS}</style>
      <div class="panel" hidden>
        <header>
          <b>VanishCam</b><small>no sale en la llamada</small>
          <button class="icon" data-act="hide" title="Ocultar (vuelve con el icono de la extension)">×</button>
        </header>
        <div class="body">
          <div class="status gray"><div class="title">Esperando la cámara</div>
            <div class="detail">Activa la cámara en Meet</div></div>
          <div class="preview" hidden>
            <img alt="Fondo capturado">
            <div class="note"></div>
            <div class="acts"><button class="act" data-act="retry">Repetir</button>
              <button class="act primary" data-act="accept">Listo, empezar</button></div>
          </div>
          <div class="controls">
            <div class="label">Efecto</div>
            <div class="seg">${MODES.map(([id, name]) =>
              `<button class="opt" data-mode="${id}">${name}</button>`).join("")}</div>
          </div>
          <div class="acts controls">
            <button class="act" data-act="vanish">Desaparecer</button>
            <button class="act" data-act="appear">Reaparecer</button>
            <button class="act wide" data-act="background">Capturar fondo</button>
          </div>
          <div class="row">
            <label class="switch"><input type="checkbox" data-act="enabled" checked> Efectos activos</label>
            <span>Goku <select data-act="delay">
              <option value="0.5">0,5 s</option><option value="1">1 s</option>
              <option value="1.5">1,5 s</option><option value="2">2 s</option></select></span>
          </div>
          <div class="hint"></div>
        </div>
      </div>`;
      this.el = shadow.querySelector(".panel");
      this.statusEl = shadow.querySelector(".status");
      this.hintEl = shadow.querySelector(".hint");
      this.previewEl = shadow.querySelector(".preview");
      this.modeButtons = [...shadow.querySelectorAll("[data-mode]")];
      this.actionButtons = Object.fromEntries(
        [...shadow.querySelectorAll("button[data-act]")].map((b) => [b.dataset.act, b]));
      this.enabledEl = shadow.querySelector('[data-act="enabled"]');
      this.delayEl = shadow.querySelector('[data-act="delay"]');

      shadow.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.dataset.mode) handlers.onMode(target.dataset.mode);
        else if (target.dataset.act === "hide") this.setVisible(false);
        else if (target.dataset.act) handlers.onAction(target.dataset.act);
      });
      this.enabledEl.addEventListener("change", () => handlers.onEnabled(this.enabledEl.checked));
      this.delayEl.addEventListener("change", () => handlers.onDelay(Number(this.delayEl.value)));
      this.makeDraggable(shadow.querySelector("header"));
      this.position = { left: 24, top: 96 };
      this.applyPosition();
      const attach = () => (document.body || document.documentElement).appendChild(this.host);
      if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach, { once: true });
    }

    makeDraggable(handle) {
      let start = null;
      handle.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        start = { x: e.clientX, y: e.clientY, ...this.position };
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", (e) => {
        if (!start) return;
        this.position = {
          left: Math.max(0, Math.min(innerWidth - 120, start.left + e.clientX - start.x)),
          top: Math.max(0, Math.min(innerHeight - 60, start.top + e.clientY - start.y)),
        };
        this.applyPosition();
      });
      handle.addEventListener("pointerup", () => {
        if (start) this.handlers.onMoved(this.position);
        start = null;
      });
    }

    applyPosition() {
      this.el.style.left = this.position.left + "px";
      this.el.style.top = this.position.top + "px";
    }

    setPosition(position) { if (position) { this.position = position; this.applyPosition(); } }
    setVisible(visible) { this.el.hidden = !visible; }
    toggle() { this.setVisible(this.el.hidden); }

    setStatus(title, detail, color) {
      this.statusEl.className = "status " + color;
      this.statusEl.querySelector(".title").textContent = title;
      this.statusEl.querySelector(".detail").textContent = detail || "";
    }

    setHint(text) { this.hintEl.textContent = text; }

    setSettings({ mode, enabled, gokuDelay }) {
      this.modeButtons.forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
      this.enabledEl.checked = enabled;
      this.delayEl.value = String(gokuDelay);
    }

    setButtons({ vanish, appear, background, backgroundLabel }) {
      this.actionButtons.vanish.disabled = !vanish;
      this.actionButtons.appear.disabled = !appear;
      this.actionButtons.background.disabled = !background;
      this.actionButtons.background.textContent = backgroundLabel;
    }

    showReview(dataUrl, personShare) {
      this.previewEl.hidden = !dataUrl;
      this.el.querySelectorAll(".controls").forEach((c) => { c.hidden = !!dataUrl; });
      if (!dataUrl) return;
      this.previewEl.querySelector("img").src = dataUrl;
      const note = this.previewEl.querySelector(".note");
      const clean = personShare <= 0.03;
      note.className = "note " + (clean ? "ok" : "bad");
      note.textContent = clean ? "Fondo limpio. Ya puedes volver a tu lugar."
        : "Parece que todavía apareces en la imagen. Repite la captura.";
    }
  }

  root.VanishCam = Object.assign(root.VanishCam || {}, { Panel, MODES });
})(globalThis);
