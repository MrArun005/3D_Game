import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inView } from '../src/game/traffic.js';

const cam = { x: 0, z: 0, fx: 1, fz: 0 };   // looking down +X

test('ahead and in range is in view; behind, beside at range, or far is not', () => {
  assert.equal(inView(100, 0, cam), true);
  assert.equal(inView(-100, 0, cam), false, 'behind');
  assert.equal(inView(0, 100, cam), false, 'square to the side');
  assert.equal(inView(500, 0, cam), false, 'too far to notice');
  assert.equal(inView(-5, 5, cam), true, 'right beside the lens counts as seen');
});

test('no camera yet means nothing is in view', () => {
  assert.equal(inView(10, 0, null), false);
});
