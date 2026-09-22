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
