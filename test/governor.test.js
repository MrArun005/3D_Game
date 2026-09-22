import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, MIN, MAX } from '../src/core/governor.js';

const run = (g, ms, frames) => { let r; for (let i = 0; i < frames; i++) r = g.step(ms); return r; };

test('a slow GPU drops resolution, never below MIN', () => {
  const g = createGovernor();
  run(g, 40, 2000);
  assert.equal(g.scale, MIN);
});

test('a fast GPU stays at MAX', () => {
  const g = createGovernor();
  run(g, 8, 2000);
  assert.equal(g.scale, MAX);
});

test('recovers once the load goes away, and waits after a drop before climbing', () => {
  const g = createGovernor();
  run(g, 30, 45);                  // one window: one drop
  const low = g.scale;
  assert.ok(low < MAX);
  run(g, 8, 90);                   // inside the ~3 s cool-down: no climb yet
  assert.equal(g.scale, low);
  run(g, 8, 3000);
  assert.equal(g.scale, MAX);
});

test('gives up exactly once when still slow at MIN', () => {
  const g = createGovernor();
  let ups = 0;
  for (let i = 0; i < 5000; i++) if (g.step(60).giveUp) ups++;
  assert.equal(ups, 1);
});

test('one huge spike does not move it', () => {
  const g = createGovernor();
  g.step(5000);
  run(g, 10, 44);
  assert.equal(g.scale, MAX);
});
