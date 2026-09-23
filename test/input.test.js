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

import { padControls, createInput, PAD_CAR, PAD_FOOT } from '../src/game/input.js';
import { nearestInDirection } from '../src/ui/padnav.js';

// a standard-mapping DualSense at rest; press(i, v) holds button i
function fakePad() {
  const p = { mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
  p.press = (i, v = 1) => { p.buttons[i] = { pressed: v > 0.5, value: v }; return p; };
  return p;
}

test('in the car the triggers drive and Cross is the handbrake', () => {
  const s = padControls(fakePad().press(7, 0.8).press(6, 0.3).press(0).press(5), false);
  assert.equal(s.throttle, 0.8);
  assert.equal(s.brake, 0.3);
  assert.equal(s.handbrake, 1);
  assert.equal(s.fire, true);            // R1: the drive-by
  assert.equal(s.aim, false);
});

test('on foot the left stick walks and the triggers shoot instead of driving', () => {
  const p = fakePad().press(7).press(6).press(2).press(0);
  p.axes[1] = -1;                        // stick up
  const s = padControls(p, true);
  assert.ok(s.throttle > 0.99, 'stick up walks forward');
  assert.equal(s.brake, 0, 'L2 is aim on foot, not brake');
  assert.equal(s.fire, true);
  assert.equal(s.aim, true);
  assert.equal(s.handbrake, 1, 'Square jumps (onfoot.js reads handbrake)');
  assert.equal(s.hold, true, 'Cross sprints');
  p.axes[1] = 1; p.axes[0] = -1;         // stick down-left
  const back = padControls(p, true);
  assert.ok(back.brake > 0.99 && back.throttle === 0);
  assert.ok(back.steer > 0.99, 'stick left strafes left, the sign of keyboard A');
});

test('right stick looks like the mouse: right is +x, up is -y, dead in the middle', () => {
  const p = fakePad();
  p.axes[2] = 1; p.axes[3] = -1;
  const s = padControls(p, false);
  assert.ok(s.lookX > 0 && s.lookY < 0);
  p.axes[2] = 0.08; p.axes[3] = 0.1;
  const still = padControls(p, false);
  assert.equal(still.lookX, 0);
  assert.equal(still.lookY, 0);
  p.mapping = ''; p.axes[3] = -1;          // a raw layout with a trigger resting on axis 3
  assert.equal(padControls(p, false).lookY, 0, 'no look from a non-standard pad');
});

test('a press raises its action once; under a menu it raises nothing and the pad is muted', () => {
  const pad = fakePad();
  globalThis.addEventListener ??= () => {};
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
  const fired = [];
  const input = createInput((a) => fired.push(a));

  pad.press(3);                                          // Triangle
  input.read(false); input.read(false);
  assert.deepEqual(fired, [PAD_CAR[3]], 'one edge, one action');

  pad.press(3, 0); pad.press(15);                        // D-pad right: radio in the car, next weapon on foot
  input.read(true);
  assert.deepEqual(fired, ['use', PAD_FOOT[15]]);

  pad.press(15, 0); pad.press(1).press(0).press(7, 1);   // Circle + Cross + R2 while the phone has the pad
  const c = input.read(false, { modal: false });
  assert.deepEqual(fired, ['use', 'nextgun'], 'the menu owns the buttons');
  assert.equal(c.handbrake, 0);
  assert.equal(c.throttle, 1, 'you can still drive with the phone up');
  input.read(false);                                     // phone closed, Circle still held
  assert.deepEqual(fired, ['use', 'nextgun'], 'a button held through the close raises nothing');

  pad.axes[0] = -1;
  assert.equal(input.read(false, { modal: true }).steer, 0, 'a modal menu has the sticks too');
});

test('D-pad navigation picks the nearest clickable that way, favouring the straight line', () => {
  const cards = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 500, y: 100 }, { x: 300, y: 200 }, { x: 300, y: 260 }];
  assert.equal(nearestInDirection(cards[1], cards, [1, 0]), 2);
  assert.equal(nearestInDirection(cards[1], cards, [-1, 0]), 0);
  assert.equal(nearestInDirection(cards[0], cards, [0, 1]), 3, 'down from a side card lands on the nearer row');
  assert.equal(nearestInDirection(cards[4], cards, [0, -1]), 3);
  assert.equal(nearestInDirection(cards[2], cards, [1, 0]), -1, 'nothing further right');
});

test("the pad's fire and look survive touch merging over it (main.js: mergeDrive(c, touch))", () => {
  const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  const kbPad = mergeDrive(idle, { ...idle, fire: true, aim: true, lookX: 300, lookY: -40 });
  const withTouch = mergeDrive(kbPad, { ...idle, throttle: 1 });
  assert.equal(withTouch.fire, true);
  assert.equal(withTouch.aim, true);
  assert.equal(withTouch.lookX, 300);
  assert.equal(withTouch.lookY, -40);
  assert.equal(withTouch.throttle, 1);
});

/* Keyboard steering ramp (input.js:keyboardSteer, 2026-09-23). The old ramp
   was an exponential ease in main.js: it never reached 0, so dynamics.js's
   2x return (gated on steerTarget === 0) never fired on a key release. */
import { keyboardSteer, KEY_STEER } from '../src/game/input.js';
import { createCarState, resetCar, stepVehicle } from '../src/vehicle/dynamics.js';
import { VEHICLE_PROFILES } from '../src/vehicle/config.js';

const DEG_IN = 180 / Math.PI;
const holdKey = (key, speed, secs, hz, cur = 0) => { for (let i = 0; i < Math.round(secs * hz); i++) cur = keyboardSteer(cur, key, speed, 1 / hz); return cur; };

test('keyboard steer: full lock in under 0.2 s when parking, gentler at 120 km/h', () => {
  assert.equal(holdKey(1, 0, 0.2, 60), 1);
  const at = holdKey(1, 33.3, 0.1, 60);
  assert.ok(at > 0.25 && at < 0.32, `0.1 s at 120 km/h: ${at}`);
  assert.equal(holdKey(1, 33.3, 0.4, 60), 1);
  // the first frame of a press runs at the OUTWARD rate (the old sign test called a centred wheel 'returning': 2.2x)
  assert.ok(Math.abs(keyboardSteer(0, 1, 0, 1 / 60) - KEY_STEER.outLo / 60) < 1e-12);
});

test('keyboard steer: a release returns to EXACTLY zero within 0.13 s, at 60 and 144 Hz', () => {
  assert.equal(holdKey(0, 20, 0.13, 60, 1), 0);
  assert.equal(holdKey(0, 20, 0.13, 144, 1), 0);
  assert.equal(holdKey(0, 0, 0.13, 60, -1), 0);
});

test('keyboard steer: frame-rate independent', () => {
  for (const v of [0, 15, 33]) {
    assert.ok(Math.abs(holdKey(1, v, 0.1, 60) - holdKey(1, v, 0.1, 120)) < 1e-9, `${v} m/s`);
    // a reversal too: 0.25 s of D after a held A, straight through centre and out the other side
    assert.ok(Math.abs(holdKey(-1, v, 0.25, 60, 1) - holdKey(-1, v, 0.25, 144, 1)) < 1e-9, `reversal at ${v} m/s`);
  }
});

test('keyboard steer: A straight to D goes back through zero at the return rate', () => {
  const c = holdKey(-1, 10, 1 / 8, 120, 1);   // 15 frames at 8/s: exactly centre
  assert.ok(Math.abs(c) < 1e-9, `${c}`);
  assert.ok(holdKey(-1, 10, 0.3, 120, 1) < 0, 'and out the other side after it');
});

test('keyboard steer: a scripted fraction (the tour steers -0.15) is reached and held', () => {
  assert.ok(Math.abs(holdKey(-0.15, 30, 0.5, 60) + 0.15) < 1e-12);
  assert.equal(holdKey(0.5, 10, 0.5, 60, 1), 0.5, 'coming down from full lock to a smaller key');
  assert.equal(keyboardSteer(0.3, 1, 10, 0), 0.3, 'no time, no change');
});

test('steerAnalogue: a stick or touch strip passes through; a KEY with a trigger held is still ramped', () => {
  const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  // A held while R2 is down: `analogue` is true (pedal lags), but the steer came off a key
  const keyAndTrigger = mergeDrive({ ...idle, steer: 1 }, { ...idle, throttle: 0.5 });
  assert.equal(keyAndTrigger.analogue, true);
  assert.equal(keyAndTrigger.steerAnalogue, false);
  assert.equal(mergeDrive(idle, { ...idle, steer: -0.6 }).steerAnalogue, true);
  assert.equal(mergeDrive({ ...idle, steer: 1 }, { ...idle, steer: 0.4 }).steerAnalogue, false, 'the full key wins over a small stick');
  // touch merges over the keys+pad result: a stick steer it already owned keeps its flag
  const kbPad = mergeDrive(idle, { ...idle, steer: 0.5 });
  assert.equal(mergeDrive(kbPad, { ...idle, throttle: 1 }).steerAnalogue, true);
  assert.equal(mergeDrive(mergeDrive({ ...idle, steer: 1 }, idle), { ...idle, steer: -0.3 }).steerAnalogue, false);
});

/* The ramp against the real car: the default hero (s-camaro-350 -> muscle,
   maya's steerBoost 1.25), 60 fps frames of two 1/120 steps, speed held by a
   throttle servo on open ground. Bands are loose on purpose: the physics is
   tuned elsewhere, these check what the ramp is FOR. */
function keyDrive(kmh, keyAt, secs) {
  const c = createCarState(); resetCar(c);
  c.x = 0; c.z = 0; c.yaw = 0; c.profile = VEHICLE_PROFILES.muscle; c.steerBoost = 1.25; c.buildings = () => [];
  for (let i = 0; i < 360; i++) stepVehicle(c, 1 / 120);
  c.wantsForward = true; c.throttle = 1;
  for (let n = 0; c.fwdSpeed * 3.6 < kmh && n < 7200; n++) stepVehicle(c, 1 / 120);
  c.x = 0; c.z = 0; c.yaw = 0; c.vz = 0; c.vx = c.speed; c.yawRate = 0;
  const log = [];
  for (let f = 1; f <= Math.round(secs * 60); f++) {
    const t = f / 60;
    c.steerTarget = keyboardSteer(c.steerTarget, keyAt(t), Math.hypot(c.vx, c.vz), 1 / 60);
    c.throttle = Math.max(0, Math.min(1, 0.3 + (kmh / 3.6 - c.fwdSpeed) * 0.5));
    stepVehicle(c, 1 / 120); stepVehicle(c, 1 / 120);
    log.push({ t, steer: c.steer, yaw: c.yaw });
  }
  return log;
}

test('a key released at 120 km/h brings the road wheel back fast (dynamics sees an exact zero)', () => {
  const log = keyDrive(120, (t) => (t <= 0.6 + 1e-9 ? 1 : 0), 1.4);
  const s0 = log.find((e) => Math.abs(e.t - 0.6) < 1e-6).steer;
  const back = log.find((e) => e.t > 0.6 + 1e-9 && Math.abs(e.steer) < 0.1 * Math.abs(s0));
  assert.ok(back && back.t - 0.6 < 0.4, `to 10% of lock ${(back?.t - 0.6).toFixed(2)} s after release (exponential ramp: 0.55)`);
});

test('a 0.1 s tap at 120 km/h is a nudge; a held key still turns the car', () => {
  const tap = keyDrive(120, (t) => (t <= 0.1 + 1e-9 ? 1 : 0), 1).at(-1).yaw * DEG_IN;
  const hold = keyDrive(120, () => 1, 1).at(-1).yaw * DEG_IN;
  assert.ok(tap < 4, `tap: ${tap.toFixed(1)} deg of heading after 1 s (exponential ramp: 8.0)`);
  assert.ok(hold > 9, `1 s hold: ${hold.toFixed(1)} deg`);
  assert.ok(hold > 4 * tap, `a tap is a fraction of a hold: ${tap.toFixed(1)} vs ${hold.toFixed(1)} deg (was 62%)`);
});
