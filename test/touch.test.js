import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTouches, steerFromDrag, stickVector, ramp, emptyState, GEOMETRY } from '../src/game/touch.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('steer: deadzone, clamp at the lock, right is negative (keyboard A is +1)', () => {
  assert.equal(steerFromDrag(0), 0);
  assert.equal(steerFromDrag(GEOMETRY.steerDead), 0);
  assert.ok(steerFromDrag(40) < 0 && steerFromDrag(40) > -1);
  assert.equal(steerFromDrag(500), -1);
  assert.equal(steerFromDrag(-500), 1);
  assert.equal(steerFromDrag(NaN), 0);
});

test('stick: circular deadzone, unit disc, direction preserved', () => {
  assert.deepEqual(stickVector(5, 5), { x: 0, y: 0, mag: 0 });
  const v = stickVector(0, -200);
  near(v.x, 0); near(v.y, -1); near(v.mag, 1);
  const d = stickVector(30, 30);
  near(d.x, d.y); assert.ok(d.mag > 0 && d.mag < 1);
});

test('pedal ramp reaches the target and never overshoots', () => {
  let v = 0;
  for (let i = 0; i < 30; i++) v = ramp(v, 1, 1 / 60, GEOMETRY.rampUp, GEOMETRY.rampDown);
  assert.equal(v, 1);
  v = ramp(1, 0, 1, GEOMETRY.rampUp, GEOMETRY.rampDown);
  assert.equal(v, 0);
});

test('driving: gas ramps, brake ramps, release returns to zero, steer from the strip', () => {
  const s = emptyState();
  s.gas = true; s.steer.active = true; s.steer.dx = -GEOMETRY.steerLock;
  let r = mapTouches(s, GEOMETRY, 1 / 60);
  assert.ok(r.controls.throttle > 0 && r.controls.throttle < 1);
  assert.equal(r.controls.steer, 1);
  assert.equal(r.controls.active, true);
  for (let i = 0; i < 60; i++) r = mapTouches(s, GEOMETRY, 1 / 60, r.ramp);
  assert.equal(r.controls.throttle, 1);
  s.gas = false; s.steer.active = false;
  for (let i = 0; i < 60; i++) r = mapTouches(s, GEOMETRY, 1 / 60, r.ramp);
  assert.equal(r.controls.throttle, 0);
  assert.equal(r.controls.steer, 0);
  assert.equal(r.controls.active, false);
});

test('on foot: thumb up walks forward, thumb right strafes right (onfoot reads strafe = -steer)', () => {
  const s = emptyState(); s.mode = 'foot';
  s.stick.active = true; s.stick.dx = 0; s.stick.dy = -GEOMETRY.stickR;
  let r = mapTouches(s, GEOMETRY, 1 / 60);
  near(r.controls.throttle, 1); assert.equal(r.controls.brake, 0);
  s.stick.dx = GEOMETRY.stickR; s.stick.dy = 0;
  r = mapTouches(s, GEOMETRY, 1 / 60);
  near(r.controls.steer, -1);
  s.run = true;
  assert.equal(mapTouches(s, GEOMETRY, 1 / 60).controls.hold, true);
});

test('controls carry the same keys createInput().read() returns', () => {
  const c = mapTouches(emptyState()).controls;
  for (const k of ['throttle', 'brake', 'steer', 'handbrake', 'hold', 'nos', 'lookBack', 'analogue']) assert.ok(k in c, k);
});
