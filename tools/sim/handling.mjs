/**
 * Node handling harness for the hero car -- no browser, no three.
 *
 * Drives the shipped `stepVehicle` at the game's 1/120 s step on the legacy
 * grid road (the district file is not loaded, so `surfaceAt` falls back to the
 * kerb-offset rule) and reports the numbers the 2026-09-09 review measured:
 * launch, top speed, braking + front lock, peak lateral g, coast-and-lock
 * heading change, handbrake slide and a wall scrape. `test/handling.test.js`
 * asserts bands on the same functions so a tuning change cannot regress the
 * balance silently.
 *
 *   node tools/sim/handling.mjs          prints the table
 *
 * Every scenario starts from `settled()`: a car parked for three seconds so
 * the springs have found their sag before anything is measured.
 */
import { createCarState, resetCar, stepVehicle } from '../../src/vehicle/dynamics.js';

export const H = 1 / 120;
const KMH = 3.6;

export function settled() {
  const c = createCarState(); resetCar(c);
  c.x = 0; c.z = 0; c.yaw = 0;
  for (let i = 0; i < 360; i++) stepVehicle(c, H);
  return c;
}

/** Body slip angle, rad: the angle between where the car points and where it goes. */
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

/** Full lock at 60 km/h, throttle off, 1.5 s, with and without the handbrake. */
export function handbrake(hand, kmh = 60) {
  const c = accelerateTo(settled(), kmh);
  c.throttle = 0; c.steerTarget = 1; c.hand = hand;
  let maxBeta = 0;
  for (let i = 0; i < 180; i++) { stepVehicle(c, H); maxBeta = Math.max(maxBeta, Math.abs(beta(c))); }
  return { maxBetaDeg: maxBeta * 180 / Math.PI, rearW: c.wheelW[2], speed: c.speed * KMH };
}

/** A 6 deg scrape along a wall at 60 km/h, throttle held: speed kept after 3 s. */
export function scrape(kmh = 60, deg = 6) {
  const c = accelerateTo(settled(), kmh);
  c.yaw = deg * Math.PI / 180;                          // +yaw heads toward -z, where the wall is
  c.vx = c.speed * Math.cos(c.yaw); c.vz = -c.speed * Math.sin(c.yaw); c.z = -0.2;
  const wall = [{ x: c.x + 80, z: -2.4, angle: 0, hw: 80, hd: 1.0 }];
  c.buildings = () => wall;
  c.throttle = 1; c.steerTarget = 0;
  const s0 = c.speed; let peakImpact = 0;
  for (let i = 0; i < 360; i++) { stepVehicle(c, H); peakImpact = Math.max(peakImpact, c.impact); }
  return { before: s0 * KMH, after: c.speed * KMH, lostKmh: (s0 - c.speed) * KMH, peakImpact, yawDeg: c.yaw * 180 / Math.PI };
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const m = measureAll();
  const f = (x, d = 2) => (x == null ? 'n/a' : x.toFixed(d));
  console.log(`0-100 km/h        ${f(m.launch.t100)} s     top speed ${f(m.launch.vmax, 1)} km/h`);
  console.log(`100-0             ${f(m.brake.dist, 1)} m  ${f(m.brake.t)} s  ${f(m.brake.peakG)} g  fronts locked ${f(m.brake.frontLockedFrac * 100, 0)}% of steps`);
  console.log(`held lock @50     peak lat ${f(m.lock50.peakLatG)} g  max body slip ${f(m.lock50.maxBetaDeg, 0)} deg`);
  console.log(`held lock @80     peak lat ${f(m.lock80.peakLatG)} g  max body slip ${f(m.lock80.maxBetaDeg, 0)} deg`);
  console.log(`coast+lock @80    heading ${f(m.coast80.headingDeg, 0)} deg in 2 s  body slip ${f(m.coast80.maxBetaDeg, 0)} deg  speed after ${f(m.coast80.speed, 0)} km/h`);
  console.log(`handbrake @60     body slip off ${f(m.handbrakeOff.maxBetaDeg, 0)} deg / on ${f(m.handbrakeOn.maxBetaDeg, 0)} deg  (rearW on: ${f(m.handbrakeOn.rearW, 1)})`);
  console.log(`6 deg scrape @60  ${f(m.scrape.before, 0)} -> ${f(m.scrape.after, 0)} km/h after 3 s (lost ${f(m.scrape.lostKmh, 0)})  impact ${f(m.scrape.peakImpact)}  yaw ${f(m.scrape.yawDeg, 1)}`);
  console.log(`head-on @60       ${f(m.headOn.after, 0)} km/h 0.5 s after contact  impact ${f(m.headOn.peakImpact, 1)}`);
}
