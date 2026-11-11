import test from 'node:test';
import assert from 'node:assert/strict';
import { gtaMuscle, brush, rearEnd } from '../tools/sim/contact.mjs';
import { resolveObstacles } from '../src/vehicle/collision.js';

/* The hero car against other vehicles and props (2026-11-11), on
   tools/sim/contact.mjs: the shipped stepVehicle, gta assist, muscle body,
   1/120 s, open tarmac. Bodies are rectangles (ours 4.5 x 1.8 m), one
   contact each; before they were three circles a car, every pair tested. */
gtaMuscle();

const parked = (x, z, yaw = 0) => ({ x, z, yaw, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'parked' });

test('brushing a parked car by 5-20 cm shoulders the car aside by the overlap and costs no speed', () => {
  for (const ov of [0.05, 0.1, 0.2]) {
    const r = brush(60, ov);
    assert.ok(r.touched, `${ov} m of overlap is a contact`);
    // was (circle hulls, 0.2 m): 60 -> 57 km/h, thrown 7.5 m aside in 3 s with 7 deg of yaw, impact 7.6
    assert.ok(r.min > r.before - 1, `${ov} m: ${r.before.toFixed(0)} -> ${r.min.toFixed(0)} km/h`);
    assert.ok(Math.abs(r.shove - ov) < 0.03, `${ov} m: moved ${r.shove.toFixed(2)} m aside after 3 s`);
    assert.ok(Math.abs(r.yawDeg) < 0.5, `${ov} m: yawed ${r.yawDeg.toFixed(1)} deg`);
    assert.equal(r.peakImpact, 0, 'a graze is not a crash event');
  }
});

test('a deeper part-overlap hit is a crash that wedges the car aside; it is never held nose-in', () => {
  for (const ov of [0.3, 0.5]) {
    const r = brush(60, ov);
    assert.ok(r.peakImpact > 10, `${ov} m: impact ${r.peakImpact.toFixed(1)}`);
    assert.ok(r.shove > 1, `${ov} m: deflected ${r.shove.toFixed(1)} m AWAY from the parked car`);
    assert.ok(r.end > 40, `${ov} m: ${r.end.toFixed(0)} km/h 3 s later with the throttle down -- pinned?`);
  }
  assert.ok(brush(60, 0.3).min > brush(60, 0.5).min, 'the more of the nose that hits, the more speed it takes');
  // square on (half the nose or more): a stop, as against a wall
  const full = brush(60, 0.9);
  assert.ok(full.min < 3, `0.9 m of overlap left ${full.min.toFixed(0)} km/h`);
});

test('contact friction is sized by the normal impulse, once per body, not 10% of the speed per circle pair', () => {
  // sliding along a parked car's flank at 15 m/s with 1 m/s of drift into it, flank to flank
  const car = { x: 0, z: 0, yaw: 0, vx: 15, vz: 1, yawRate: 0, impact: 0 };
  resolveObstacles(car, [parked(0.05, 0.9 + 0.9 - 0.01)]);   // centred on the hull (its middle is 5 cm ahead of the origin)
  assert.ok(car.vx > 14.5, `one step of flank contact left vx ${car.vx.toFixed(2)} of 15 (was 15 * 0.9^3 = 10.9)`);
  assert.ok(car.vz <= 0.01, `the drift into it is cancelled: vz ${car.vz.toFixed(3)}`);
  assert.ok(Math.abs(car.yawRate) < 0.05, `flank to flank amidships turns nothing: ${car.yawRate.toFixed(3)}`);
  // 2 s of leaning on it under a sideways shove: a few km/h, not a standstill
  const c2 = { x: 0, z: 0, yaw: 0, vx: 15, vz: 0, yawRate: 0, impact: 0 };
  const row = [parked(0.5, 1.79), parked(6.0, 1.79), parked(11.5, 1.79), parked(17.0, 1.79), parked(22.5, 1.79), parked(28.0, 1.79)];
  for (let i = 0; i < 240; i++) { c2.vz += 2 / 120; c2.x += c2.vx / 120; c2.z += c2.vz / 120; resolveObstacles(c2, row); }
  assert.ok(c2.vx > 13 && c2.vx < 15, `after 2 s along a row of parked cars: ${c2.vx.toFixed(2)} m/s of 15`);
  assert.ok(c2.z < 0.02, `not inside them: z ${c2.z.toFixed(3)}`);
});

test('a prop is a circle against the body: the flank between the old circles is covered, the air beside it is not', () => {
  const post = (x, z) => [{ x, z, yaw: 0, offsets: [0], radius: 0.3, reach: 0.8, tag: 'prop' }];
  for (const x of [-1.9, -0.8, 0.8, 1.9]) {
    const car = { x: 0, z: 0, yaw: 0, vx: 0, vz: 2, yawRate: 0, impact: 0 };
    resolveObstacles(car, post(x, 1.1));          // 0.1 m inside the right flank
    assert.ok(Math.abs(car.z + 0.1) < 1e-9, `post at x ${x}: pushed to z ${car.z}`);
    // off-centre, part of the closing speed becomes yaw; the nearer the middle, the more of it simply stops
    assert.ok(car.vz < (Math.abs(x) < 1 ? 0.8 : 1.5), `post at x ${x}: still closing at ${car.vz.toFixed(2)}`);
    assert.ok(Math.sign(car.yawRate) === Math.sign(x), `post at x ${x} on the right turns that end away: yawRate ${car.yawRate.toFixed(2)}`);
  }
  const clear = { x: 0, z: 0, yaw: 0, vx: 10, vz: 0, yawRate: 0, impact: 0 };
  resolveObstacles(clear, post(1.0, 1.25));       // 5 cm of air (the 0.95 m circles reached it)
  assert.ok(clear.z === 0 && clear.vx === 10);
  // nose on: stops, no yaw
  const nose = { x: 0, z: 0, yaw: 0, vx: 8, vz: 0, yawRate: 0, impact: 0 };
  resolveObstacles(nose, post(2.55, 0));
  assert.ok(Math.abs(nose.vx) < 0.5 && Math.abs(nose.yawRate) < 1e-9 && nose.impact > 7.9, `vx ${nose.vx}, impact ${nose.impact}`);
});

test('an angled hit on a parked car turns the nose along it instead of holding the car nose-in', () => {
  // the car heads 30 deg into the flank of a long row; front-right corner makes contact
  const car = { x: 0, z: 0, yaw: -Math.PI / 6, vx: 12, vz: 6.9, yawRate: 0, impact: 0 };
  car.z = 1.8 - 0.9 - (2.3 * 0.5 + 0.9 * Math.cos(Math.PI / 6)) + 0.9 + 0.05;   // corner 5 cm inside the flank at z = 0.9
  resolveObstacles(car, [parked(1.5, 1.8)]);
  assert.ok(car.yawRate > 0.8, `yaw rate ${car.yawRate.toFixed(2)}: the nose must swing left, away from the car on the right`);
  assert.ok(car.vx > 10, `keeps its speed along the row: ${car.vx.toFixed(1)} of 12`);
});

test('rear-ending slower traffic is survivable for now: a hit is registered against the right car', () => {
  const r = rearEnd(60, 40);
  assert.equal(r.hitTag, 'traffic');
  assert.ok(r.peakImpact > 3 && r.peakImpact < 20, `impact ${r.peakImpact.toFixed(1)}`);
  assert.ok(r.gap > 4.5, `we end behind it, not in it: gap ${r.gap.toFixed(2)}`);
});
