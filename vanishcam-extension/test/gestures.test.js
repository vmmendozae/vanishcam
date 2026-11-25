// node test/gestures.test.js
// Cases generated from the Python app (same landmark fixtures as its tests):
// the JS port must give exactly the same answers.
const assert = require("node:assert");
const g = require("../src/gestures.js");
const cases = require("./gesture_cases.json");

for (const c of cases) {
  const got = c.kind === "goku" ? g.fingersOnForehead(c.hands, c.faces, c.w, c.h)
    : c.kind === "naruto" ? g.joinedHands(c.hands, c.w, c.h)
    : g.victoryLandmarkScore(c.points);
  if (typeof got === "number") assert.ok(Math.abs(got - c.expected) < 1e-6, `${c.kind}: ${got} != ${c.expected}`);
  else assert.strictEqual(got, c.expected, c.kind);
}

// Trigger gate: V needs two readings; Goku needs the hold and blocks others;
// after any effect everything must be released first.
const gate = new g.TriggerGate("particles"), goku = new g.GokuGate(1);
const v = { goku: false, naruto: false, victory: 0.9 }, none = { goku: false, naruto: false, victory: 0 };
assert.strictEqual(gate.update(v, 0, goku), null);
assert.strictEqual(gate.update(v, 0.1, goku), "particles");
assert.strictEqual(gate.update(v, 0.2, goku), null);
assert.strictEqual(gate.update(none, 0.3, goku), null);
assert.strictEqual(gate.update(none, 0.7, goku), null);
const hold = { goku: true, naruto: true, victory: 0 };
const fired = [];
for (let t = 0.8; t < 2.0; t += 0.1) fired.push(gate.update(hold, +t.toFixed(2), goku));
assert.deepStrictEqual(fired.filter(Boolean), ["goku"]);

console.log(`OK: ${cases.length} casos iguales a Python + puerta de disparo`);
