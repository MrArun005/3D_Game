import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerpPose, lerpAngle, copyPose } from '../src/vehicle/interp.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('alpha 0 and 1 are identities', () => {
  const prev = { x: 1, y: 0, z: 2, yaw: 0.5, heave: 0.1, roll: 0.01, pitch: -0.02 };
  const cur = { x: 1.2, y: 0, z: 2.3, yaw: 0.6, heave: 0.12, roll: 0.02, pitch: -0.01 };
  assert.deepEqual(lerpPose(prev, cur, 0), copyPose({}, prev));
  assert.deepEqual(lerpPose(prev, cur, 1), copyPose({}, cur));
  // out of range clamps rather than extrapolating (the guard can leave alpha > 1)
  assert.deepEqual(lerpPose(prev, cur, 1.7), copyPose({}, cur));
  assert.deepEqual(lerpPose(prev, cur, -0.3), copyPose({}, prev));
});

test('midpoint is linear for positions', () => {
  const out = lerpPose({ x: 0, z: 0, yaw: 0 }, { x: 2, z: 4, yaw: 0 }, 0.5);
  near(out.x, 1); near(out.z, 2); near(out.heave, 0);
});

test('angles take the shortest arc across the wrap', () => {
  near(lerpAngle(3.1, -3.1, 0.5), Math.PI, 1e-6);   // 3.1 -> pi -> -3.1, not through 0
  near(lerpAngle(-3.1, 3.1, 0.5), -Math.PI, 1e-6);
  near(lerpAngle(0.1, 0.3, 0.5), 0.2);
  const out = lerpPose({ x: 0, z: 0, yaw: 3.1 }, { x: 0.1, z: 0, yaw: -3.1 }, 0.25);
  near(out.yaw, 3.1 + 0.25 * (2 * Math.PI - 6.2), 1e-6);
});

test('a teleport snaps instead of streaking', () => {
  const out = lerpPose({ x: 0, z: 0, yaw: 0 }, { x: 800, z: 300, yaw: 1 }, 0.3);
  assert.equal(out.x, 800); assert.equal(out.z, 300); assert.equal(out.yaw, 1);
});

test('reuses the out record, no allocation per call', () => {
  const out = {};
  const r = lerpPose({ x: 0, z: 0 }, { x: 1, z: 1 }, 0.5, out);
  assert.equal(r, out);
});
