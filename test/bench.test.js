import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchStats } from '../src/game/bench.js';

test('a steady 60 fps is SMOOTH with no hitches', () => {
  const s = benchStats(Array(1800).fill(16.67));
  assert.equal(s.avgFps, 60); assert.equal(s.low1Fps, 60); assert.equal(s.over33, 0); assert.equal(s.verdict, 'SMOOTH');
});

test('hitches pull the 1% low down and are counted', () => {
  const ms = Array(990).fill(16.67).concat(Array(10).fill(80));
  const s = benchStats(ms);
  assert.ok(s.avgFps > 55 && s.avgFps < 60);
  assert.equal(s.low1Fps, 12.5);
  assert.equal(s.over33, 10);
  assert.equal(s.worstMs, 80);
  assert.equal(s.verdict, 'PLAYABLE');
});

test('slow and empty inputs', () => {
  assert.equal(benchStats(Array(600).fill(40)).verdict, 'TOO SLOW');
  assert.equal(benchStats([]), null);
  assert.equal(benchStats([NaN, -1]), null);
});
