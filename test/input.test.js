import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadzone, axisToSteer, mergeDrive } from '../src/game/input.js';

test('deadzone zeroes the stick inside the hole and rescales outside', () => {
  assert.equal(deadzone(0, 0.14), 0);
  assert.equal(deadzone(0.1, 0.14), 0);
  assert.equal(deadzone(-0.1, 0.14), 0);
  assert.ok(deadzone(1, 0.14) > 0.99);
  assert.ok(deadzone(-1, 0.14) < -0.99);
  const half = deadzone(0.57, 0.14);
  assert.ok(half > 0.45 && half < 0.55);
});

test('left stick X maps to the same sign as keyboard A/D', () => {
  // keyboard A is steerTarget +1 (left). Stick left is axis -1.
  assert.ok(axisToSteer(-1) > 0.99);
  assert.ok(axisToSteer(1) < -0.99);
  assert.equal(axisToSteer(0.05), 0);
});

test('mergeDrive prefers analogue pad but never loses a full keyboard key', () => {
  const keysOnly = mergeDrive(
    { throttle: 1, brake: 0, steer: 1, handbrake: 1, hold: true },
    { throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: false },
  );
  assert.equal(keysOnly.throttle, 1);
  assert.equal(keysOnly.steer, 1);
  assert.equal(keysOnly.handbrake, 1);
  assert.equal(keysOnly.hold, true);
  assert.equal(keysOnly.analogue, false);

  const padOnly = mergeDrive(
    { throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: false },
    { throttle: 0.42, brake: 0.2, steer: -0.5, handbrake: 0.8, hold: true },
  );
  assert.equal(padOnly.throttle, 0.42);
  assert.equal(padOnly.brake, 0.2);
  assert.equal(padOnly.steer, -0.5);
  assert.ok(padOnly.handbrake > 0.7);
  assert.equal(padOnly.analogue, true);

  const both = mergeDrive(
    { throttle: 1, brake: 0, steer: 0, handbrake: 0, hold: false },
    { throttle: 0.3, brake: 0.9, steer: 0.4, handbrake: 0, hold: false },
  );
  assert.equal(both.throttle, 1);
  assert.equal(both.brake, 0.9);
  assert.equal(both.steer, 0.4);
});
