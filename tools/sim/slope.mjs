/**
 * Slope harness: the shipped stepVehicle on a synthetic inclined plane.
 *   node tools/sim/slope.mjs
 * `plane(gx, gz)` installs infinite tarmac whose height is gx * x + gz * z (a
 * car at yaw 0 faces +X, so gx > 0 is uphill ahead and gz is camber);
 * `plane(0, 0)` is the flat field, `plane()` restores the legacy grid.
 * test/slope.test.js asserts on the same functions.
 */
import { createCarState, resetCar, stepVehicle } from '../../src/vehicle/dynamics.js';
import { useDistrict } from '../../src/world/metrics.js';
import { HANDLING, VEHICLE_PROFILES } from '../../src/vehicle/config.js';

export const H = 1 / 120;
const KMH = 3.6;

export function plane(gx, gz) {
  useDistrict(gx === undefined ? null : { roadDepth: () => -50, elevationAt: (x, z) => gx * x + gz * z, blockTypeAt: () => null });
}

/** A muscle-profile car settled on the current plane for 2 s with `hold` applied every step (the autobox may not leave neutral). */
export function parked(assist, hold = {}) {
  const c = createCarState(); resetCar(c);
  c.x = 0; c.z = 0; c.yaw = 0; c.assist = assist; c.profile = VEHICLE_PROFILES.muscle;
  return c;
}
export function run(c, seconds, hold = {}) {
  for (let i = 0, n = Math.round(seconds / H); i < n; i++) { Object.assign(c, hold); stepVehicle(c, H); }
  return c;
}

/** Left alone on a grade for `seconds` with `hold` ({ gear: 1 } = neutral, { hand: 1 }, { brake: 1 }): metres moved along x, final km/h. */
export function leftAlone(assist, grade, hold, seconds = 30) {
  plane(grade, 0);
  const c = run(parked(assist), seconds, hold);
  return { x: c.x, z: c.z, kmh: c.vx * KMH };
}

/** Coast in neutral from `kmh` for `seconds` on a grade (+ = uphill): the speed left. */
export function coast(assist, grade, kmh = 60, seconds = 3) {
  plane(grade, 0);
  const c = run(parked(assist), 2, { gear: 1, brake: 1 });
  c.brake = 0; c.vx = kmh / KMH; c.vz = 0;
  run(c, seconds, { gear: 1 });
  return c.vx * KMH;
}

/** Drive straight in neutral at `kmh` across a camber (ground rising toward +z) for `seconds`: sideways drift in metres (+z = uphill). */
export function camber(assist, grade, kmh = 60, seconds = 3) {
  plane(0, grade);
  const c = run(parked(assist), 2, { gear: 1, brake: 1 });
  const z0 = c.z;
  c.brake = 0; c.vx = kmh / KMH; c.vz = 0;
  run(c, seconds, { gear: 1 });
  return { drift: c.z - z0, yawDeg: c.yaw * 180 / Math.PI };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = (v, d = 2) => v.toFixed(d);
  for (const [name, A] of [['gta', HANDLING.gta], ['sim', null]]) {
    console.log(`--- ${name}, muscle, 1/120 s`);
    for (const [label, hold] of [['neutral', { gear: 1 }], ['in gear, no input', {}], ['handbrake', { hand: 1 }], ['foot brake', { brake: 1 }]]) {
      const a = leftAlone(A, 0.10, hold, 5), b = leftAlone(A, 0.10, hold, 30);
      console.log(`10% grade, nose uphill, ${label.padEnd(18)} 5 s: ${f(a.x)} m ${f(a.kmh)} km/h   30 s: ${f(b.x)} m ${f(b.kmh)} km/h`);
    }
    const flat = leftAlone(A, 0, { gear: 1 }, 30);
    console.log(`flat, neutral, 30 s: ${f(flat.x, 4)} m`);
    console.log(`coast 3 s from 60 km/h: uphill 10% ${f(coast(A, 0.10))}  flat ${f(coast(A, 0))}  downhill 10% ${f(coast(A, -0.10))} km/h`);
    const c = camber(A, 0.10);
    console.log(`10% camber at 60 km/h, 3 s: drift ${f(c.drift, 3)} m (negative = downhill), yaw ${f(c.yawDeg)} deg`);
    plane(0, 0.10);
    const p = run(parked(A), 30, { gear: 1 });
    console.log(`10% camber, parked in neutral 30 s: moved ${f(Math.hypot(p.x, p.z), 4)} m`);
  }
  plane();
}
