import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaitBlend, bestPhaseOffset, stepWeight, WALK_SPEED, RUN_SPEED } from '../src/game/gait.js';

const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

test('at the clips\' own speeds the blend is pure and plays at 1x', () => {
  const walk = gaitBlend(WALK_SPEED, 1.0, 0.7);
  assert.equal(walk.w, 0); assert.ok(near(walk.rate, 1)); assert.ok(near(walk.tsWalk, 1));
  const run = gaitBlend(RUN_SPEED, 1.0, 0.7);
  assert.equal(run.w, 1); assert.ok(near(run.rate, 1)); assert.ok(near(run.tsRun, 1));
});

test('the default 3.2 m/s jog is a real blend near 1x, not a 0.62x slow-motion sprint', () => {
  const g = gaitBlend(3.2, 1.0, 0.7);
  assert.ok(g.w > 0.3 && g.w < 0.5, `w ${g.w}`);
  assert.ok(g.rate > 0.95 && g.rate < 1.05, `rate ${g.rate}`);
  // both clips finish a cycle in the same time, so they can be phase-locked
  assert.ok(near(1.0 / g.tsWalk, 0.7 / g.tsRun, 1e-9));
});

test('rates are clamped at the extremes', () => {
  assert.equal(gaitBlend(0.5, 1, 0.7).rate, 0.55);
  assert.equal(gaitBlend(12, 1, 0.7).rate, 1.45);
});

test('phase offset finds the shift that lines the two cycles up', () => {
  const N = 32, cyc = (k, shift) => Array.from({ length: N }, (_, i) => {
    const a = Math.sin(((i + shift) / N) * Math.PI * 2) * 0.6;   // a thigh swinging about X
    return [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
  });
  assert.equal(bestPhaseOffset(cyc(0, 0), cyc(0, 0)), 0);
  assert.ok(near(bestPhaseOffset(cyc(0, 0), cyc(0, -8)), 8 / N));   // b lags a quarter cycle: add a quarter
  assert.equal(bestPhaseOffset([], []), 0);
});

test('weights move linearly over the fade, and a zero fade is immediate', () => {
  assert.ok(near(stepWeight(0, 1, 0.1, 0.2), 0.5));
  assert.equal(stepWeight(0.9, 1, 0.1, 0.2), 1);
  assert.ok(near(stepWeight(1, 0, 0.05, 0.2), 0.75));
  assert.equal(stepWeight(0, 1, 0.016, 0), 1);
});
