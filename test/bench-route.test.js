import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District } from '../src/world/district.js';
import { COMPACT_POLY } from '../src/world/playArea.js';
import { buildRoute, Autopilot, useGraphForRoutes } from '../src/game/autopilot.js';
import { stepVehicle } from '../src/vehicle/dynamics.js';
import { CAR, settled, openField } from '../tools/sim/handling.mjs';
import { HANDLING, VEHICLE_PROFILES } from '../src/vehicle/config.js';

/* The F9 benchmark drives the film autopilot. It used to steer junction to
   junction in straight lines, cutting bent streets through their buildings
   (up to 60 m off the tarmac) and running out of route in 12-42 s. */
test('the benchmark route stays on the tarmac for the whole 90 s run', () => {
  CAR.assist = HANDLING.gta; CAR.profile = VEHICLE_PROFILES.muscle; openField();
  const d = new District(JSON.parse(readFileSync('public/halstead-bay.district.json', 'utf8')), { play: COMPACT_POLY });
  useGraphForRoutes(d);
  try {
    const R = buildRoute(null, 2351.5, 1356);
    const car = settled(); car.x = R[0][0]; car.z = R[0][1];
    car.yaw = Math.atan2(-(R[2][1] - R[0][1]), R[2][0] - R[0][0]);
    const ap = new Autopilot(R, { cruise: 26 });
    let worst = -Infinity, t = 0;
    for (; t < 90 && !ap.done; t += 1 / 120) {
      ap.update(car, 1 / 120); stepVehicle(car, 1 / 120);
      worst = Math.max(worst, d.tarmacDepth(car.x, car.z));
    }
    assert.ok(t >= 90, `route ran out after ${t.toFixed(0)} s`);
    assert.ok(worst < 0, `left the tarmac by ${worst.toFixed(1)} m`);
    assert.equal(ap.recovered || 0, 0, 'never needed the stuck reset');
  } finally { useGraphForRoutes(null); }
});
