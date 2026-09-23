import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR, H, openField, settled, launch, brake100, steadyLock, coastLock, powerLock, liftOff,
  handbrake, brakeTurn, tapHandbrake, keyStep, airRatio, scrape, headOn, powerTurn,
} from '../tools/sim/handling.mjs';
import { HANDLING, VEHICLE_PROFILES, pickHandling } from '../src/vehicle/config.js';
import { stepVehicle, steerLimit, createCarState, resetCar } from '../src/vehicle/dynamics.js';
import { Autopilot, buildRoute } from '../src/game/autopilot.js';

/*
 * The GTA handling profile -- the game default (main.js car.assist) -- pinned
 * on the default body (s-camaro-350 -> VEHICLE_PROFILES.muscle) on open flat
 * tarmac, so no scenario can end in the legacy grid's building line. Its own
 * file because openField() swaps metrics.js's module-global district for the
 * whole process; node --test gives every file its own.
 *
 * Measured 2026-09-23 (node tools/sim/handling.mjs gta --profile=muscle --open):
 * 0-100 5.23 s, 214 km/h; 100-0 33.6 m, fronts locked 0%; full lock
 * 1.14 / 1.19 / 1.21 g at 50 / 80 / 120 km/h, slip <= 2.4 deg, an 18 m circle
 * at 50; WOT + lock 9.5 deg, lift-off 1.5; handbrake 46 deg at 60, tail out,
 * under 8 again 0.45 s after letting go, 27 km/h left; W+A with Space tapped
 * 0.6 s at 70: 27 deg; brake + full lock at 80: fronts locked 0%, 21 deg of
 * heading in the first second. sim on the same car: 0.62 g, a 34 m circle,
 * handbrake 4 deg, brake + lock 98% locked. Bands, not values, with room for a
 * tuning pass.
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
  // respawns, WASTED/BUSTED and R all go through resetCar; the garage only rewrites car.profile
  const c = createCarState(); c.assist = HANDLING.gta; c.profile = VEHICLE_PROFILES.muscle;
  c.vx = 20; c.yawRate = 1; resetCar(c);
  assert.equal(c.assist, HANDLING.gta);
  c.profile = VEHICLE_PROFILES.gt3_race;
  assert.equal(c.assist, HANDLING.gta);
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
    assert.ok(s.latG > 0.95 && s.latG < 1.3, `${kmh} km/h: ${s.latG.toFixed(2)} g, want 0.95-1.3`);
    assert.ok(s.maxBetaDeg < 8, `${kmh} km/h: body slip ${s.maxBetaDeg.toFixed(1)} deg, want < 8`);
  }
  const r50 = steadyLock(50).radius;
  assert.ok(r50 < 20, `full lock at 50 km/h drives a ${r50.toFixed(1)} m circle, want < 20`);
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

test('gta: walls still scrape and stop', () => {
  const s = scrape(60, 6);
  assert.ok(s.after > 25 && s.after < 58, `scrape left ${s.after.toFixed(0)} km/h`);
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
