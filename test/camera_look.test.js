import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChaseCamera, RIGS } from '../src/game/camera.js';

/* The chase camera driven by synthetic cars (2026-09-23, "drive like GTA").
   No physics here: a car is a pose + velocity on a straight line or a circle,
   so every number below is the camera's alone. Heights are lifted 10 m where
   a test must not meet camera.js's kerb/building pull-in (targetY >= 5 skips
   it); the straight-line ones run at ground height down the legacy grid's
   z = 0 carriageway (roadDepth -9.2, no pull-in). */

const DEG = 180 / Math.PI;
const lens = () => new THREE.PerspectiveCamera(48, 1440 / 860, 0.5, 4000);

/** A car at time t: straight along +x (r = 0) or on a circle of radius v / r, turning left. */
function carAt(v, t, r = 0, { y = 0.62, yaw0 = 0 } = {}) {
  const yaw = yaw0 + r * t;
  const x = r ? (v / r) * (Math.sin(yaw) - Math.sin(yaw0)) : v * t;
  const z = r ? (v / r) * (Math.cos(yaw) - Math.cos(yaw0)) : 0;
  return { x, z, y, yaw, speed: v, fwdSpeed: v, vx: v * Math.cos(yaw), vz: -v * Math.sin(yaw), yawRate: r, lastAy: v * r, impact: 0 };
}

/** Where the lens sits relative to the car: metres behind along its heading, metres to its right, and the bearing. */
function rel(cam, car) {
  const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
  const dx = cam.camera.position.x - car.x, dz = cam.camera.position.z - car.z;
  const behind = -(dx * fx + dz * fz), side = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
  return { behind, side, orbit: Math.atan2(side, behind) * DEG };
}

function drive(v, r, { hz = 60, secs = 4, opts, cam = new ChaseCamera(lens()) } = {}) {
  cam.snap(carAt(v, 0, r, opts));
  let car = null;
  for (let i = 1; i <= Math.round(secs * hz); i++) { car = carAt(v, i / hz, r, opts); cam.update(car, 1 / hz); }
  return { cam, car };
}

test('look() is still a method after update(): mouse, right stick, touch and the tank turret all go through it', () => {
  // camera.js stored its eased look-ahead in `this.look`, which replaced the method with a number after the
  // first update -- chase.look(...) threw on every mousemove, and inside the frame for the pad (the game froze)
  const { cam } = drive(0, 0, { secs: 10 / 60 });
  assert.equal(typeof cam.look, 'function');
  assert.doesNotThrow(() => cam.look(20, 0));
  assert.ok(cam.lookYaw < 0 && cam.looking);
});

test('the chase distance holds from rest to 180 km/h (velocity lead 0.9)', () => {
  for (const v of [0, 16.7, 33.3, 50]) {
    const { cam, car } = drive(v, 0);
    const { behind } = rel(cam, car);
    assert.ok(behind > 5.5 && behind < 6.6, `${(v * 3.6).toFixed(0)} km/h: ${behind.toFixed(2)} m behind (was 7.43 at 120)`);
  }
});

test('a snap at speed lands where the follower settles, not on the lead-shifted target', () => {
  const cam = new ChaseCamera(lens());
  const v = 16.7;
  cam.snap(carAt(v, 0));
  cam.update(carAt(v, 1 / 60), 1 / 60);
  const first = rel(cam, carAt(v, 1 / 60)).behind;
  const { behind: settled } = rel(...Object.values(drive(v, 0)));
  assert.ok(Math.abs(first - settled) < 0.2, `one frame after the snap ${first.toFixed(2)} m, settled ${settled.toFixed(2)} m (was 4.33 vs 6.68)`);
});

test('in a corner the lens swings out and shows the flank (yawLag on the default rig)', () => {
  const { cam, car } = drive(11, 0.5, { opts: { y: 10.62 } });
  const { orbit } = rel(cam, car);
  assert.ok(Math.abs(orbit) > 8 && Math.abs(orbit) < 16, `orbit ${orbit.toFixed(1)} deg (welded: 4.7)`);
  // and only the two chase rigs lag their heading: the cockpit is bolted to the shell
  assert.ok(RIGS[0].yawLag > 0 && RIGS[1].yawLag > 0);
  assert.ok(!RIGS[2].yawLag && !RIGS[3].yawLag && !RIGS[4].yawLag);
});

test('the corner pose is the same at 60 and 144 Hz', () => {
  const a = drive(11, 0.5, { hz: 60, opts: { y: 10.62 } });
  const b = drive(11, 0.5, { hz: 144, opts: { y: 10.62 } });
  const pa = rel(a.cam, a.car), pb = rel(b.cam, b.car);
  // a discrete follower trails by half a frame of travel less than a continuous one (v*dt/2: 5 cm at 60 Hz here)
  assert.ok(Math.hypot(pa.behind - pb.behind, pa.side - pb.side) < 0.1, `60 Hz ${pa.behind.toFixed(3)},${pa.side.toFixed(3)} vs 144 Hz ${pb.behind.toFixed(3)},${pb.side.toFixed(3)}`);
  assert.ok(Math.abs(pa.orbit - pb.orbit) < 0.5, `orbit ${pa.orbit.toFixed(2)} vs ${pb.orbit.toFixed(2)} deg`);
});

test('a yaw that has wound up (+20 pi) or crosses +-pi is not a jump', () => {
  const ref = drive(11, 0.5, { opts: { y: 10.62 } });
  const wound = drive(11, 0.5, { opts: { y: 10.62, yaw0: 20 * Math.PI } });
  assert.ok(ref.cam.camera.position.distanceTo(new THREE.Vector3(wound.cam.camera.position.x, wound.cam.camera.position.y, wound.cam.camera.position.z)) < 1e-6);
  // start just short of +pi and turn through it: no frame may move the lens more than a frame of travel
  const cam = new ChaseCamera(lens());
  const opts = { y: 10.62, yaw0: Math.PI - 0.2 };
  cam.snap(carAt(11, 0, 0.5, opts));
  let last = cam.camera.position.clone(), worst = 0;
  for (let i = 1; i <= 120; i++) {
    cam.update(carAt(11, i / 60, 0.5, opts), 1 / 60);
    worst = Math.max(worst, cam.camera.position.distanceTo(last)); last = cam.camera.position.clone();
  }
  assert.ok(worst < 0.5, `biggest one-frame lens move ${worst.toFixed(3)} m`);
});

test('lens roll does not read the physics step-rate ripple in yawRate / lastAy', () => {
  // dynamics.js alternates ~0.54/0.72 g and 0.26/0.31 rad/s on successive 1/120 steps in a steady corner;
  // at 144 Hz each frame catches a different phase. Feed that ripple straight in and measure the roll's jerk.
  const hz = 144, v = 22, r = 0.29;
  const cam = new ChaseCamera(lens());
  const opts = { y: 10.62 };
  cam.snap(carAt(v, 0, r, opts));
  const rolls = [];
  const right = new THREE.Vector3();
  for (let i = 1; i <= hz * 3; i++) {
    const car = carAt(v, i / hz, r, opts), s = i % 2 ? 1 : -1;
    car.lastAy += s * 0.9; car.yawRate += s * 0.016;
    cam.update(car, 1 / hz);
    if (i > hz) { right.set(1, 0, 0).applyQuaternion(cam.camera.quaternion); rolls.push(Math.asin(right.y) * DEG); }
  }
  let worst = 0;
  for (let i = 2; i < rolls.length; i++) worst = Math.max(worst, Math.abs(rolls[i] - 2 * rolls[i - 1] + rolls[i - 2]));
  assert.ok(worst < 0.05, `lens roll second difference ${worst.toFixed(3)} deg/frame`);
});

/** Free look: 15 frames of 20 px to the right, then hands off, at speed v. */
function lookThenLetGo(v, rig) {
  const cam = new ChaseCamera(lens());
  const opts = { y: 10.62 };
  const at = (t) => ({ ...carAt(v, t, 0, opts), customRig: rig });
  cam.snap(at(0));
  let t = 0;
  for (let i = 0; i < 30; i++) cam.update(at((t += 1 / 60)), 1 / 60);
  const dir0 = new THREE.Vector3(), dir1 = new THREE.Vector3();
  cam.camera.getWorldDirection(dir0);
  let firstJump = 0;
  for (let i = 0; i < 15; i++) {
    cam.look(20, 0); cam.update(at((t += 1 / 60)), 1 / 60);
    if (i === 0) { cam.camera.getWorldDirection(dir1); firstJump = dir0.angleTo(dir1) * DEG; }
  }
  const t0 = t;
  cam.camera.getWorldDirection(dir0);
  const frames = [];
  return {
    cam, firstJump,
    /** run `secs` more with no input; returns the largest one-frame view rotation and the pose each frame */
    run(secs) {
      let worst = 0;
      for (let i = 0; i < Math.round(secs * 60); i++) {
        const car = at((t += 1 / 60));
        cam.update(car, 1 / 60);
        cam.camera.getWorldDirection(dir1);
        worst = Math.max(worst, dir0.angleTo(dir1) * DEG); dir0.copy(dir1);
        frames.push({ t: t - t0, orbit: rel(cam, car).orbit, lookYaw: cam.lookYaw, rot: worst });
      }
      return { worst, frames };
    },
  };
}

test('free look holds while parked: no recentre snap', () => {
  const s = lookThenLetGo(0);
  const yaw = s.cam.lookYaw;
  s.run(1.5);                          // the position follower finishes the last input's orbit
  const { worst } = s.run(1.5);        // then nothing may move (the old camera snapped 30.7 deg at 2 s)
  assert.ok(Math.abs(s.cam.lookYaw - yaw) < 1e-9 && Math.abs(yaw + 0.96) < 0.01, `lookYaw ${s.cam.lookYaw}`);
  assert.equal(s.cam.looking, true);
  assert.ok(worst < 0.05, `parked, the view moved ${worst.toFixed(2)} deg in one frame 1.5-3 s after the last input`);
});

test('free look eases home behind the car once you drive, with no big frame', () => {
  const s = lookThenLetGo(16.7);
  assert.ok(s.firstJump < 2.5, `the first look frame moves the view ${s.firstJump.toFixed(2)} deg (was 4.4: aim distance stepped 6.2 -> 2 m)`);
  const { worst, frames } = s.run(4);
  const home = frames.find((f) => Math.abs(f.orbit) < 2);
  assert.ok(home && home.t <= 3.0, `back within 2 deg of straight behind at ${home?.t.toFixed(2)} s after the last input`);
  assert.ok(worst < 3, `largest one-frame view rotation after the input stopped ${worst.toFixed(2)} deg (was 5.2)`);
  assert.equal(s.cam.looking, false, 'recentred once home');
  // and it held for a second first
  assert.ok(frames.filter((f) => f.t < 0.98).every((f) => f.lookYaw === frames[0].lookYaw), 'no ease in the first second');
});

test('a mouse spun three turns still comes home the short way and recentres', () => {
  const s = lookThenLetGo(16.7);
  s.cam.lookYaw -= 6 * Math.PI;   // same view, three more turns on the counter
  s.run(4);
  assert.equal(s.cam.looking, false);
  assert.equal(s.cam.lookYaw, 0);
});

test('a holdLook rig (the tank) never eases the free look home: the turret aims from it', () => {
  const s = lookThenLetGo(16.7, { ...RIGS[0], yawLag: 0, holdLook: 1 });
  const yaw = s.cam.lookYaw;
  s.run(5);
  assert.equal(s.cam.lookYaw, yaw);
  assert.equal(s.cam.looking, true);
});

test('a snap (spawn, respawn, teleport) lands behind the car', () => {
  const s = lookThenLetGo(0);
  s.cam.snap(carAt(0, 0));
  assert.equal(s.cam.looking, false);
  assert.equal(s.cam.lookYaw, 0);
});

test('look-back is a cut: the lens never swings through the car', () => {
  const cam = new ChaseCamera(lens());
  const v = 16.7, opts = { y: 10.62 };
  cam.snap(carAt(v, 0, 0, opts));
  let closest = Infinity;
  for (let i = 1; i <= 240; i++) {
    cam.setLookBack(i > 30 && i <= 150);
    const car = carAt(v, i / 60, 0, opts);
    cam.update(car, 1 / 60);
    closest = Math.min(closest, cam.camera.position.distanceTo(new THREE.Vector3(car.x, car.y, car.z)));
    if (i === 60) assert.ok(rel(cam, car).behind < -4.5, 'looking back, the lens sits ahead of the car');
  }
  assert.ok(closest > 4.5, `closest lens-to-car-centre ${closest.toFixed(2)} m (was 1.52: through the roof)`);
});

test('the impact jolt is a function of time, not of the frame rate', () => {
  // it was a fresh Math.random() per frame; the same crash at 60 and 144 Hz must throw the lens about equally
  const peakAt = (hz) => {
    const cam = new ChaseCamera(lens());
    const car = { x: 1000, z: 1000, yaw: 0, speed: 0, impact: 0 };
    cam.snap(car);
    car.impact = 6;
    let peak = 0;
    for (let i = 0; i < Math.round(1.5 * hz); i++) {
      cam.update(car, 1 / hz);
      peak = Math.max(peak, cam.camera.position.distanceTo(cam.pos));
      car.impact *= Math.exp(-8 / hz);
    }
    return peak;
  };
  const a = peakAt(60), b = peakAt(144);
  assert.ok(a > 0.03 && a < 0.15, `peak lens offset ${a.toFixed(3)} m`);   // shake 6 * 0.03, +-0.5 of it per axis
  assert.ok(Math.abs(a - b) / a < 0.1, `60 Hz ${a.toFixed(4)} m vs 144 Hz ${b.toFixed(4)} m`);
});
