import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveObstacles } from '../src/vehicle/collision.js';
import { ChaseCamera } from '../src/game/camera.js';

/* Touching another vehicle (2026-09-12): impact must be an EVENT -- the
   closing speed a resolution cancels -- not a standing penetration, and the
   camera must be kicked by it once, capped, then left to decay. */

const STEP = 1 / 120;
const parked = (x, z, yaw = 0) => ({ x, z, yaw, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'parked' });
// a parked car nose-on 3 m ahead of a hero at the origin facing +x: our front circle (1.6 + 0.95) meets its rear circle (4.8 - 1.45 - 0.98) at x = 2.37... contact when the hero has moved ~0.05 m
const hero = (vx) => ({ x: 0, z: 0, yaw: 0, vx, vz: 0, yawRate: 0, impact: 0 });

test('a 6 m/s closing contact registers one large impact and stops the car', () => {
  const car = hero(6);
  const solids = [parked(4.8, 0)];
  car.x += car.vx * STEP * 2;          // step until overlapping
  while (true) { car.x += car.vx * STEP; resolveObstacles(car, solids); if (car.impact) break; }
  assert.ok(car.impact > 5 && car.impact <= 6.05, `impact ${car.impact}`);
  assert.ok(Math.abs(car.vx) < 0.4, `residual vx ${car.vx}`);   // 5% restitution, then damped
  assert.equal(car.hitTag, 'parked');
});

test('a resting contact under throttle adds no impact after the first step and does not jitter', () => {
  const car = hero(6);
  const solids = [parked(4.8, 0)];
  while (!car.impact) { car.x += car.vx * STEP; resolveObstacles(car, solids); }
  const first = car.impact;
  car.impact = 0; car.hitAt = null;
  let jitter = 0;
  for (let i = 0; i < 240; i++) {               // 2 s of leaning on it
    car.vx += 3.0 * STEP;                       // ~0.3 g of throttle into the bumper
    const x0 = car.x;
    car.x += car.vx * STEP;
    resolveObstacles(car, solids);
    car.impact *= Math.exp(-8 * STEP);          // main.js's decay
    if (i > 60) jitter = Math.max(jitter, Math.abs(car.x - x0));   // after the 5% bounce has settled
  }
  assert.ok(first > 5);
  assert.ok(car.impact < 0.01, `standing impact ${car.impact}`);
  assert.ok(jitter < 0.001, `per-step position jitter ${jitter} m`);
});

test('nudging a car that is moving with you is not a crash: closing speed is relative', () => {
  // traffic ahead at 10 m/s, us at 11 m/s, already overlapping by 1 cm
  const traffic = { speed: 10, panic: 0 };
  const body = { x: 4.79, z: 0, yaw: 0, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'traffic', car: traffic };
  const car = hero(11);
  resolveObstacles(car, [body]);
  assert.equal(car.impact, 0, 'a 1 m/s closing nudge is below the 1.2 m/s event threshold');
  assert.ok(car.vx > 9.5, `we keep riding with it, vx ${car.vx}`);   // before the fix vx went to ~0: a dead stop in the lane
  assert.equal(traffic.speed, 10);
  // the same geometry against a PARKED car is the full 11 m/s crash
  const car2 = hero(11);
  resolveObstacles(car2, [parked(4.79, 0)]);
  assert.ok(car2.impact > 10.5, `parked impact ${car2.impact}`);
});

function camFor() {
  const cam = new ChaseCamera(new THREE.PerspectiveCamera(60, 1.5, 0.1, 100));
  const car = { x: 1000, z: 1000, yaw: 0, speed: 0, impact: 0 };
  cam.snap(car);
  return { cam, car };
}

test('camera shake is kicked once by an impact event, capped, and decays', () => {
  const { cam, car } = camFor();
  const dt = 1 / 60;
  car.impact = 6;
  let peak = 0;
  for (let i = 0; i < 90; i++) { cam.update(car, dt); peak = Math.max(peak, cam.shake); car.impact *= Math.exp(-8 * dt); }
  assert.ok(peak > 0.12 && peak < 0.25, `peak ${peak}`);   // 6 * 0.03 on the first frame, nothing after (was 0.07: a 60 km/h wall threw the lens 0.67 m)
  assert.ok(cam.shake < 0.01, `after 1.5 s: ${cam.shake}`);
  // a standing impact value (the envelope has not decayed yet) does not keep feeding it
  car.impact = 4;
  cam.update(car, dt); const s1 = cam.shake;
  for (let i = 0; i < 10; i++) cam.update(car, dt);
  assert.ok(cam.shake < s1, 'held impact must not grow the shake');
  // the cap, which also catches main.js's direct `chase.shake = 1.4` writes on the next frame
  car.impact = 60; cam.update(car, dt);
  assert.ok(cam.shake <= 0.6 + 1e-9, `capped ${cam.shake}`);
  cam.shake = 1.4; cam.update(car, dt);
  assert.ok(cam.shake <= 0.6 + 1e-9, `a direct write is capped too: ${cam.shake}`);
});

test('being hit is not a crime: a cruiser closing on us from behind sets impact but no hitTag/hitRef', () => {
  // we drive +x at 5 m/s; a cruiser doing 10 m/s sits on our rear bumper (its front circle overlaps our rear circle by 1 cm)
  const cruiser = { speed: 10, panic: 0 };
  const body = { x: -4.79, z: 0, yaw: 0, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'police', car: cruiser };
  const car = hero(5);
  resolveObstacles(car, [body]);
  assert.ok(car.impact > 4.5, `the shove is felt: impact ${car.impact}`);
  assert.equal(car.hitTag, undefined, 'the cruiser hit us: no crime, no ram damage to it');
  assert.equal(car.hitRef, undefined);
  assert.ok(car.vx > 5, `we are shoved forward, vx ${car.vx}`);
  // the mirror case -- we drive into a cruiser ahead doing 5 while we do 10 -- IS ours
  const car2 = hero(10);
  resolveObstacles(car2, [{ x: 4.79, z: 0, yaw: 0, offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'police', car: { speed: 5, panic: 0 } }]);
  assert.equal(car2.hitTag, 'police');
  assert.ok(car2.hitForce > 4.5 && car2.hitForce < 5.5, `hitForce is the closing speed, ${car2.hitForce}`);
});
