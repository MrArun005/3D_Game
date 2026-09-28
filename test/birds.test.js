import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleeRadius, threatened, pickRoost, flockLayout, skeinLayout } from '../src/world/birds.js';
import { mulberry32 } from '../src/core/rng.js';
import { PRESETS } from '../src/core/quality.js';

test('flee radius grows with speed and is capped', () => {
  assert.equal(fleeRadius(0), 5);
  assert.ok(fleeRadius(14) > fleeRadius(2));
  assert.equal(fleeRadius(100), fleeRadius(29));
  assert.ok(fleeRadius(100) <= 18.1);
});

test('a flock lifts for a car that a walker would not trigger at the same distance', () => {
  assert.equal(threatened(0, 0, [{ x: 9, z: 0, speed: 1.4 }]), false);   // walking, 9 m off
  assert.equal(threatened(0, 0, [{ x: 9, z: 0, speed: 14 }]), true);     // 50 km/h, 9 m off
  assert.equal(threatened(0, 0, [{ x: 3, z: 3, speed: 0 }]), true);      // standing 4.2 m off
  assert.equal(threatened(0, 0, [null, { x: 40, z: 0, speed: 30 }]), false);
});

test('roosts are seeded, in the ring, and only where ok() allows', () => {
  const ok = (x, z) => x > 0;   // only the east half is pavement
  const a = pickRoost(mulberry32(7), 100, 100, ok, 45, 130);
  const b = pickRoost(mulberry32(7), 100, 100, ok, 45, 130);
  assert.deepEqual(a, b);
  const d = Math.hypot(a.x - 100, a.z - 100);
  assert.ok(d >= 45 && d <= 130, `roost ${d.toFixed(1)} m out`);
  for (let s = 1; s < 40; s++) {
    const r = pickRoost(mulberry32(s), 0, 0, ok);
    if (r) assert.ok(r.x > 0);
  }
  assert.equal(pickRoost(mulberry32(1), 0, 0, () => false), null);
});

test('flock scatter is seeded and stays inside its radius; the skein is a V', () => {
  assert.deepEqual(flockLayout(mulberry32(3), 7), flockLayout(mulberry32(3), 7));
  for (const [x, z] of flockLayout(mulberry32(3), 50, 2.6)) assert.ok(Math.hypot(x, z) <= 2.6 + 1e-9);
  const v = skeinLayout(7);
  assert.deepEqual(v[0], [0, 0]);
  for (let i = 1; i < v.length; i += 2) {
    assert.equal(v[i][0], v[i + 1]?.[0] ?? v[i][0]);                     // pairs share a rank
    if (v[i + 1]) assert.equal(v[i][1], -v[i + 1][1]);                  // one each side
  }
});

test('every quality preset sizes the bird pool, phones smallest', () => {
  for (const [n, p] of Object.entries(PRESETS)) assert.ok(Number.isInteger(p.birds) && p.birds >= 0, n);
  assert.ok(PRESETS.mobile.birds < PRESETS.low.birds && PRESETS.low.birds <= PRESETS.high.birds);
});
