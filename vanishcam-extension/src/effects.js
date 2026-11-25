// Effects ported from the Python app to canvas 2D: Goku teleport
// (goku_effect.py), Naruto substitution (naruto_effect.py) and wind-blown
// particles (particles_effect.py). Colours there are BGR; here they are RGB.
(function (root) {
  "use strict";

  const TELEPORT_SECONDS = 0.25;
  const SNAP_SECONDS = 0.045;
  const NARUTO_SECONDS = 1.45;
  const PARTICLE_SECONDS = 2.1;
  const BODY_SECONDS = 1.05;
  const MAX_PARTICLES = 1800;

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.uniform = (lo, hi) => lo + (hi - lo) * next();
    next.normal = (mean, sd) => {
      const u = Math.max(next(), 1e-12), v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return next;
  }

  // Segmenter confidence -> person alpha, as person_mask() does in Python.
  function maskToCanvas(mask, w, h) {
    const small = canvas(mask.width, mask.height);
    const sctx = small.getContext("2d");
    const image = sctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const a = Math.min(1, Math.max(0, (mask.data[i] - 0.12) / 0.68));
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = Math.round(a * 255);
    }
    sctx.putImageData(image, 0, 0);
    const full = canvas(w, h);
    const ctx = full.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${Math.max(1, Math.round(w / 440))}px)`;
    ctx.drawImage(small, 0, 0, w, h);
    return full;
  }

  // Bounding box of mask > threshold, in output pixels, or null.
  function maskBounds(mask, w, h, threshold) {
    let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (mask.data[y * mask.width + x] > threshold) {
          if (x < x1) x1 = x; if (x > x2) x2 = x;
          if (y < y1) y1 = y; if (y > y2) y2 = y;
        }
      }
    }
    if (x2 < 0) return null;
    const sx = w / mask.width, sy = h / mask.height;
    return { x: Math.floor(x1 * sx), y: Math.floor(y1 * sy),
             w: Math.ceil((x2 - x1 + 1) * sx), h: Math.ceil((y2 - y1 + 1) * sy) };
  }

  function personFraction(mask) {
    let n = 0;
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 0.5) n++;
    return n / mask.data.length;
  }

  function cutout(frame, maskCanvas, w, h) {
    const c = canvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(frame, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------- Goku
  class GokuTeleport {
    constructor(frame, background, mask, w, h) {
      this.w = w; this.h = h;
      const maskCanvas = maskToCanvas(mask, w, h);
      this.visible = canvas(w, h);
      const v = this.visible.getContext("2d");
      v.drawImage(background, 0, 0, w, h);
      v.drawImage(cutout(frame, maskCanvas, w, h), 0, 0);
      this.ghost = canvas(w, h);
      const g = this.ghost.getContext("2d");
      g.drawImage(background, 0, 0, w, h);
      // Light outline of the silhouette: a blurred ring around the mask.
      const ring = canvas(w, h);
      const r = ring.getContext("2d");
      r.filter = `blur(${Math.max(2, Math.round(w / 320))}px)`;
      r.drawImage(maskCanvas, 0, 0);
      r.filter = "none";
      r.globalCompositeOperation = "destination-out";
      r.drawImage(maskCanvas, 0, 0);
      r.globalCompositeOperation = "source-in";
      r.fillStyle = "rgb(42,67,78)";
      r.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      g.drawImage(ring, Math.round(5 * w / 960), 0);
      v.globalCompositeOperation = "lighter";
      v.globalAlpha = 0.6;
      v.drawImage(ring, 0, 0);

      this.streaks = [];
      const b = maskBounds(mask, w, h, 0.04);
      if (!b) return;
      const padX = Math.max(5, Math.round(b.w * 0.10)), padY = Math.max(5, Math.round(b.h * 0.18));
      this.area = [Math.max(0, b.x - padX), Math.max(0, b.y - padY),
                   Math.min(w, b.x + b.w + padX), Math.min(h, b.y + b.h + padY)];
      const rand = rng(1616);
      const count = Math.max(14, Math.min(38, Math.round(b.w / 12)));
      for (let i = 0; i < count; i++) {
        const center = b.x + (count === 1 ? 0 : (b.w - 1) * i / (count - 1));
        const lineX = Math.round(center + rand.uniform(-0.18, 0.18) * b.w / count);
        let startY = Math.round(b.y + b.h * rand.uniform(-0.12, 0.67));
        let length = Math.max(9, Math.round(b.h * rand.uniform(0.28, 0.80)));
        if (i % 5 === 0) {
          startY = Math.round(b.y - b.h * rand.uniform(0.08, 0.20));
          length = Math.round(b.h * rand.uniform(0.85, 1.10));
        }
        this.streaks.push([lineX, startY, length, i % 6 === 0 ? 2 : 1, i % 4 === 0]);
      }
    }

    render(ctx, background, age, appearing) {
      const { w, h } = this;
      if (age >= TELEPORT_SECONDS) {
        ctx.drawImage(appearing ? this.visible : background, 0, 0, w, h);
        return;
      }
      const base = appearing ? (age < SNAP_SECONDS ? this.ghost : this.visible)
                             : (age < SNAP_SECONDS ? this.visible : this.ghost);
      ctx.drawImage(base, 0, 0, w, h);
      if (!this.streaks.length) return;
      const strength = age < SNAP_SECONDS ? 0.72 + 0.28 * Math.max(0, age) / SNAP_SECONDS
        : Math.max(0, (TELEPORT_SECONDS - age) / (TELEPORT_SECONDS - SNAP_SECONDS));
      const [, top, , bottom] = this.area;
      const drift = Math.round((age / TELEPORT_SECONDS) * Math.min(18, (bottom - top) * 0.10));
      const dir = appearing ? -1 : 1;
      const scale = Math.max(1, w / 960);
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.lineCap = "round";
      const line = (x, y1, y2, color, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = width * scale;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
      };
      for (const [x, startY, length, thick, dark] of this.streaks) {
        const y = startY + dir * drift, end = y + length;
        if (dark) line(x, y, end, "rgb(52,45,42)", thick);
        else {
          line(x + 2 * scale, y + 3 * scale, end - 2 * scale, "rgb(69,64,62)", thick);
          line(x, y, end, "rgb(255,246,237)", thick);
        }
      }
      ctx.restore();
    }
  }

  // --------------------------------------------------------------- Naruto
  class NarutoSubstitution {
    constructor(frame, background, mask, log, w, h) {
      this.w = w; this.h = h; this.log = log;
      this.person = cutout(frame, maskToCanvas(mask, w, h), w, h);
      const b = maskBounds(mask, w, h, 0.45);
      if (!b) {
        this.anchor = [w / 2, h / 2, Math.round(h * 0.57)];
      } else {
        const size = Math.round(Math.min(h * 0.70, Math.max(h * 0.24, b.h * 0.58)));
        const cx = Math.round(Math.min(w - size / 3, Math.max(size / 3, b.x + b.w * 0.5)));
        const cy = Math.round(Math.min(h - size / 3, Math.max(size / 3, b.y + b.h * 0.52)));
        this.anchor = [cx, cy, size];
      }
      this.layer = canvas(w, h);
    }

    landed() {
      const [cx, cy, size] = this.anchor;
      return [cx, Math.max(cy, this.h - Math.round(size * 0.48)), size];
    }

    falling(age) {
      const [cx, cy, size] = this.anchor;
      const floorY = this.landed()[1];
      const distance = floorY - cy;
      if (distance <= 0 || age <= 0.18) return this.anchor;
      const elapsed = age - 0.18, gravity = this.h * 3.2;
      const fall = gravity * elapsed * elapsed * 0.5;
      if (fall < distance) return [cx, cy + Math.round(fall), size];
      const bounceAge = elapsed - Math.sqrt(2 * distance / gravity);
      const bounce = size * 0.075 * Math.exp(-5 * bounceAge) * Math.abs(Math.sin(11 * bounceAge));
      return [cx, floorY - Math.round(bounce), size];
    }

    drawLog(ctx, anchor, opacity = 1, scale = 1) {
      if (opacity <= 0 || !this.log || !this.log.width) return;
      const [cx, cy, size] = anchor;
      const height = Math.max(1, size * scale);
      const width = height * this.log.width / this.log.height;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(this.log, cx - width / 2, cy - height / 2, width, height);
      ctx.restore();
    }

    smoke(ctx, age, foreground) {
      if (age >= NARUTO_SECONDS) return;
      const reveal = Math.min(1, age / 0.16);
      const fade = Math.max(0, 1 - Math.max(0, age - 0.33) / 1.12);
      if (fade <= 0) return;
      const [cx, cy, size] = this.anchor;
      const rand = rng(foreground ? 9127 : 1934);
      const l = this.layer.getContext("2d");
      l.clearRect(0, 0, this.w, this.h);
      l.fillStyle = foreground ? "rgb(235,235,229)" : "rgb(166,162,152)";
      const radius = size * (0.27 + 0.54 * Math.min(age, 1));
      for (let i = 0; i < (foreground ? 22 : 18); i++) {
        const angle = rand.uniform(0, 2 * Math.PI);
        const d = radius * rand.uniform(0.25, 1.0);
        const x = cx + Math.cos(angle) * d;
        const y = cy + Math.sin(angle) * d * 0.63 - age * size * 0.13;
        const puff = Math.max(2, size * rand.uniform(0.09, 0.20) * (0.7 + age * 0.7));
        const tilt = rand.uniform(-25, 25) * Math.PI / 180;
        l.beginPath();
        l.ellipse(x, y, puff, puff * 0.68, tilt, 0, 2 * Math.PI);
        l.fill();
      }
      l.strokeStyle = "rgb(245,247,244)";
      l.lineWidth = Math.max(2, size * 0.025);
      for (const dir of [-1, 1]) {
        l.beginPath();
        l.ellipse(cx + dir * size * 0.13, cy - size * 0.13 - age * size * 0.09,
                  Math.max(2, size * (0.30 + age * 0.27)), Math.max(2, size * (0.09 + age * 0.12)),
                  dir * 15 * Math.PI / 180, 20 * Math.PI / 180, 230 * Math.PI / 180);
        l.stroke();
      }
      ctx.save();
      ctx.globalAlpha = (foreground ? 190 : 125) / 255 * reveal * fade;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }

    render(ctx, background, age) {
      const { w, h } = this;
      ctx.drawImage(background, 0, 0, w, h);
      if (age >= NARUTO_SECONDS) { this.drawLog(ctx, this.landed()); return; }
      if (age < 0.13) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 0.13);
        ctx.drawImage(this.person, 0, 0);
        ctx.restore();
      }
      this.smoke(ctx, age, false);
      this.drawLog(ctx, this.falling(age), Math.min(1, Math.max(0, (age - 0.05) / 0.15)),
                   1.15 - Math.min(age, 0.25) * 0.6);
      this.smoke(ctx, age, true);
    }
  }

  // ------------------------------------------------------------ Particles
  class ParticleEffect {
    constructor(frame, mask, w, h, seed = 4242) {
      this.w = w; this.h = h;
      const b = maskBounds(mask, w, h, 0.02);
      if (!b) { this.bounds = null; return; }
      b.w = Math.min(b.w, w - b.x); b.h = Math.min(b.h, h - b.y);
      this.bounds = b;
      const rand = rng(seed);
      const maskCanvas = maskToCanvas(mask, w, h);
      const fctx = canvas(w, h).getContext("2d", { willReadFrequently: true });
      fctx.drawImage(frame, 0, 0, w, h);
      this.person = fctx.getImageData(b.x, b.y, b.w, b.h);
      const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
      const alpha = mctx.getImageData(b.x, b.y, b.w, b.h).data;
      const n = b.w * b.h;
      this.mask = new Float32Array(n);
      for (let i = 0; i < n; i++) this.mask[i] = alpha[i * 4 + 3] / 255;

      // Erosion front: left-to-right plus smooth noise.
      const gw = Math.max(2, Math.floor(b.w / 18)), gh = Math.max(2, Math.floor(b.h / 18));
      const grid = Float32Array.from({ length: gw * gh }, () => rand());
      this.field = new Float32Array(n);
      for (let y = 0; y < b.h; y++) {
        const gy = (y / Math.max(1, b.h - 1)) * (gh - 1), y0 = Math.floor(gy), y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0;
        for (let x = 0; x < b.w; x++) {
          const gx = (x / Math.max(1, b.w - 1)) * (gw - 1), x0 = Math.floor(gx), x1 = Math.min(gw - 1, x0 + 1), fx = gx - x0;
          const noise = (grid[y0 * gw + x0] * (1 - fx) + grid[y0 * gw + x1] * fx) * (1 - fy)
                      + (grid[y1 * gw + x0] * (1 - fx) + grid[y1 * gw + x1] * fx) * fy;
          this.field[y * b.w + x] = Math.min(1, Math.max(0, x / Math.max(1, b.w - 1) + (noise - 0.5) * 0.16));
        }
      }
      this.body = canvas(b.w, b.h);
      this.bodyImage = this.body.getContext("2d").createImageData(b.w, b.h);

      const candidates = [];
      for (let i = 0; i < n; i++) if (this.mask[i] > 0.45) candidates.push(i);
      const count = Math.min(MAX_PARTICLES, Math.max(90, Math.floor(candidates.length / 80)), candidates.length);
      for (let i = candidates.length - 1; i > 0 && candidates.length - i <= count; i--) {
        const j = Math.floor(rand() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      const chosen = candidates.slice(candidates.length - count);
      const sx = w / 960, sy = h / 540;
      this.particles = chosen.map((i) => {
        const px = i % b.w, py = Math.floor(i / b.w);
        let r = this.person.data[i * 4], g = this.person.data[i * 4 + 1], bl = this.person.data[i * 4 + 2];
        if (rand() < 0.20) { r = r * 0.55 + 166 * 0.45; g = g * 0.55 + 229 * 0.45; bl = bl * 0.55 + 255 * 0.45; }
        const roll = rand();
        return {
          x: b.x + px, y: b.y + py, color: `rgb(${r | 0},${g | 0},${bl | 0})`,
          release: Math.min(BODY_SECONDS, Math.max(0, (px / Math.max(b.w - 1, 1)) * BODY_SECONDS + rand.normal(0, 0.075))),
          vx: rand.uniform(200, 420) * sx, vy: -rand.uniform(15, 115) * sy,
          ax: rand.uniform(70, 180) * sx, sway: rand.uniform(3, 18) * sy,
          phase: rand.uniform(0, 6.28), life: rand.uniform(0.65, 1.15),
          radius: (roll < 0.48 ? 1 : roll < 0.90 ? 2 : 3) * Math.max(1, w / 960),
        };
      });
    }

    render(ctx, background, age) {
      const { w, h } = this;
      ctx.drawImage(background, 0, 0, w, h);
      if (!this.bounds || age >= PARTICLE_SECONDS) return;
      const b = this.bounds, front = Math.max(0, age / BODY_SECONDS);
      if (front < 1.08) {
        const out = this.bodyImage.data, src = this.person.data;
        for (let i = 0; i < this.mask.length; i++) {
          const f = this.field[i];
          const survival = Math.min(1, Math.max(0, (f - front) * 13 + 0.5));
          const edge = Math.abs(f - front) < 0.025 && this.mask[i] > 0.45;
          const o = i * 4;
          out[o] = Math.min(255, src[o] + (edge ? 12 : 0));
          out[o + 1] = Math.min(255, src[o + 1] + (edge ? 32 : 0));
          out[o + 2] = Math.min(255, src[o + 2] + (edge ? 45 : 0));
          out[o + 3] = this.mask[i] * survival * 255;
        }
        this.body.getContext("2d").putImageData(this.bodyImage, 0, 0);
        ctx.drawImage(this.body, b.x, b.y);
      }
      const ending = Math.min(1, Math.max(0, (PARTICLE_SECONDS - age) / 0.35));
      ctx.save();
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const t = age - p.release;
        if (t < 0 || t >= p.life) continue;
        const x = p.x + p.vx * t + 0.5 * p.ax * t * t;
        const y = p.y + p.vy * t + p.sway * Math.sin(p.phase + t * 9) * t;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        ctx.globalAlpha = Math.min(1, Math.max(0, (p.life - t) / 0.28)) * ending;
        ctx.fillStyle = p.color;
        if (p.radius > 1 && i % 5 === 0) {
          ctx.strokeStyle = p.color; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(Math.max(0, x - p.radius * 3), y + 1); ctx.lineTo(x, y); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y, p.radius, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.restore();
    }
  }

  root.VanishCam = Object.assign(root.VanishCam || {}, {
    effects: {
      TELEPORT_SECONDS, NARUTO_SECONDS, PARTICLE_SECONDS, canvas, maskBounds, personFraction,
      GokuTeleport, NarutoSubstitution, ParticleEffect,
    },
  });
})(globalThis);
