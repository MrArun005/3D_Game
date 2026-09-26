import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR, H, openField, settled, launch, brake100, steadyLock, coastLock, powerLock, liftOff,
  handbrake, brakeTurn, tapHandbrake, keyStep, airRatio, scrape, headOn, powerTurn,
  lockWobble, coastToRest, stopAndRelease, parkedBrake, airRev, unlockFront,
} from '../tools/sim/handling.mjs';
import { HANDLING, VEHICLE_PROFILES, pickHandling, getVehicleProfile } from '../src/vehicle/config.js';
import { stepVehicle, steerLimit, createCarState, resetCar } from '../src/vehicle/dynamics.js';
import { Autopilot, buildRoute } from '../src/game/autopilot.js';
import { Garage } from '../src/game/garage.js';

/*
 * The GTA handling profile -- the game default (main.js car.assist) -- pinned
 * on the default body (s-camaro-350 -> VEHICLE_PROFILES.muscle) on open flat
 * tarmac, so no scenario can end in the legacy grid's building line. Its own
 * file because openField() swaps metrics.js's module-global district for the
 * whole process; node --test gives every file its own.
 *
 * Measured 2026-09-23 (node tools/sim/handling.mjs gta --profile=muscle --open),
 * after the coupled wheel + body solve: 0-100 5.09 s, 214 km/h; 100-0 35.0 m,
 * fronts locked 0%; full lock 1.14 / 1.19 / 1.21 g at 50 / 80 / 120 km/h,
 * slip <= 2.4 deg, an 18 m circle at 50, yaw rate steady to 0.4 / 2.1% at
 * 120 / 160; WOT + lock 9.5 deg, lift-off 1.5; handbrake 46 deg at 60, tail
 * out, under 8 again 0.40 s after letting go, 26 km/h left; W+A with Space
 * tapped 0.6 s at 70: 27 deg; brake + full lock at 80: fronts locked 1%, 23
 * deg of heading in the first second; a 6 deg wall scrape at 60 keeps 49
 * km/h; and a car left alone stays put (0.00 km/h after a 3 min coast,
 * 0.00 m in the minute after a stop, 0.001 m in 2 min with the brake held).
 * sim on the same car: 0.62 g, a 34 m circle, handbrake 4 deg, brake + lock
 * 98% locked. Bands, not values, with room for a tuning pass.
 */
CAR.assist = HANDLING.gta; CAR.profile = VEHICLE_PROFILES.muscle;
openField();

test('pickHandling: ?sim / ?gta beat the stored choice, which beats the gta default', () => {
  assert.equal(pickHandling('', null), 'gta');
  assert.equal(pickHandling('?sim', 'gta'), 'sim');
  assert.equal(pickHandling('?gta', 'sim'), 'gta');
  assert.equal(pickHandling('?debug&sim', null), 'sim');
  assert.equal(pickHandling('', 'sim'), 'sim');
  assert.equal(pickHandling('', 'nonsense'), 'gta');
  assert.equal(pickHandling('', 'toString'), 'gta', 'an inherited key is not a profile');
  assert.equal(HANDLING.sim, null, 'sim is the raw model: no assist object at all');
});

test('the handling profile survives a reset and a body swap (main.js sets it once)', () => {
  // respawns, WASTED/BUSTED and R all go through resetCar
  const c = createCarState(); c.assist = HANDLING.gta; c.profile = VEHICLE_PROFILES.muscle;
  c.vx = 20; c.yawRate = 1; resetCar(c);
  assert.equal(c.assist, HANDLING.gta);
  /* ...and the garage's body swap, through the real Garage: its constructor
     fits hb.body onto the car with the same `this.car.profile =
     getVehicleProfile(file)` line that #fit and equipRaceCar run (garage.js
     :68 and :187; #fit itself needs a loaded skin, which node cannot fetch). */
  const store = { 'hb.body': 's-porsche-gt3r' }, orig = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  try {
    new Garage({ cash: 0, persist() {} }, {}, { userData: {} }, null, { flash() {} }, c);
    assert.equal(c.profile, getVehicleProfile('s-porsche-gt3r'), 'the garage fitted the GT3');
    assert.notEqual(c.profile, VEHICLE_PROFILES.muscle, 'the body really changed');
    assert.equal(c.assist, HANDLING.gta, 'and the handling profile did not');
  } finally {
    if (orig) globalThis.localStorage = orig; else delete globalThis.localStorage;
  }
});

test('steerLimit is the angle stepVehicle actually applies at full lock (sim and gta)', () => {
  for (const assist of [null, HANDLING.gta]) {
    const c = settled(); c.assist = assist; c.wantsForward = true; c.throttle = 1;
    while (c.fwdSpeed < 60 / 3.6) stepVehicle(c, H);
    c.steerTarget = 1;
    for (let i = 0; i < 120; i++) { c.throttle = Math.max(0, Math.min(1, 0.3 + (60 / 3.6 - c.fwdSpeed) * 0.5)); stepVehicle(c, H); }
    const want = steerLimit(c);
    assert.ok(Math.abs(c.steer - want) < 0.01, `${assist ? 'gta' : 'sim'}: steer ${c.steer.toFixed(3)} vs steerLimit ${want.toFixed(3)}`);
  }
  // and gta's is the grip-limited one: well under sim's at road speed, the same when parking
  const at = (kmh, assist) => steerLimit({ vx: kmh / 3.6, vz: 0, fwdSpeed: kmh / 3.6, profile: VEHICLE_PROFILES.muscle, assist });
  assert.ok(at(60, HANDLING.gta) < at(60, null) * 0.5, `gta lock at 60 ${at(60, HANDLING.gta).toFixed(3)} vs sim ${at(60, null).toFixed(3)}`);
  assert.equal(at(15, HANDLING.gta), at(15, null));
});

test('gta: quick launch, strong short stop without locking the fronts', () => {
  const { t100, vmax } = launch();
  assert.ok(t100 > 4.5 && t100 < 6.5, `0-100 ${t100?.toFixed(2)} s, want 4.5-6.5`);
  assert.ok(vmax > 190, `top speed ${vmax.toFixed(0)}`);
  const b = brake100();
  assert.ok(b.dist > 30 && b.dist < 40, `100-0 ${b.dist.toFixed(1)} m, want 30-40`);
  assert.ok(b.frontLockedFrac < 0.10, `fronts locked ${(b.frontLockedFrac * 100).toFixed(0)}%, want < 10%`);
});

test('gta: full lock at any speed is a tight ~1.1 g turn, never a spin', () => {
  for (const kmh of [50, 80, 120]) {
    const s = steadyLock(kmh);
    assert.ok(s.latG > 0.95 && s.latG < 1.7, `${kmh} km/h: ${s.latG.toFixed(2)} g, want 0.95-1.7 (gripBoost 1.1 + gripHi 0.4 at speed, 2026-09-26)`);
    assert.ok(s.maxBetaDeg < 8, `${kmh} km/h: body slip ${s.maxBetaDeg.toFixed(1)} deg, want < 8`);
  }
  const r50 = steadyLock(50).radius;
  assert.ok(r50 < 20, `full lock at 50 km/h drives a ${r50.toFixed(1)} m circle, want < 20`);
});

test('gta: a held full lock at speed is a steady turn, not a car pumping round the bend', () => {
  // yawDampHi: flat 0.4/s yaw damping left a ~0.7 Hz yaw limit cycle, 52 / 50% peak to peak at 120 / 160
  for (const kmh of [120, 160]) {
    const w = lockWobble(kmh);
    assert.ok(w.p2p < 0.1, `${kmh} km/h: yaw rate ${(w.p2p * 100).toFixed(1)}% peak to peak over 3 s, want < 10%`);
  }
});

test('gta: a car left alone stays where it stopped (muscle and the race-mode GT3)', () => {
  /* The first gta wheel update chattered the body at the step rate below
     ~6 km/h and the chatter drove the car: after a 3 min coast the GT3 still
     did 5.5 km/h, released after a stop it crept 82 m a minute, and with the
     brake held (on foot the empty car keeps stepping) 1.6 m in 2 min. */
  try {
    for (const p of ['muscle', 'gt3_race']) {
      CAR.profile = VEHICLE_PROFILES[p];
      const c = coastToRest();
      assert.ok(c.kmh < 0.1, `${p}: ${c.kmh.toFixed(2)} km/h after coasting 3 min, want < 0.1`);
      const r = stopAndRelease();
      assert.ok(r.moved < 0.5, `${p}: moved ${r.moved.toFixed(2)} m in the minute after stopping, want < 0.5`);
      const k = parkedBrake();
      assert.ok(k.moved < 0.1, `${p}: moved ${k.moved.toFixed(3)} m in 2 min with the brake held, want < 0.1`);
    }
  } finally { CAR.profile = VEHICLE_PROFILES.muscle; }
});

test('gta: throttle and lift-off never spin it', () => {
  const p = powerLock(30), l = liftOff(100), c = coastLock(80);
  assert.ok(p.maxBetaDeg < 12, `full throttle on full lock from 30 km/h: ${p.maxBetaDeg.toFixed(1)} deg`);
  assert.ok(l.maxBetaDeg < 6, `lift-off at the limit at 100 km/h: ${l.maxBetaDeg.toFixed(1)} deg`);
  assert.ok(c.maxBetaDeg < 8 && c.speed > 60, `coast + lock at 80: slip ${c.maxBetaDeg.toFixed(0)}, ${c.speed.toFixed(0)} km/h left`);
});

test('gta: W + full lock is a turn, not a burnout -- the driven wheels track the road', () => {
  // sim spins the unloaded inside rear to 3.6x the road at 80 km/h and smokes 98% of the way round
  for (const kmh of [40, 80, 120]) {
    const p = powerTurn(kmh);
    assert.ok(p.spin < 1.2, `${kmh} km/h: a rear wheel reached ${p.spin.toFixed(2)}x the road speed, want < 1.2`);
    assert.ok(p.smokeFrac < 0.05, `${kmh} km/h: smoking ${(p.smokeFrac * 100).toFixed(0)}% of a held power turn`);
    assert.ok(p.speed > kmh * 0.9, `${kmh} km/h: came out at ${p.speed.toFixed(0)} km/h -- full throttle should not bog`);
  }
  /* The GT3 at 1.46 g lifts its inside wheels clean off the ground; a drive
     cap skipped for any unloaded WHEEL (not the airborne car) let that rear
     spin to 7.3x the road (153 m/s) through five gears. */
  try {
    CAR.profile = VEHICLE_PROFILES.gt3_race;
    const g = powerTurn(40);
    assert.ok(g.spin < 1.2, `GT3 at 40 km/h: a rear wheel reached ${g.spin.toFixed(2)}x the road speed, want < 1.2`);
  } finally { CAR.profile = VEHICLE_PROFILES.muscle; }
});

test('gta: you can brake and steer at once -- the fronts do not lock and the car turns', () => {
  const b = brakeTurn(80, 1, 1);
  assert.ok(b.frontLockedFrac < 0.15, `fronts locked ${(b.frontLockedFrac * 100).toFixed(0)}% of a braking turn, want < 15%`);
  assert.ok(b.headingDeg1s > 15, `turned ${b.headingDeg1s.toFixed(0)} deg in the first second of a braking turn, want > 15`);
  assert.ok(b.maxBetaDeg < 30, `braking turn slip ${b.maxBetaDeg.toFixed(0)} deg: a slide, not a spin`);
});

test('gta: the handbrake throws the TAIL out and it straightens itself when released', () => {
  const off = handbrake(0), on = handbrake(1);
  assert.ok(on.maxBetaDeg > 25 && on.maxBetaDeg < 55, `handbrake slip ${on.maxBetaDeg.toFixed(0)} deg, want 25-55`);
  // a left turn: tail out means the car travels to the RIGHT of its nose (the mirrored frame went nose-out)
  assert.ok(on.sideDeg > 0, `slip ${on.sideDeg.toFixed(0)} deg: + is tail out, - nose out`);
  assert.ok(off.maxBetaDeg < 8, `no handbrake: ${off.maxBetaDeg.toFixed(0)} deg`);
  assert.ok(on.recoverS !== null && on.recoverS < 1.2, `back under 8 deg ${on.recoverS?.toFixed(2)} s after release, want < 1.2`);
  assert.ok(on.speedAfter > 15, `still rolling (${on.speedAfter.toFixed(0)} km/h) after the slide`);
});

test('gta: a wheel let go locked at a crawl rolls back up to the road, it does not chatter', () => {
  // the coupled solve's tyre stiffness is the SECANT: on the tangent (0 past the peak) this flipped 59 times in 0.5 s
  for (const kmh of [5, 10, 40]) {
    const w = unlockFront(kmh);
    assert.ok(w.flips === 0, `${kmh} km/h: the front's slip speed changed sign ${w.flips} times, want 0`);
    assert.ok(w.settle !== null && w.settle <= 12, `${kmh} km/h: on the road speed after ${w.settle} steps, want <= 12`);
  }
});

test('gta: from 40 km/h the handbrake is a U-turn, not a spin -- on the light GT3 too', () => {
  // the GT3 read '145 deg' when slip was measured through the stop; while moving it slides <= 42 deg
  try {
    for (const p of ['muscle', 'gt3_race']) {
      CAR.profile = VEHICLE_PROFILES[p];
      const h = handbrake(1, 40);
      assert.ok(h.maxBetaDeg < 60, `${p}: slid at ${h.maxBetaDeg.toFixed(0)} deg while moving, want < 60`);
      assert.ok(h.yawDeg > 60 && h.yawDeg < 135, `${p}: turned ${h.yawDeg.toFixed(0)} deg of heading, want 60-135`);
    }
  } finally { CAR.profile = VEHICLE_PROFILES.muscle; }
});

test('gta: through main.js steering ramp a key tap is gentle, a held key turns, W+A+Space drifts', () => {
  const k = keyStep(80);
  assert.ok(Math.abs(k.r01) < 0.1, `yaw rate ${k.r01.toFixed(2)} rad/s 0.1 s into a key press at 80 km/h, want < 0.1`);
  assert.ok(k.r10 > 0.45, `yaw rate ${k.r10.toFixed(2)} rad/s after holding the key 1 s at 80 km/h, want > 0.45`);
  assert.ok(k.peak < 0.8, `peak yaw ${k.peak.toFixed(2)} rad/s: no overshoot`);
  const t = tapHandbrake(70, 0.6);
  assert.ok(t.maxBetaDeg > 20 && t.maxBetaDeg < 50, `W+A with Space tapped 0.6 s at 70 km/h: ${t.maxBetaDeg.toFixed(0)} deg, want 20-50`);
});

test('gta: kinematics -- a yawing car in the air keeps its velocity', () => {
  const k = airRatio();
  assert.ok(Math.abs(k) < 0.1, `velocity turned ${k.toFixed(2)} rad per rad of yaw, want ~0`);
});

test('gta: the engine revs with the wheels in the air, and the car lands straight', () => {
  // the per-wheel drive cap held the driven wheels at road speed in the air (x0.99, rpm at the launch flare)
  const a = airRev(100);
  assert.ok(a.wheelGain > 1.2, `driven wheels x${a.wheelGain.toFixed(2)} over 0.5 s airborne at full throttle, want > 1.2`);
  assert.ok(a.maxBetaDeg < 3 && a.landedKmh > 95, `landed at ${a.landedKmh.toFixed(0)} km/h, ${a.maxBetaDeg.toFixed(1)} deg of slip`);
});

test('gta: walls still scrape and stop', () => {
  /* Full throttle along a wall should drive: 49 km/h kept (sim 30). 35 is the
     floor because under a peak-sized drive cap the rear the scrape unloads
     spun up, the axle's traction control read it and cut the loaded rear to
     its 35% floor, and the car kept 24 km/h (the 35 before that was the free
     fronts' phantom push, gone with the lagged road acceleration). The
     street body (every unlisted car) too: with the TC on the axle average
     it kept 36 with that rear at 1.59x the road. */
  try {
    for (const p of ['muscle', 'street']) {
      CAR.profile = VEHICLE_PROFILES[p];
      const s = scrape(60, 6);
      assert.ok(s.after > 35 && s.after < 58, `${p}: scrape left ${s.after.toFixed(0)} km/h, want 35-58`);
      // ...and the unloaded rear must not burn out against the wall (2.7x the road under a peak-sized drive cap)
      assert.ok(s.spin < 1.3, `${p}: a rear wheel ran ${s.spin.toFixed(2)}x the road speed along the wall, want < 1.3`);
    }
  } finally { CAR.profile = VEHICLE_PROFILES.muscle; }
  assert.ok(headOn(60).after < 5);
});

test('the autopilot follows its route at least as well under gta as under sim (shared steerLimit)', () => {
  const run = (assist) => {
    CAR.assist = assist;
    const route = buildRoute([{ go: 2 }, { go: 1, turn: 'L' }, { go: 1, turn: 'R' }, { go: 1, turn: 'R' }, { go: 1, turn: 'L' }]);
    const c = settled();
    c.x = route[0][0]; c.z = route[0][1];
    c.yaw = Math.atan2(-(route[1][1] - route[0][1]), route[1][0] - route[0][0]);
    const ap = new Autopilot(route, { cruise: 24 });
    let worst = 0, sum = 0, n = 0;
    for (let t = 0; !ap.done && t < 90; t += H) {
      ap.update(c, H); stepVehicle(c, H);
      let e = Infinity;
      for (let k = Math.max(0, ap.index - 4); k < Math.min(route.length - 1, ap.index + 4); k++) {
        const [ax, az] = route[k], [bx, bz] = route[k + 1], dx = bx - ax, dz = bz - az;
        const u = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / (dx * dx + dz * dz || 1)));
        e = Math.min(e, Math.hypot(c.x - ax - dx * u, c.z - az - dz * u));
      }
      worst = Math.max(worst, e); sum += e; n++;
    }
    return { done: ap.done, worst, mean: sum / n };
  };
  try {
    const sim = run(null), gta = run(HANDLING.gta);
    assert.ok(sim.done && gta.done, 'both finish the route');
    assert.ok(gta.mean <= sim.mean * 1.1 + 0.05, `gta mean cross-track ${gta.mean.toFixed(2)} m vs sim ${sim.mean.toFixed(2)} m`);
    assert.ok(gta.worst < 8, `gta worst cross-track ${gta.worst.toFixed(2)} m`);
  } finally { CAR.assist = HANDLING.gta; }
});

test('left and right turns are mirror images (Ackermann steers the INSIDE wheel more)', () => {
  const turn = (s, kmh) => {
    const c = settled(); c.yaw = 0;
    while (c.fwdSpeed < kmh / 3.6) { c.throttle = 1; c.wantsForward = true; stepVehicle(c, H); }
    c.throttle = 0; const y0 = c.yaw;
    for (let t = 0; t < 1.5; t += H) { c.steerTarget = s; stepVehicle(c, H); }
    return c.yaw - y0;
  };
  for (const kmh of [20, 30, 60]) {
    const l = turn(1, kmh), r = turn(-1, kmh);
    assert.ok(l > 0 && r < 0, 'A turns left, D turns right');
    assert.ok(Math.abs(l + r) < 0.01 * Math.abs(l), `${kmh} km/h: left ${(l * 57.3).toFixed(1)} deg vs right ${(-r * 57.3).toFixed(1)} deg`);
  }
});
