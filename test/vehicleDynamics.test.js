import test from 'node:test';
import assert from 'node:assert/strict';
import { V, VEHICLE_PROFILES, getVehicleProfile } from '../src/vehicle/config.js';
import { createCarState, stepVehicle, engineTorque } from '../src/vehicle/dynamics.js';
import { RaceCircuit } from '../src/game/raceCircuit.js';
import { useDistrict } from '../src/world/metrics.js';

test('vehicleDynamics: steering responsiveness and return-to-center', () => {
  const car = createCarState();
  const dt = 1 / 120;

  // Apply full steering input at rest
  car.steerTarget = 1.0;
  // Step for 10 frames (~0.083s)
  for (let i = 0; i < 10; i++) {
    stepVehicle(car, dt);
  }

  // With 11.5 rad/s base steer rate, steering should have responded quickly (> 0.25 rad in 0.08s)
  assert.ok(car.steer > 0.25, `steer angle should be responsive: got ${car.steer}`);

  // Now release steering to test return-to-center
  car.steerTarget = 0;
  const steerAtRelease = car.steer;
  for (let i = 0; i < 10; i++) {
    stepVehicle(car, dt);
  }

  // Return to center is accelerated (2.0x): should have decayed by > 50%
  assert.ok(car.steer < steerAtRelease * 0.5, `steering should return toward center quickly: was ${steerAtRelease}, now ${car.steer}`);
});

test('vehicleDynamics: preserves turning authority at high speed', () => {
  const car = createCarState();
  const dt = 1 / 120;

  // Drive at high speed (40 m/s = 144 km/h)
  car.vx = 40;
  car.vz = 0;
  car.steerTarget = 1.0;

  for (let i = 0; i < 60; i++) {
    stepVehicle(car, dt);
  }

  /* At 144 km/h the limit is steerMax * (1 - 0.66), so a third of full lock --
     about 11 deg of road wheel, which is a lane change, not a hairpin. 0.45
     was the 2026-09-16 tuning that made a key tap swing the car to full lock
     at road speed; the floor is what stops the OPPOSITE regression, steering
     choked to nothing at speed. */
  assert.ok(car.steer >= V.steerMax * 0.30, `high speed steering should maintain authority: ${car.steer} vs max ${V.steerMax}`);
  assert.ok(car.steer <= V.steerMax * 0.40, `high speed steering should not be near full lock: ${car.steer} vs max ${V.steerMax}`);
});

test('vehicleDynamics: aerodynamic downforce increases tire normal loads at speed', () => {
  const carRest = createCarState();
  const carSpeed = createCarState();
  const dt = 1 / 120;

  // Both cars use GT3 race profile
  carRest.profile = VEHICLE_PROFILES.gt3_race;
  carSpeed.profile = VEHICLE_PROFILES.gt3_race;

  // Settle at rest
  for (let i = 0; i < 30; i++) {
    stepVehicle(carRest, dt);
  }

  // Settle at high speed (45 m/s = 162 km/h)
  carSpeed.vx = 45;
  for (let i = 0; i < 30; i++) {
    stepVehicle(carSpeed, dt);
  }

  // High speed car with downforce must have compressed suspension more than resting car
  const totalCompRest = carRest.suspension.reduce((a, b) => a + b, 0);
  const totalCompSpeed = carSpeed.suspension.reduce((a, b) => a + b, 0);

  assert.ok(totalCompSpeed > totalCompRest, `high speed downforce should compress suspension more: speed=${totalCompSpeed} vs rest=${totalCompRest}`);
});

test('vehicleDynamics: vehicle profiles differentiate car classes', () => {
  const gt3 = getVehicleProfile('s-porsche-gt3r');
  const c6r = getVehicleProfile('s-corvette-c6r');
  const f40 = getVehicleProfile('s-f40-comp');
  const zr1 = getVehicleProfile('s-corvette-zr1');
  const camaro = getVehicleProfile('s-camaro-350');
  const street = getVehicleProfile('q-normal1');

  assert.equal(gt3, VEHICLE_PROFILES.gt3_race);
  assert.equal(c6r, VEHICLE_PROFILES.gt3_race);
  assert.equal(f40, VEHICLE_PROFILES.gt3_race);
  assert.equal(zr1, VEHICLE_PROFILES.supercar);
  assert.equal(camaro, VEHICLE_PROFILES.muscle);
  assert.equal(street, VEHICLE_PROFILES.street);

  // Check GT3 track credentials
  assert.ok(gt3.gripMult >= 1.25, 'GT3 must have racing slick grip');
  assert.ok(gt3.downF >= 1.5, 'GT3 must have high aerodynamic downforce');
  assert.ok(gt3.redline >= 8500, 'GT3 must rev high');
  assert.ok(gt3.brakeMax > V.brakeMax, 'GT3 must have upgraded track brakes');
});

test('vehicleDynamics: high-rev engine torque curve scales past 8000 RPM', () => {
  const streetTorque7000 = engineTorque(7000, 6800); // Beyond street redline
  const raceTorque7000 = engineTorque(7000, 8600); // Within race redline

  assert.equal(streetTorque7000, 0, 'street engine should taper off at 6800 redline');
  assert.ok(raceTorque7000 > 150, `race engine should produce strong power at 7000 RPM: got ${raceTorque7000}`);
});

test('raceCircuit: auto-equips GT3 race car when starting circuit race', () => {
  let equipped = null;
  const mockGarage = {
    fitted: 'k-van', // civilian van
    equipRaceCar(file) {
      equipped = file;
      this.fitted = file;
    }
  };

  const mockHud = { flash() {} };
  const circuit = new RaceCircuit(null, mockHud, null, null, mockGarage);
  const car = createCarState();

  circuit.startCircuitRace(car);

  assert.equal(equipped, 's-porsche-gt3r', 'must auto-equip Porsche 992 GT3 R');
  assert.equal(mockGarage.fitted, 's-porsche-gt3r');
});

test('vehicleDynamics: stepVehicle records prevX, prevZ, prevYaw for sub-step visual interpolation', () => {
  const car = createCarState();
  const dt = 1 / 120;
  car.vx = 25; // 90 km/h
  car.vz = 10;
  car.yawRate = 0.5;

  const startX = car.x;
  const startZ = car.z;
  const startYaw = car.yaw;

  stepVehicle(car, dt);

  assert.equal(car.prevX, startX, 'prevX must capture state before displacement');
  assert.equal(car.prevZ, startZ, 'prevZ must capture state before displacement');
  assert.equal(car.prevYaw, startYaw, 'prevYaw must capture state before rotation');
  assert.ok(car.x !== car.prevX, 'car.x must advance from prevX');
  assert.ok(car.z !== car.prevZ, 'car.z must advance from prevZ');
});

test('vehicleDynamics: a kerb under the RIGHT wheels lifts the right side (the body frame is not mirrored)', () => {
  /* roll > 0 lifts the car's left (main.js body.rotation.x, dynamics' lft
     axis). Before the 2026-09-23 frame fix the corner offsets were read along
     the right axis, so wheels on a kerb to the right lifted the LEFT side
     (+0.088) and grip was sampled at the mirrored corners. The car faces +x
     at yaw 0, so its right is +z. */
  const parkWith = (roadDepth) => {
    useDistrict({ roadDepth, elevationAt: () => 0, blockTypeAt: () => null });
    const car = createCarState(); car.x = 0; car.z = 0; car.yaw = 0;
    for (let i = 0; i < 360; i++) stepVehicle(car, 1 / 120);
    return car;
  };
  try {
    const right = parkWith((x, z) => z - 0.5);    // pavement from 0.5 m right of centre: the right wheels (0.79 m) are on it
    assert.ok(right.roll < -0.04, `right wheels on the kerb: roll ${right.roll.toFixed(3)}, want the right side up (< 0)`);
    assert.ok(right.wheelGround[1] > right.wheelGround[0] && right.wheelGround[3] > right.wheelGround[2], 'FR/RR stand on the kerb, FL/RL on the road');
    const left = parkWith((x, z) => -z - 0.5);
    assert.ok(left.roll > 0.04, `left wheels on the kerb: roll ${left.roll.toFixed(3)}, want the left side up (> 0)`);
  } finally { useDistrict(null); }
});
