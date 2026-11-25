// Gesture logic ported from the Python app (goku_effect.py, naruto_effect.py,
// vanish_cam.py victory_landmark_score, auto_gestures.py). Pure functions, so
// they can be unit-tested in Node. Landmarks are {x, y, z?} normalised to 0..1;
// face boxes are [x, y, width, height] in pixels.
(function (root) {
  "use strict";

  const HOLD_SECONDS = 1.0;
  const TRACKING_GRACE_SECONDS = 0.25;
  const VICTORY_MIN_SCORE = 0.62;
  const STREAK_TO_FIRE = 2;
  const RELEASE_SECONDS = 0.35;

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)];
  const norm = (v) => Math.hypot(v[0], v[1], v[2] || 0);
  const dist = (a, b) => norm(sub(a, b));
  const toPixels = (hand, w, h) => hand.map((p) => [p.x * w, p.y * h, 0]);
  const finite = (pts) => pts.every((p) => p.every(Number.isFinite));

  function fingerStraight(points, joints) {
    let length = 0;
    for (let i = 0; i < joints.length - 1; i++) length += dist(points[joints[i + 1]], points[joints[i]]);
    return length > 1e-6 && dist(points[joints[joints.length - 1]], points[joints[0]]) / length > 0.76;
  }

  // Goku: index and middle fingertips together on the forehead.
  function fingersOnForehead(hands, faces, w, h) {
    if (!faces.length || !hands.length) return false;
    for (const hand of hands) {
      if (hand.length !== 21) continue;
      const p = toPixels(hand, w, h);
      if (!finite(p)) continue;
      const palm = Math.max(dist(p[5], p[17]), dist(p[0], p[9]));
      if (palm < 10) continue;
      if (!(fingerStraight(p, [5, 6, 7, 8]) && fingerStraight(p, [9, 10, 11, 12]))) continue;
      if (fingerStraight(p, [13, 14, 15, 16]) || fingerStraight(p, [17, 18, 19, 20])) continue;
      if (dist(p[8], p[12]) > palm * 0.52) continue;
      const a = sub(p[8], p[5]), b = sub(p[12], p[9]);
      const alignment = (a[0] * b[0] + a[1] * b[1]) / Math.max(norm(a) * norm(b), 1e-6);
      if (alignment < 0.75) continue;
      for (const [x, y, fw, fh] of faces) {
        if (fw < 30 || fh < 30) continue;
        const left = x - 0.18 * fw, right = x + 1.18 * fw;
        const top = y - 0.16 * fh, bottom = y + 0.46 * fh;
        const inside = [p[8], p[12]].every((t) => t[0] >= left && t[0] <= right && t[1] >= top && t[1] <= bottom);
        if (inside) return true;
      }
    }
    return false;
  }

  // Naruto: two nearby, similarly oriented open hands.
  function joinedHands(hands, w, h) {
    if (hands.length < 2) return false;
    const pts = hands.slice(0, 2).filter((hand) => hand.length === 21).map((hand) => toPixels(hand, w, h));
    if (pts.length !== 2 || !pts.every(finite)) return false;
    const mean = (p, idx) => {
      const s = [0, 0];
      idx.forEach((i) => { s[0] += p[i][0]; s[1] += p[i][1]; });
      return [s[0] / idx.length, s[1] / idx.length, 0];
    };
    const palms = pts.map((p) => mean(p, [0, 5, 9, 13, 17]));
    const scale = pts.map((p) => Math.max(dist(p[5], p[17]), dist(p[0], p[9])));
    if (Math.min(...scale) < 8 || Math.max(...scale) > Math.min(...scale) * 2.2) return false;
    const size = (scale[0] + scale[1]) * 0.5;
    const d = pts.map((p) => sub(p[9], p[0]));
    const alignment = (d[0][0] * d[1][0] + d[0][1] * d[1][1]) / Math.max(1e-6, norm(d[0]) * norm(d[1]));
    const tips = pts.map((p) => mean(p, [8, 12, 16, 20]));
    return alignment > 0.25 && dist(palms[0], palms[1]) < size * 1.55 && dist(tips[0], tips[1]) < size * 1.9;
  }

  // V sign geometry from 21 points [x, y, z]. Returns 0 or a quality 0..1.
  function victoryLandmarkScore(points) {
    if (points.length !== 21 || !finite(points)) return 0;
    const straightness = [], extended = [], folded = [], lengths = [];
    [5, 9, 13, 17].forEach((base, index) => {
      const finger = points.slice(base, base + 4);
      let length = 0;
      for (let i = 0; i < 3; i++) length += dist(finger[i + 1], finger[i]);
      if (length < 1e-6) {
        straightness.push(0); lengths.push(0); extended.push(false); folded.push(true);
        if (index < 2) straightness[index] = -1;
        return;
      }
      const ratio = dist(finger[3], finger[0]) / length;
      const tip = dist(finger[3], points[0]);
      const joint = dist(finger[1], points[0]);
      straightness.push(ratio); lengths.push(length);
      extended.push(ratio >= 0.82 && tip > joint * 1.10);
      folded.push(ratio < 0.78 || tip <= joint * 1.05);
    });
    if (straightness[0] === -1 || straightness[1] === -1) return 0;
    const reference = Math.min(lengths[0], lengths[1]);
    [[2, 13], [3, 17]].forEach(([index, base]) => {
      folded[index] = folded[index] || dist(points[base + 3], points[base]) < reference * 0.65;
    });
    if (!(extended[0] && extended[1] && folded[2] && folded[3])) return 0;
    if (dist(points[8], points[12]) < reference * 0.20) return 0;
    return Math.max(0, Math.min(1, Math.min(straightness[0], straightness[1])));
  }

  function victoryScore(hands, worldHands, w, h) {
    for (const hand of worldHands || []) {
      const s = victoryLandmarkScore(hand.map((p) => [p.x, p.y, p.z || 0]));
      if (s) return s;
    }
    for (const hand of hands) {
      const s = victoryLandmarkScore(toPixels(hand, w, h));
      if (s) return s;
    }
    return 0;
  }

  function nearForehead(hands, faces, w, h) {
    for (const hand of hands) {
      if (hand.length !== 21) continue;
      const tx = hand[8].x * w, ty = hand[8].y * h;
      for (const [x, y, fw, fh] of faces) {
        if (tx >= x - fw * 0.5 && tx <= x + fw * 1.5 && ty <= y + fh) return true;
      }
    }
    return false;
  }

  // One frame of readings. `wanted` limits the checks to the gestures the
  // selected mode can use.
  function classify(hands, worldHands, faces, w, h, wanted) {
    const reading = { goku: false, naruto: false, victory: 0, hands: hands.length, faces: faces.length };
    if (wanted.goku) reading.goku = faces.length > 0 && fingersOnForehead(hands, faces, w, h);
    const joined = joinedHands(hands, w, h);
    if (wanted.naruto) reading.naruto = joined;
    if (wanted.victory && !reading.goku && !joined && !nearForehead(hands, faces, w, h)) {
      reading.victory = victoryScore(hands, worldHands, w, h);
    }
    return reading;
  }

  const isActive = (r) => r.goku || r.naruto || r.victory >= VICTORY_MIN_SCORE;

  class GokuGate {
    constructor(holdSeconds = HOLD_SECONDS) { this.holdSeconds = holdSeconds; this.reset(); }
    reset() { this.armed = true; this.holdStarted = null; this.lastSeen = null; this.releaseStarted = null; }
    update(pose, now) {
      if (!pose) {
        if (this.releaseStarted === null) this.releaseStarted = now;
        if (now - this.releaseStarted >= 0.35) this.armed = true;
        if (this.lastSeen === null || now - this.lastSeen > TRACKING_GRACE_SECONDS) this.holdStarted = null;
        return false;
      }
      this.releaseStarted = null;
      if (!this.armed) return false;
      if (this.lastSeen !== null && now - this.lastSeen > TRACKING_GRACE_SECONDS) this.holdStarted = null;
      if (this.holdStarted === null) this.holdStarted = now;
      this.lastSeen = now;
      if (now < this.holdStarted + this.holdSeconds) return false;
      this.armed = false;
      this.holdStarted = null;
      return true;
    }
  }

  // Readings -> effect name, with a release required between triggers.
  class TriggerGate {
    constructor(vEffect = "particles") { this.vEffect = vEffect; this.armed = true; this.clearSince = null; this.streaks = {}; }
    disarm() { this.armed = false; this.clearSince = null; this.streaks = {}; }
    update(reading, now, gokuGate) {
      if (!this.armed) {
        if (isActive(reading)) { this.clearSince = null; gokuGate.update(false, now); return null; }
        if (this.clearSince === null) this.clearSince = now;
        if (now - this.clearSince < RELEASE_SECONDS) { gokuGate.update(false, now); return null; }
        this.armed = true;
      }
      if (gokuGate.update(reading.goku, now)) { this.disarm(); return "goku"; }
      const candidates = [["naruto", reading.naruto], [this.vEffect, reading.victory >= VICTORY_MIN_SCORE]];
      for (const [name, active] of candidates) this.streaks[name] = active ? (this.streaks[name] || 0) + 1 : 0;
      if (gokuGate.holdStarted !== null) return null;
      for (const [name] of candidates) {
        if ((this.streaks[name] || 0) >= STREAK_TO_FIRE) { this.disarm(); return name; }
      }
      return null;
    }
  }

  const api = {
    HOLD_SECONDS, VICTORY_MIN_SCORE, fingersOnForehead, joinedHands, victoryLandmarkScore,
    victoryScore, nearForehead, classify, isActive, GokuGate, TriggerGate,
  };
  root.VanishCam = Object.assign(root.VanishCam || {}, { gestures: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
