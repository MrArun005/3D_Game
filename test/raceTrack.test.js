import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK_CONTROL_POINTS,
  TRACK_CHECKPOINTS,
  GRID_SLOTS,
  START_FINISH,
  getSampledTrack,
  isRacewayArea,
  racewayElevationAt,
  registerRaceTrackPhysics,
  RACEWAY_ELEVATION,
} from '../src/world/raceTrack.js';
import { RaceCircuit, PURSE } from '../src/game/raceCircuit.js';
import { District } from '../src/world/district.js';
import fs from 'node:fs';

test('raceTrack: control points and spline generate a valid continuous closed circuit', () => {
  assert.ok(TRACK_CONTROL_POINTS.length >= 10, 'circuit should have ample control points');
  const samples = getSampledTrack(10);
  assert.ok(samples.length > 100, 'sampled track should have high resolution');

  let totalLen = 0;
  for (let i = 0; i < samples.length; i++) {
    const curr = samples[i];
    const next = samples[(i + 1) % samples.length];
    const d = Math.hypot(next.x - curr.x, next.z - curr.z);
    totalLen += d;
    assert.ok(Number.isFinite(curr.x) && Number.isFinite(curr.z), 'points must be finite');
    assert.ok(Number.isFinite(curr.tx) && Number.isFinite(curr.tz), 'tangents must be finite');
    assert.ok(Number.isFinite(curr.nx) && Number.isFinite(curr.nz), 'normals must be finite');
  }

  // Circuit should be ~2.0 - 2.5 km long
  assert.ok(totalLen > 1800 && totalLen < 2600, `track length ${totalLen}m should be Grand Prix length`);
});

test('raceTrack: grid slots are staggered 2x2 behind the start/finish line', () => {
  assert.equal(GRID_SLOTS.length, 6, 'grid should accommodate 6 cars (1 player + 5 rivals)');
  assert.equal(GRID_SLOTS[0].x, START_FINISH.x);
  assert.equal(GRID_SLOTS[0].z, START_FINISH.z);

  // Each subsequent slot should be further back along the straight
  for (let i = 1; i < GRID_SLOTS.length; i++) {
    assert.ok(GRID_SLOTS[i].x < GRID_SLOTS[i - 1].x, `slot ${i} should be behind slot ${i - 1}`);
  }
});

test('raceTrack: raceway bounds and elevation checks', () => {
  // Start line
  assert.equal(isRacewayArea(START_FINISH.x, START_FINISH.z), true);
  assert.equal(racewayElevationAt(START_FINISH.x, START_FINISH.z), RACEWAY_ELEVATION);

  // Deep in downtown
  assert.equal(isRacewayArea(2350, 1350), false);
  assert.equal(racewayElevationAt(2350, 1350), null);

  // Access causeway
  assert.equal(isRacewayArea(3460, 2440), true);
  const bridgeElev = racewayElevationAt(3460, 2440);
  assert.ok(bridgeElev > 0 && bridgeElev <= RACEWAY_ELEVATION);
});

test('raceTrack: physics registration injects circuit into District and avoids water drowning', () => {
  const districtData = JSON.parse(fs.readFileSync('halstead-bay.district.json', 'utf8'));
  const dist = new District(districtData);

  const initialSegCount = dist.segments.length;
  registerRaceTrackPhysics(dist);

  assert.ok(dist.segments.length > initialSegCount + 100, 'circuit segments must be injected');
  assert.equal(dist.isRacewayLand(START_FINISH.x, START_FINISH.z), true);
  assert.equal(dist.inWater(START_FINISH.x, START_FINISH.z), false, 'car on raceway must not be classified as drowning');
  assert.equal(dist.districtAt(START_FINISH.x, START_FINISH.z), 'HALSTEAD RACEWAY');
});

test('raceCircuit: time formatting', () => {
  assert.equal(RaceCircuit.formatTime(0), '--:--.--');
  assert.equal(RaceCircuit.formatTime(72.45), '01:12.45');
  assert.equal(RaceCircuit.formatTime(65.03), '01:05.03');
  assert.equal(RaceCircuit.formatTime(128.90), '02:08.90');
});

test('raceCircuit: stages race, spawns rivals, runs countdown, and settles finish', () => {
  const mockScene = { add() {}, remove() {} };
  const mockHud = { flash() {} };
  const createdCars = [];
  const mockTraffic = {
    makeCar() {
      const car = {
        mesh: { visible: false, position: { set() {} } },
        x: 0, z: 0, yaw: 0, speed: 0,
      };
      createdCars.push(car);
      return car;
    },
  };
  let cashEarned = 0;
  const mockGarage = {
    addCash(amount) {
      cashEarned += amount;
    },
  };

  const circuit = new RaceCircuit(mockScene, mockHud, mockTraffic, null, mockGarage);
  const playerCar = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, fwdSpeed: 0, steer: 0, brake: 0 };

  // Stage race
  circuit.startCircuitRace(playerCar);
  assert.equal(circuit.state, 'countdown');
  assert.equal(circuit.rivals.length, 5, 'should spawn 5 rival cars');
  assert.equal(playerCar.x, START_FINISH.x);
  assert.equal(playerCar.z, START_FINISH.z);

  // Update countdown to completion (4 seconds)
  circuit.update(1.0, playerCar);
  assert.equal(circuit.state, 'countdown');
  circuit.update(3.1, playerCar);
  assert.equal(circuit.state, 'racing');
  assert.equal(circuit.lap, 1);

  // Simulate player clearing all checkpoints in lap 1
  for (let i = 0; i < TRACK_CHECKPOINTS.length; i++) {
    const cp = TRACK_CHECKPOINTS[i];
    playerCar.x = cp.x;
    playerCar.z = cp.z;
    circuit.update(0.1, playerCar);
  }
  assert.equal(circuit.lap, 2, 'should advance to lap 2 after loop');

  // Lap 2
  for (let i = 0; i < TRACK_CHECKPOINTS.length; i++) {
    const cp = TRACK_CHECKPOINTS[i];
    playerCar.x = cp.x;
    playerCar.z = cp.z;
    circuit.update(0.1, playerCar);
  }
  assert.equal(circuit.lap, 3, 'should advance to lap 3');

  // Lap 3 (Final Lap)
  for (let i = 0; i < TRACK_CHECKPOINTS.length; i++) {
    const cp = TRACK_CHECKPOINTS[i];
    playerCar.x = cp.x;
    playerCar.z = cp.z;
    circuit.update(0.1, playerCar);
  }
  assert.equal(circuit.state, 'finished', 'race should be finished after 3 laps');
  assert.ok(cashEarned >= PURSE[1], 'winner should receive 1st place purse');
});
