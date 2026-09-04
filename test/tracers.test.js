import test from 'node:test';
import assert from 'node:assert/strict';
import { streakAt, SPEED, STREAK } from '../src/game/tracers.js';

test('a streak leaves the muzzle, runs at SPEED with a STREAK-long tail, and dies past the target', () => {
  assert.deepEqual(streakAt(0, 40), { head: 0, tail: 0 });
  const mid = streakAt(0.05, 40);
  assert.ok(Math.abs(mid.head - SPEED * 0.05) < 1e-9 && Math.abs(mid.head - mid.tail - STREAK) < 1e-9);
  const late = streakAt(40 / SPEED + 0.001, 40);
  assert.equal(late.head, 40, 'the head stops at the target');
  assert.ok(late.tail < 40 && late.tail > 40 - STREAK, 'the tail is still catching up');
  assert.equal(streakAt((40 + STREAK) / SPEED + 0.001, 40), null, 'gone once the tail passes the target');
});

test('a point-blank round is a streak that is over almost at once', () => {
  assert.ok(streakAt(0.001, 2));
  assert.equal(streakAt(0.05, 2), null);
});
