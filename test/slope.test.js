import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarState, resetCar, stepVehicle } from '../src/vehicle/dynamics.js';
import { useDistrict } from '../src/world/metrics.js';
import { HANDLING, VEHICLE_PROFILES } from '../src/vehicle/config.js';
import { plane, leftAlone, coast, camber, parked, run, H } from '../tools/sim/slope.mjs';

/* Gravity along the slope (dynamics.js, 2026-11-12). The road used to be flat
   as far as the force balance knew: a car in neutral on a 10% grade rolled
   0.00 m. tools/sim/slope.mjs prints the table these bands come from. The
   plane hook is module-global (metrics.js useDistrict), so every test puts
   the legacy grid back. */
const PROFILES = [['gta', HANDLING.gta], ['sim', null]];
const G = 9.81;

/* Bit-identical flat-ground numbers are checked where they are printed: `node
   tools/sim/handling.mjs [gta --profile=muscle] [--open]` gives the same bytes
   before and after, and the handling tests pin their bands. Here: nothing
   moves a car on the level. */
test('level ground is untouched: a car in neutral on the flat stays where it is', () => {
  for (const [name, A] of PROFILES) {
    try {
      const still = leftAlone(A, 0, { gear: 1 }, 30);
      assert.ok(Math.abs(still.x) < 1e-3 && Math.abs(still.z) < 1e-3, `${name}: a car in neutral on the flat stays put`);
    } finally { plane(); }
  }
});

test('in neutral on a 10% grade the car rolls downhill at about g sin(slope) less its rolling drag', () => {
  for (const [name, A] of PROFILES) {
    try {
      const r = leftAlone(A, 0.10, { gear: 1 }, 5);   // nose uphill: it rolls backwards, -x
      assert.ok(r.x < -6 && r.x > -12.3, `${name}: rolled ${r.x.toFixed(2)} m in 5 s (free fall down the slope would be -12.2)`);
      const ideal = G * 0.0995 * 5 * 3.6;             // 17.6 km/h with no drag at all
      assert.ok(-r.kmh > 0.75 * ideal && -r.kmh < ideal, `${name}: ${(-r.kmh).toFixed(1)} km/h after 5 s, ideal ${ideal.toFixed(1)}`);
      const down = leftAlone(A, -0.10, { gear: 1 }, 5); // nose downhill: forwards
      assert.ok(down.x > 6, `${name}: nose-down it rolls forwards (${down.x.toFixed(2)} m)`);
      const gentle = leftAlone(A, 0.04, { gear: 1 }, 5);
      assert.ok(gentle.x < -1 && gentle.x > r.x * 0.6, `${name}: a 4% grade rolls too, and slower (${gentle.x.toFixed(2)} m)`);
    } finally { plane(); }
  }
});

test('the handbrake or the foot brake holds the car on a 10% grade for 30 s', () => {
  try {
    for (const hold of [{ hand: 1 }, { brake: 1 }, { hand: 1, brake: 1, gear: 1 }]) {
      const r = leftAlone(HANDLING.gta, 0.10, hold, 30);
      assert.ok(Math.abs(r.x) < 0.01 && Math.abs(r.z) < 0.01, `gta ${JSON.stringify(hold)}: moved ${r.x.toFixed(4)} m`);
      const d = leftAlone(HANDLING.gta, -0.10, hold, 30);
      assert.ok(Math.abs(d.x) < 0.01, `gta nose-down ${JSON.stringify(hold)}: moved ${d.x.toFixed(4)} m`);
    }
    /* sim's explicit wheels chatter at rest (the reason gta steps them
       implicitly), so its hold is looser: under a metre in 30 s on the lever,
       a few cm on the pedal -- against 300 m with nothing held. */
    assert.ok(Math.abs(leftAlone(null, 0.10, { hand: 1 }, 30).x) < 1.0);
    assert.ok(Math.abs(leftAlone(null, 0.10, { brake: 1 }, 30).x) < 0.1);
  } finally { plane(); }
});

test('coasting uphill loses speed faster than on the flat; downhill keeps more, and from low speed gains', () => {
  for (const [name, A] of PROFILES) {
    try {
      const up = coast(A, 0.10), flat = coast(A, 0), down = coast(A, -0.10);
      assert.ok(up < flat - 6 && down > flat + 2, `${name}: 60 km/h after 3 s -> up ${up.toFixed(1)}, flat ${flat.toFixed(1)}, down ${down.toFixed(1)}`);
      // 3 s of g sin(10%) is 10.5 km/h: the hill's share of the loss should be most of that
      assert.ok(flat - up > 8 && flat - up < 12, `${name}: the hill cost ${(flat - up).toFixed(1)} km/h`);
      assert.ok(coast(A, -0.10, 20, 3) > 24, `${name}: from 20 km/h a 10% descent speeds the car up`);
    } finally { plane(); }
  }
});

test('a camber pulls a moving car gently downhill and the tyres resist; parked on it the car does not slide', () => {
  for (const [name, A] of PROFILES) {
    try {
      const c = camber(A, 0.10);       // ground rises toward +z: downhill is -z
      assert.ok(c.drift < -0.02 && c.drift > -1.0, `${name}: drifted ${c.drift.toFixed(3)} m in 3 s at 60 km/h`);
      assert.ok(Math.abs(c.yawDeg) < 3, `${name}: and stayed pointing ahead (${c.yawDeg.toFixed(2)} deg)`);
      plane(0, 0.10);
      const p = run(parked(A), 30, { gear: 1 });
      assert.ok(Math.hypot(p.x, p.z) < 0.01, `${name}: parked in neutral across the slope it moved ${Math.hypot(p.x, p.z).toFixed(4)} m`);
    } finally { plane(); }
  }
});

test('a kerb is not a hill: with a wheel on the pavement no slope force acts, and a car parked half on the kerb stays', () => {
  for (const [name, A] of PROFILES) {
    try {
      useDistrict(null);               // the legacy grid: kerb 9.2 m from the centreline, 0.15 m high
      const c = createCarState(); resetCar(c);
      c.x = 65; c.z = 9.2; c.yaw = 0; c.assist = A; c.profile = VEHICLE_PROFILES.muscle;   // mid-block, one side on the tarmac, the other up the kerb
      for (let i = 0; i < 30 * 120; i++) { c.gear = 1; stepVehicle(c, H); }
      assert.ok(c.kerb > 0 && c.kerb < 4, `${name}: straddling (${c.kerb} wheels off the tarmac)`);
      assert.ok(Math.abs(c.x - 65) < 0.02 && Math.abs(c.z - 9.2) < 0.02, `${name}: moved ${(c.x - 65).toFixed(3)}, ${(c.z - 9.2).toFixed(3)} m in 30 s`);
    } finally { plane(); }
  }
});
