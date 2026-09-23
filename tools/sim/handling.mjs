/**
 * Node handling harness for the hero car -- no browser, no three.
 *
 * Drives the shipped `stepVehicle` at the game's 1/120 s step and reports the
 * numbers the 2026-09-09 review measured: launch, top speed, braking + front
 * lock, peak lateral g, coast-and-lock heading change, handbrake slide and a
 * wall scrape -- plus, since 2026-09-23, the GTA-feel scenarios (steady full
 * lock, power and lift-off oversteer, braking in a turn, a held W + A power
 * turn, the handbrake's release, a key step and a W+A+Space drift entry
 * through main.js's steering ramp, the airborne kinematics) and the fix pass's
 * (a car left alone coasting / released / braked, a lock let go at a crawl,
 * the yaw wobble of a long held lock, a jump at full throttle).
 * `test/handling.test.js` (sim) and `test/handling-gta.test.js` (gta) assert
 * bands on the same functions so a tuning change cannot regress the balance
 * silently.
 *
 *   node tools/sim/handling.mjs                        the sim table, bare V profile, legacy grid
 *   node tools/sim/handling.mjs gta --profile=muscle --open
 *                                                      gta, the in-game default body, flat tarmac
 *
 * WHERE it drives matters. By default the legacy grid road (no district
 * loaded, so `surfaceAt` falls back to the kerb-offset rule), with the car at
 * (0, 0): the kerb is 9.2 m out (metrics.js ROAD_HALF) and the building line
 * 13.2 m (collision.js). A full-lock circle above ~40 km/h meets the kerb at
 * ~1.6-1.8 s and the building line at ~1.9-2.2 s, so the grid's 'held lock'
 * peaks are partly a WALL IMPULSE (1.47 g at 80 km/h before the 2026-09-23
 * frame fix) and its big body slips are the car spinning against it.
 * `openField()` swaps in infinite flat tarmac; anything about tyres, not
 * walls, belongs there. scrape()/headOn() bring their own walls, so they
 * behave the same either way.
 *
 * Every scenario starts from `settled()`: a car parked for three seconds so
 * the springs have found their sag before anything is measured, wearing
 * CAR.assist (config.js HANDLING: null = sim) and CAR.profile (null = the bare
 * V constants; the game's default Camaro is VEHICLE_PROFILES.muscle).
 */
import { createCarState, resetCar, stepVehicle } from '../../src/vehicle/dynamics.js';
import { useDistrict } from '../../src/world/metrics.js';
import { HANDLING, VEHICLE_PROFILES, WHEEL_R } from '../../src/vehicle/config.js';

const FIELD = { roadDepth: () => -50, elevationAt: () => 0, blockTypeAt: () => null };
/** Infinite flat tarmac (on = true) or back to the legacy grid (false). The
    district hook in metrics.js is module-global: a test file that calls this
    changes every scenario after it, so restore it or keep it in its own file. */
export function openField(on = true) { useDistrict(on ? FIELD : null); }
/** Car set-up for every scenario: { assist: HANDLING.gta | null, profile: VEHICLE_PROFILES.x | null }. */
export const CAR = { assist: null, profile: null };

export const H = 1 / 120;
const KMH = 3.6;
const DEG = 180 / Math.PI;

export function settled() {
  const c = createCarState(); resetCar(c);
  c.x = 0; c.z = 0; c.yaw = 0; c.assist = CAR.assist; c.profile = CAR.profile;
  for (let i = 0; i < 360; i++) stepVehicle(c, H);
  return c;
}

/** Body slip angle, rad: the angle between where the car points and where it
    goes, + = moving to the RIGHT of the nose (the tail out in a left turn). */
export const beta = (c) => Math.atan2(c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw), c.fwdSpeed);

function accelerateTo(c, kmh) {
  c.wantsForward = true; c.throttle = 1;
  let n = 0;
  while (c.fwdSpeed * KMH < kmh && n++ < 120 * 60) stepVehicle(c, H);
  return c;
}

/** Full throttle from rest for 40 s: 0-100 time and the speed it settles at. */
export function launch() {
  const c = settled(); c.throttle = 1; c.wantsForward = true;
  let t = 0, t100 = null;
  for (let i = 0; i < 120 * 40; i++) {
    stepVehicle(c, H); t += H;
    if (t100 === null && c.fwdSpeed * KMH >= 100) t100 = t;
  }
  return { t100, vmax: c.fwdSpeed * KMH };
}

/** Full brake from 100 km/h: distance, time and the share of steps with the fronts locked. */
export function brake100() {
  const c = accelerateTo(settled(), 100);
  c.throttle = 0; c.brake = 1; c.wantsForward = false;
  const x0 = c.x; let t = 0, locked = 0, n = 0, peak = 0;
  while (c.fwdSpeed > 0.5 && n < 120 * 20) {
    stepVehicle(c, H); t += H; n++;
    peak = Math.min(peak, c.lastAx);
    if (Math.abs(c.wheelW[0]) < 1) locked++;
  }
  return { dist: c.x - x0, t, peakG: -peak / 9.81, frontLockedFrac: locked / n };
}

/** Full lock at a held speed for 4 s: the largest lateral g seen while the
    body slip is still under 20 deg (the rear has not let go). */
export function heldLock(kmh, seconds = 4) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 1;
  let peakLatG = 0, maxBeta = 0;
  for (let i = 0; i < 120 * seconds; i++) {
    const err = kmh / KMH - c.fwdSpeed;
    c.throttle = Math.max(0, Math.min(1, 0.3 + err * 0.5));
    stepVehicle(c, H);
    const b = Math.abs(beta(c));
    maxBeta = Math.max(maxBeta, b);
    if (b < 0.35) peakLatG = Math.max(peakLatG, Math.abs(c.lastAy) / 9.81);
  }
  return { peakLatG, maxBetaDeg: maxBeta * 180 / Math.PI, speed: c.speed * KMH };
}

/** Lift off and wind on full lock at `kmh`: heading change and body slip over 2 s. */
export function coastLock(kmh = 80, seconds = 2) {
  const c = accelerateTo(settled(), kmh);
  c.throttle = 0; c.steerTarget = 1;
  const y0 = c.yaw; let maxBeta = 0;
  for (let i = 0; i < 120 * seconds; i++) { stepVehicle(c, H); maxBeta = Math.max(maxBeta, Math.abs(beta(c))); }
  return { headingDeg: Math.abs(c.yaw - y0) * 180 / Math.PI, maxBetaDeg: maxBeta * 180 / Math.PI, speed: c.speed * KMH };
}

/** Full lock (LEFT) at `kmh`, throttle off, 1.5 s, with (`hand` 1) or
    without (0) the handbrake. Then let go -- wheel straight, a whiff of
    throttle -- and time how long the slip takes to get back under 8 deg (0 if
    it never left). `sideDeg` is the signed slip at its largest: + = moving to
    the right of the nose, i.e. the tail stepped OUT of the left turn. Slip
    only counts while the car does over 3 m/s: from 40 km/h the slide stops the
    car inside the 1.5 s, and the direction of a ~0 velocity is noise (the GT3
    read '145 deg, a spin' off its last centimetres; it slid at <= 42 deg and
    turned ~110 deg of heading, a handbrake U-turn, 2026-09-23). `yawDeg` is
    the heading turned while the lever was held. */
export function handbrake(hand, kmh = 60) {
  const c = accelerateTo(settled(), kmh);
  c.throttle = 0; c.steerTarget = 1; c.hand = hand;
  let maxBeta = 0, side = 0; const y0 = c.yaw;
  for (let i = 0; i < 180; i++) { stepVehicle(c, H); const b = beta(c); if (c.speed > 3 && Math.abs(b) > maxBeta) { maxBeta = Math.abs(b); side = b; } }
  const out = { maxBetaDeg: maxBeta * DEG, sideDeg: side * DEG, yawDeg: (c.yaw - y0) * DEG, rearW: c.wheelW[2], speed: c.speed * KMH, recoverS: null };
  c.hand = 0; c.steerTarget = 0; c.throttle = 0.25;
  if (Math.abs(beta(c)) < 8 / DEG) out.recoverS = 0;
  for (let i = 0; i < 300; i++) { stepVehicle(c, H); if (out.recoverS === null && Math.abs(beta(c)) < 8 / DEG) out.recoverS = (i + 1) * H; }
  out.speedAfter = c.speed * KMH;
  return out;
}

/** Brake and steer at once from `kmh` (`brake` and `steer` held to a stop):
    the share of steps with a front wheel below 70% of the road speed, the
    heading gained in the first second, the stopping distance and the largest
    body slip. A car whose fronts lock goes straight on. */
export function brakeTurn(kmh = 80, steer = 1, brake = 1) {
  const c = accelerateTo(settled(), kmh);
  c.throttle = 0; c.wantsForward = false; c.steerTarget = steer; c.brake = brake;
  const y0 = c.yaw, x0 = c.x, z0 = c.z; let n = 0, locked = 0, head1 = 0, maxBeta = 0;
  while (c.fwdSpeed > 1 && n < 120 * 8) {
    stepVehicle(c, H); n++;
    if (c.wheelW[0] * WHEEL_R < 0.7 * c.fwdSpeed || c.wheelW[1] * WHEEL_R < 0.7 * c.fwdSpeed) locked++;
    maxBeta = Math.max(maxBeta, Math.abs(beta(c)));
    if (n === 120) head1 = (c.yaw - y0) * DEG;
  }
  return { frontLockedFrac: locked / n, headingDeg1s: head1, dist: Math.hypot(c.x - x0, c.z - z0), maxBetaDeg: maxBeta * DEG };
}

/** Full throttle and full lock from `kmh` for 3 s: power oversteer. */
export function powerLock(kmh = 30) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 1; c.throttle = 1; let maxBeta = 0;
  for (let i = 0; i < 360; i++) { stepVehicle(c, H); maxBeta = Math.max(maxBeta, Math.abs(beta(c))); }
  return { maxBetaDeg: maxBeta * DEG, speed: c.speed * KMH };
}

/** Held at the limit (full lock, speed held) for 2 s at `kmh`, then the throttle snapped shut: lift-off oversteer. */
export function liftOff(kmh = 100) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 1;
  for (let i = 0; i < 240; i++) { c.throttle = Math.max(0, Math.min(1, 0.3 + (kmh / KMH - c.fwdSpeed) * 0.5)); stepVehicle(c, H); }
  c.throttle = 0; let maxBeta = 0;
  for (let i = 0; i < 240; i++) { stepVehicle(c, H); maxBeta = Math.max(maxBeta, Math.abs(beta(c))); }
  return { maxBetaDeg: maxBeta * DEG, speed: c.speed * KMH };
}

/** Steady-state full lock at `kmh` for `seconds`: lateral g as speed x yaw rate
    averaged over the last second (the tyres' steady force, not a transient or
    a wall), the largest body slip, and the radius of the circle it drives. */
export function steadyLock(kmh, seconds = 4) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 1; let sum = 0, n = 0, maxBeta = 0;
  for (let i = 0; i < 120 * seconds; i++) {
    c.throttle = Math.max(0, Math.min(1, 0.3 + (kmh / KMH - c.fwdSpeed) * 0.5));
    stepVehicle(c, H); maxBeta = Math.max(maxBeta, Math.abs(beta(c)));
    if (i >= 120 * (seconds - 1)) { sum += c.speed * Math.abs(c.yawRate) / 9.81; n++; }
  }
  return { latG: sum / n, maxBetaDeg: maxBeta * DEG, radius: c.speed / Math.max(1e-3, Math.abs(c.yawRate)), speed: c.speed * KMH };
}

/* A car you have stopped must STAY stopped (2026-09-23 review): gta's first
   implicit wheel update left the body chattering at the step rate at a crawl,
   and the chatter drove it -- a coasting GT3 never stopped (5.5 km/h after
   3 min), a released one crept 82 m a minute. Three ways to leave a car. */

/** Accelerate to `kmh`, lift off (main.js's throttle lag) and coast `seconds`
    in gear: the speed left and the distance covered in the last 30 s. */
export function coastToRest(kmh = 40, seconds = 180) {
  const c = accelerateTo(settled(), kmh);
  c.wantsForward = false; let x30 = 0, z30 = 0;
  for (let i = 0; i < 120 * seconds; i++) {
    c.throttle += (0 - c.throttle) * Math.min(1, H * 11);
    stepVehicle(c, H);
    if (i === 120 * (seconds - 30)) { x30 = c.x; z30 = c.z; }
  }
  return { kmh: c.speed * KMH, last30: Math.hypot(c.x - x30, c.z - z30) };
}

/** Brake to a stop from `kmh`, then let go of the pedal (main.js's brake lag)
    and wait `seconds`: how far the car moves on its own. */
export function stopAndRelease(kmh = 30, seconds = 60) {
  const c = accelerateTo(settled(), kmh);
  c.wantsForward = false; c.throttle = 0; c.brake = 1;
  for (let n = 0; c.speed > 0.05 && n < 120 * 10; n++) stepVehicle(c, H);
  const x0 = c.x, z0 = c.z;
  for (let i = 0; i < 120 * seconds; i++) { c.brake += (0 - c.brake) * Math.min(1, H * 15); stepVehicle(c, H); }
  return { moved: Math.hypot(c.x - x0, c.z - z0), kmh: c.speed * KMH };
}

/** Brake to a stop from `kmh` and HOLD the brake (what main.js does on foot,
    where the empty car keeps stepping) for `seconds`: how far it moves. */
export function parkedBrake(kmh = 30, seconds = 120) {
  const c = accelerateTo(settled(), kmh);
  c.wantsForward = false; c.throttle = 0; c.brake = 1;
  for (let n = 0; c.speed > 0.05 && n < 120 * 10; n++) stepVehicle(c, H);
  const x0 = c.x, z0 = c.z;
  for (let i = 0; i < 120 * seconds; i++) stepVehicle(c, H);
  return { moved: Math.hypot(c.x - x0, c.z - z0), kmh: c.speed * KMH };
}

/** Coasting at `kmh`, the fronts' spin zeroed (a lock, brake off): how often
    their slip speed changes sign over 0.5 s and the step they settle within
    0.05 m/s of the road. A wheel past its peak is where an implicit step on
    the TANGENT stiffness (0 there) turns explicit and jumps across the road
    speed: at 5 km/h 59 sign flips, never settled. */
export function unlockFront(kmh = 5) {
  const c = accelerateTo(settled(), kmh);
  c.throttle = 0; c.wantsForward = false; c.wheelW[0] = 0; c.wheelW[1] = 0;
  let flips = 0, prev = null, settle = null;
  for (let i = 0; i < 60; i++) {
    stepVehicle(c, H);
    const e = c.wheelW[0] * WHEEL_R - c.fwdSpeed;
    if (prev !== null && Math.sign(e) !== Math.sign(prev) && Math.abs(e) > 0.02) flips++;
    if (settle === null && Math.abs(e) < 0.05) settle = i + 1;
    prev = e;
  }
  return { flips, settle };
}

/** Full lock held at `kmh` (speed held) for `seconds`: the yaw rate's peak to
    peak over the last 3 s as a share of its mean. A steady turn is ~0; with
    gta's yaw damping flat at 0.4/s (no yawDampHi) the car pumped round a
    long bend at ~0.7 Hz, 26 / 53 / 50% at 80 / 120 / 160 km/h (2026-09-23). */
export function lockWobble(kmh, seconds = 6) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 1; let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < 120 * seconds; i++) {
    c.throttle = Math.max(0, Math.min(1, 0.3 + (kmh / KMH - c.fwdSpeed) * 0.5));
    stepVehicle(c, H);
    if (i >= 120 * (seconds - 3)) { lo = Math.min(lo, c.yawRate); hi = Math.max(hi, c.yawRate); sum += c.yawRate; n++; }
  }
  return { p2p: (hi - lo) / Math.max(1e-6, Math.abs(sum / n)), meanYaw: sum / n, speed: c.speed * KMH };
}

/** Airborne (60 m up, springs off the ground), no tyre force, body yawing at
    1 rad/s: how far the velocity turns per radian of heading. Physics: 0.
    Before the 2026-09-23 frame fix, 2.02. */
export function airRatio() {
  const c = settled(); c.y = 60; c.vx = 20; c.vz = 0; c.yawRate = 1; const y0 = c.yaw;
  for (let i = 0; i < 30; i++) { c.vy = 0; c.y = 60; stepVehicle(c, H); }
  return Math.atan2(-c.vz, c.vx) / (c.yaw - y0);
}

/** At `kmh`, full throttle, held 3 m up for 0.5 s (a jump), then dropped: the
    driven wheels' speed before and after the flight, the rpm it reached and
    the speed 2 s after landing. gta's per-wheel drive cap once held the
    wheels at road speed in the air (rpm stuck at the launch flare). */
export function airRev(kmh = 100) {
  const c = accelerateTo(settled(), kmh);
  const w0 = c.wheelW[2], y0 = c.y; let rpm = 0;
  for (let i = 0; i < 60; i++) { c.y = y0 + 3; c.vy = 0; stepVehicle(c, H); rpm = Math.max(rpm, c.rpm); }
  const w1 = c.wheelW[2];
  for (let i = 0; i < 240; i++) stepVehicle(c, H);
  return { wheelGain: w1 / w0, rpm, landedKmh: c.speed * KMH, maxBetaDeg: Math.abs(beta(c)) * DEG };
}

/** main.js's digital steering ramp (the keyboard path, main.js ~2346): a
    held key does not hand stepVehicle +-1 at once, it winds steerTarget
    toward it at 7.0 - 3.6 x speedNorm per second, 2.2x as fast back. */
function rampSteer(c, key, dt = H) {
  const rate = 7.0 - 3.6 * Math.min(1, Math.hypot(c.vx, c.vz) / 38);
  const back = key === 0 || Math.sign(key) !== Math.sign(c.steerTarget);
  c.steerTarget += (key - c.steerTarget) * Math.min(1, dt * rate * (back ? 2.2 : 1));
}

/** A steering key pressed and held at `kmh` (speed held), through main.js's
    ramp: yaw rate at 0.1 / 0.5 / 1.0 s and its peak -- a tap must not snap
    the car round and a held key must actually turn it. */
export function keyStep(kmh = 80) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 0; const at = {}; let peak = 0;
  for (let i = 0; i < 120; i++) {
    rampSteer(c, 1);
    c.throttle = Math.max(0, Math.min(1, 0.3 + (kmh / KMH - c.fwdSpeed) * 0.5));
    stepVehicle(c, H); peak = Math.max(peak, Math.abs(c.yawRate));
    if (i === 11) at.r01 = c.yawRate;
    if (i === 59) at.r05 = c.yawRate;
    if (i === 119) at.r10 = c.yawRate;
  }
  return { ...at, peak };
}

/** W + A held for 4 s from `kmh` (throttle with main.js's lag, the steer
    through its ramp): the fastest a rear wheel's surface turns relative to
    the road, the share of steps the car smokes (car.slip > 0.3, main.js's
    tyre-smoke gate) and the speed it comes out at. A driven wheel spinning
    at 3x the road is a burnout in a corner, not a turn. */
export function powerTurn(kmh = 80) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 0; let spin = 0, smoke = 0;
  for (let i = 0; i < 480; i++) {
    rampSteer(c, 1);
    c.throttle += (1 - c.throttle) * Math.min(1, H * 11);
    stepVehicle(c, H);
    if (c.slip > 0.3) smoke++;
    spin = Math.max(spin, Math.max(c.wheelW[2], c.wheelW[3]) * WHEEL_R / Math.max(1, c.fwdSpeed));
  }
  return { spin, smokeFrac: smoke / 480, speed: c.speed * KMH };
}

/** GTA's drift entry: W + A held, Space tapped for `tapS` at the start, the
    steer through main.js's ramp and let go after 2.5 s. Largest body slip. */
export function tapHandbrake(kmh = 70, tapS = 0.6) {
  const c = accelerateTo(settled(), kmh);
  c.steerTarget = 0; let maxBeta = 0;
  for (let i = 0; i < 120 * 5; i++) {
    const t = i * H;
    rampSteer(c, t < 2.5 ? 1 : 0);
    c.throttle += (1 - c.throttle) * Math.min(1, H * 11);                  // main.js's throttle lag
    c.hand += ((t < tapS ? 1 : 0) - c.hand) * Math.min(1, H * 18);         // ...and handbrake lag
    stepVehicle(c, H); maxBeta = Math.max(maxBeta, Math.abs(beta(c)));
  }
  return { maxBetaDeg: maxBeta * DEG, speed: c.speed * KMH };
}

/** A 6 deg scrape along a wall at 60 km/h, throttle held: speed kept after 3 s. */
export function scrape(kmh = 60, deg = 6) {
  const c = accelerateTo(settled(), kmh);
  c.yaw = deg * Math.PI / 180;                          // +yaw heads toward -z, where the wall is
  c.vx = c.speed * Math.cos(c.yaw); c.vz = -c.speed * Math.sin(c.yaw); c.z = -0.2;
  const wall = [{ x: c.x + 80, z: -2.4, angle: 0, hw: 80, hd: 1.0 }];
  c.buildings = () => wall;
  c.throttle = 1; c.steerTarget = 0;
  const s0 = c.speed; let peakImpact = 0, spin = 0;
  for (let i = 0; i < 360; i++) {
    stepVehicle(c, H); peakImpact = Math.max(peakImpact, c.impact);
    spin = Math.max(spin, Math.max(c.wheelW[2], c.wheelW[3]) * WHEEL_R / Math.max(1, c.fwdSpeed));
  }
  // spin: the fastest a rear wheel's surface ran relative to the road (the scrape unloads the one by the wall)
  return { before: s0 * KMH, after: c.speed * KMH, lostKmh: (s0 - c.speed) * KMH, peakImpact, yawDeg: c.yaw * 180 / Math.PI, spin };
}

/** Straight into a wall at 60 km/h: speed 0.5 s after contact (must be a stop). */
export function headOn(kmh = 60) {
  const c = accelerateTo(settled(), kmh);
  const wall = [{ x: c.x + 12, z: 0, angle: 0, hw: 1.0, hd: 20 }];
  c.buildings = () => wall;
  c.throttle = 0;
  let touched = null, t = 0;
  for (let i = 0; i < 360; i++) {
    stepVehicle(c, H); t += H;
    if (touched === null && c.impact > 0) touched = t;
    if (touched !== null && t - touched > 0.5) break;
  }
  return { after: c.speed * KMH, peakImpact: c.impact };
}

export function measureAll() {
  const hb0 = handbrake(0), hb1 = handbrake(1);
  return {
    launch: launch(), brake: brake100(),
    lock50: heldLock(50), lock80: heldLock(80),
    coast80: coastLock(80),
    handbrakeOff: hb0, handbrakeOn: hb1,
    scrape: scrape(), headOn: headOn(),
  };
}

/** The GTA-feel rows (2026-09-23): run on openField() to measure tyres, not walls. */
export function measureFeel() {
  return {
    steady: [50, 80, 120].map((k) => steadyLock(k)), steady20: steadyLock(20),
    power30: powerLock(30), lift100: liftOff(100), brakeTurn80: brakeTurn(80),
    hb: [40, 60, 100].map((k) => handbrake(1, k)),
    tap: [[70, 0.3], [70, 0.6], [100, 0.6]].map(([k, t]) => tapHandbrake(k, t)),
    key80: keyStep(80), air: airRatio(), powerTurn80: powerTurn(80),
    wobble: [80, 120, 160].map((k) => lockWobble(k)),
    coast: coastToRest(), release: stopAndRelease(), parked: parkedBrake(),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  /* args: 'sim' | 'gta' (default sim), --profile=muscle|street|supercar|gt3_race
     (default: the bare V constants), --open (flat tarmac instead of the grid) */
  const args = process.argv.slice(2);
  const mode = args.includes('gta') ? 'gta' : 'sim';
  const pname = (args.find((a) => a.startsWith('--profile=')) || '').slice(10) || null;
  if (pname && !VEHICLE_PROFILES[pname]) throw new Error(`no profile '${pname}': ${Object.keys(VEHICLE_PROFILES).join(' ')}`);
  CAR.assist = HANDLING[mode]; CAR.profile = pname ? VEHICLE_PROFILES[pname] : null;
  if (args.includes('--open')) openField();
  console.log(`-- ${mode}, ${pname || 'bare V'} profile, ${args.includes('--open') ? 'open flat tarmac' : 'legacy grid (walls at 13.2 m)'}`);
  const m = measureAll();
  const f = (x, d = 2) => (x == null ? 'n/a' : x.toFixed(d));
  console.log(`0-100 km/h        ${f(m.launch.t100)} s     top speed ${f(m.launch.vmax, 1)} km/h`);
  console.log(`100-0             ${f(m.brake.dist, 1)} m  ${f(m.brake.t)} s  ${f(m.brake.peakG)} g  fronts locked ${f(m.brake.frontLockedFrac * 100, 0)}% of steps`);
  console.log(`held lock @50     peak lat ${f(m.lock50.peakLatG)} g  max body slip ${f(m.lock50.maxBetaDeg, 0)} deg`);
  console.log(`held lock @80     peak lat ${f(m.lock80.peakLatG)} g  max body slip ${f(m.lock80.maxBetaDeg, 0)} deg`);
  console.log(`coast+lock @80    heading ${f(m.coast80.headingDeg, 0)} deg in 2 s  body slip ${f(m.coast80.maxBetaDeg, 0)} deg  speed after ${f(m.coast80.speed, 0)} km/h`);
  console.log(`handbrake @60     body slip off ${f(m.handbrakeOff.maxBetaDeg, 0)} deg / on ${f(m.handbrakeOn.maxBetaDeg, 0)} deg  (rearW on: ${f(m.handbrakeOn.rearW, 1)})`);
  console.log(`6 deg scrape @60  ${f(m.scrape.before, 0)} -> ${f(m.scrape.after, 0)} km/h after 3 s (lost ${f(m.scrape.lostKmh, 0)})  impact ${f(m.scrape.peakImpact)}  yaw ${f(m.scrape.yawDeg, 1)}  rear wheel up to ${f(m.scrape.spin)}x the road`);
  console.log(`head-on @60       ${f(m.headOn.after, 0)} km/h 0.5 s after contact  impact ${f(m.headOn.peakImpact, 1)}`);
  const g = measureFeel();
  console.log(`steady lock       ${g.steady.map((s, i) => `@${[50, 80, 120][i]} ${f(s.latG)} g slip ${f(s.maxBetaDeg, 1)}`).join('  ')}  circle @50 ${f(g.steady[0].radius, 1)} m / @20 ${f(g.steady20.radius, 1)} m`);
  console.log(`oversteer         WOT+lock @30 ${f(g.power30.maxBetaDeg, 1)} deg  lift-off @100 ${f(g.lift100.maxBetaDeg, 1)} deg`);
  console.log(`brake + lock @80  fronts locked ${f(g.brakeTurn80.frontLockedFrac * 100, 0)}%  heading ${f(g.brakeTurn80.headingDeg1s, 0)} deg in 1 s  stop ${f(g.brakeTurn80.dist, 1)} m  slip ${f(g.brakeTurn80.maxBetaDeg, 0)} deg`);
  console.log(`handbrake held    ${g.hb.map((h, i) => `@${[40, 60, 100][i]} ${h.sideDeg > 0 ? '+' : ''}${f(h.sideDeg, 0)} deg (yaw ${f(h.yawDeg, 0)}), <8 deg ${f(h.recoverS)} s after, ${f(h.speedAfter, 0)} km/h`).join('  ')}  (+ = tail out)`);
  console.log(`W+A, Space tap    @70 0.3 s ${f(g.tap[0].maxBetaDeg, 0)} deg  @70 0.6 s ${f(g.tap[1].maxBetaDeg, 0)} deg  @100 0.6 s ${f(g.tap[2].maxBetaDeg, 0)} deg`);
  console.log(`W+A held 4 s @80  rear wheel up to ${f(g.powerTurn80.spin)}x the road, smoking ${f(g.powerTurn80.smokeFrac * 100, 0)}% of it, out at ${f(g.powerTurn80.speed, 0)} km/h`);
  console.log(`key step @80      yaw ${f(g.key80.r01)} / ${f(g.key80.r05)} / ${f(g.key80.r10)} rad/s at 0.1 / 0.5 / 1.0 s, peak ${f(g.key80.peak)}`);
  console.log(`airborne          velocity turns ${f(g.air)} rad per rad of yaw (physics: 0)`);
  console.log(`lock wobble       yaw rate peak to peak ${g.wobble.map((w, i) => `@${[80, 120, 160][i]} ${f(w.p2p * 100, 1)}%`).join('  ')} of its mean, last 3 of 6 s`);
  console.log(`at rest           coast from 40: ${f(g.coast.kmh)} km/h after 3 min (${f(g.coast.last30)} m in the last 30 s)  stopped + released: ${f(g.release.moved)} m in 60 s  brake held: ${f(g.parked.moved, 3)} m in 120 s`);
}
