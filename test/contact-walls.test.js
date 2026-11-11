import test from 'node:test';
import assert from 'node:assert/strict';
import { gtaMuscle, wall, corner, headOn, rest } from '../tools/sim/contact.mjs';
import { resolveBoxes } from '../src/vehicle/collision.js';

/* Walls and building corners (2026-11-11), on tools/sim/contact.mjs: the
   shipped stepVehicle, gta assist, muscle body, 1/120 s, open tarmac.
   Before: a 20-45 deg wall hit under throttle ended at 0.0-0.3 km/h and
   stayed there ('walls pin the car'), and passing a building corner with
   5-20 cm of air beside the body was a dead stop (the hull was eight points
   each padded 0.42 m: a 2.4 m nose on a 1.76 m car). */
gtaMuscle();

test('a 20-45 deg wall hit under throttle deflects along the wall and keeps most of its tangential speed', () => {
  for (const kmh of [60, 120]) for (const deg of [20, 30, 45]) {
    const r = wall(kmh, deg);
    // 1 s after the hit: at least 60% of the speed it had ALONG the wall (measured 1.30 / 1.19 / 0.96 at 60, 0.99 / 0.92 / 0.73 at 120; was 0.55 -> 0.02, and 0 by 6 s)
    assert.ok(r.at1s > 0.6 * r.tangential, `${kmh} km/h at ${deg} deg: ${r.at1s.toFixed(0)} km/h 1 s after, tangential was ${r.tangential.toFixed(0)}`);
    assert.ok(Math.abs(r.yawAt1s) < 6, `${kmh} km/h at ${deg} deg: still ${r.yawAt1s.toFixed(1)} deg off the wall 1 s after`);
    assert.ok(r.min > 0.5 * r.tangential, `${kmh} km/h at ${deg} deg: dropped to ${r.min.toFixed(0)} km/h`);
    assert.ok(r.end > r.before, `${kmh} km/h at ${deg} deg: ${r.end.toFixed(0)} km/h after 6 s of throttle -- pinned?`);
    // the wall face is at z = -1.4 and the body is 0.9 m from centre to flank: the centre never gets nearer than that
    assert.ok(r.minZ > -1.4 + 0.9 - 0.02, `${kmh} km/h at ${deg} deg: centre reached z ${r.minZ.toFixed(2)}, the body is in the wall`);
    assert.ok(r.finite);
  }
});

test('a 6 deg scrape stays fast, and a wall hit costs speed in proportion to its angle', () => {
  const a = wall(60, 6), b = wall(60, 30), c = wall(60, 45);
  assert.ok(a.min > 55, `6 deg: ${a.min.toFixed(0)} km/h at its slowest`);
  assert.ok(b.min < a.min && c.min < b.min, `slowest 6 / 30 / 45 deg: ${a.min.toFixed(0)} / ${b.min.toFixed(0)} / ${c.min.toFixed(0)} km/h`);
  assert.ok(c.peakImpact > 10, 'a 45 deg hit at 60 km/h is still a crash event for the camera and the dents');
});

test('steering away from a wall frees the car in under half a second', () => {
  for (const [kmh, deg] of [[60, 30], [60, 45], [120, 30], [120, 45]]) {
    const r = wall(kmh, deg, { steer: -1 });
    assert.ok(r.freeAt !== null && r.freeAt < 0.6, `${kmh} km/h at ${deg} deg: free after ${r.freeAt} s (was 0.75-1.73 s)`);
  }
});

test('a head-on is still a dead stop: no tunnelling, no rebound, at any step length', () => {
  for (const [kmh, thick, dt] of [[60, 2, 1 / 120], [150, 2, 1 / 120], [250, 2, 1 / 120], [250, 0.3, 1 / 120], [150, 2, 1 / 30], [150, 2, 1 / 10]]) {
    const r = headOn(kmh, thick, dt);
    assert.ok(!r.through && r.finite, `${kmh} km/h into a ${thick} m wall at dt 1/${Math.round(1 / dt)}: went through`);
    assert.ok(r.nose < 0.1, `${kmh} km/h, dt 1/${Math.round(1 / dt)}: nose ${r.nose.toFixed(2)} m inside the wall after resolution`);
    assert.ok(r.rebound < 1, `${kmh} km/h: bounced back at ${r.rebound.toFixed(1)} km/h`);
    assert.ok(r.end < 2, `${kmh} km/h: still doing ${r.end.toFixed(1)} km/h against the wall`);
  }
  // 70 deg is near enough head-on: it stops (and holds: no creep along the wall)
  assert.ok(wall(60, 70).end < 3);
});

test('a car parked against a wall does not creep or register impacts', () => {
  const r = rest();
  assert.ok(r.creep < 1e-3, `crept ${r.creep} m in 5 s`);
  assert.equal(r.peakImpact, 0);
});

test('a building corner with air beside the body is not a contact at all', () => {
  for (const kmh of [50, 100]) for (const gap of [0.05, 0.1, 0.2, 0.35]) {
    const r = corner(kmh, gap);
    assert.equal(r.peakImpact, 0, `${kmh} km/h, ${gap} m of air: impact ${r.peakImpact}`);
    assert.ok(r.min > kmh - 1 && Math.abs(r.zShift) < 1e-6, `${kmh} km/h, ${gap} m of air: slowed to ${r.min.toFixed(1)}, moved ${r.zShift.toFixed(3)} m`);
  }
});

test('a corner clipped by 10 cm shoulders the car aside; 30 cm of overlap is a crash', () => {
  for (const kmh of [50, 100]) {
    const r = corner(kmh, -0.1);
    assert.ok(r.min > kmh - 2, `${kmh} km/h clipping 10 cm: slowed to ${r.min.toFixed(1)} (was a dead stop)`);
    assert.ok(r.zShift < -0.09 && r.zShift > -0.2, `moved aside ${r.zShift.toFixed(2)} m`);
    const deep = corner(kmh, -0.3);
    assert.ok(deep.peakImpact > 10 && deep.min < 15, `${kmh} km/h into 30 cm of corner: impact ${deep.peakImpact.toFixed(1)}, slowest ${deep.min.toFixed(0)}`);
  }
});

test('resolveBoxes: the hull is the body -- flanks have no gaps, and a box corner in the doors is pushed out', () => {
  // a 1 m pillar whose corner sits 0.3 m inside the right flank amidships: no probe ever stood there (they were at x = 0 and +-2)
  for (const x of [-1.2, -0.6, 0.9, 1.4]) {
    const car = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0 };
    resolveBoxes(car, [{ x, z: 0.6 + 0.5, hw: 0.5, hd: 0.5, angle: 0 }]);
    assert.ok(Math.abs(car.z + 0.3) < 1e-9, `pillar at x ${x}: car moved to z ${car.z}, want -0.3`);
  }
  // and nothing the body does not reach: 5 cm clear of the flank, the nose and the tail
  for (const b of [{ x: 0, z: 0.9 + 0.05 + 0.5 }, { x: 2.3 + 0.05 + 0.5, z: 0 }, { x: -2.2 - 0.05 - 0.5, z: 0 }]) {
    const car = { x: 0, z: 0, yaw: 0, vx: 5, vz: 0, yawRate: 0 };
    resolveBoxes(car, [{ ...b, hw: 0.5, hd: 0.5, angle: 0 }]);
    assert.ok(car.x === 0 && car.z === 0 && car.vx === 5, `box at ${b.x},${b.z} touched the car`);
  }
});

test('resolveBoxes: an off-centre hit turns the car away from the wall; a centred one does not turn it', () => {
  // wall on the left (-z), car yawed 30 deg into it (+yaw is left), nose corner in by a few cm
  const wallBox = [{ x: 0, z: -11, hw: 40, hd: 10, angle: 0 }];
  const car = { x: 0, z: 0, yaw: Math.PI / 6, vx: 14.4, vz: -8.3, yawRate: 0 };
  car.z = -1 + 2.3 * Math.sin(car.yaw) + 0.9 * Math.cos(car.yaw) - 0.05;      // front-left corner 5 cm past the face at z = -1
  resolveBoxes(car, wallBox);
  assert.ok(car.yawRate < -1, `yaw rate ${car.yawRate.toFixed(2)}: a nose-left hit must swing the nose right (-)`);
  assert.ok(car.vz < 0 && car.vz > -8.3, `the centre keeps part of its speed into the wall while the body turns (vz ${car.vz.toFixed(2)})`);
  assert.ok(car.vx > 12, `tangential speed ${car.vx.toFixed(1)} of 14.4 m/s`);
  const flat = { x: 0, z: 0, yaw: Math.PI / 2, vx: 0, vz: -10, yawRate: 0 };   // nose straight at it
  flat.z = -1 + 2.3 - 0.05;
  resolveBoxes(flat, wallBox);
  assert.ok(Math.abs(flat.yawRate) < 1e-9 && Math.abs(flat.vz) < 1e-9, `head-on: yaw rate ${flat.yawRate}, vz ${flat.vz}`);
});
