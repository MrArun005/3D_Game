import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HelicopterVehicle } from '../src/game/flight.js';
import { DispatchService } from '../src/game/dispatch.js';

test('End-to-end Helicopter Dispatch, Ground Rest, Car Decoupling, and Multi-Key Flight', () => {
  const scene = new THREE.Group();
  const world = {
    district: {
      elevationAt: () => 0,
      tarmacDepth: () => 3.0,
    },
    nearbyBuildings: () => [],
  };

  const mockGarage = { cash: 50000 };
  const dispatch = new DispatchService(scene, world, mockGarage, null, null, null, null, null);

  // 1. Dispatch helicopter from player position on street
  const playerPos = { x: 100, y: 0, z: 100, yaw: 0 };
  const heli = dispatch.dispatchHelicopter(playerPos);

  assert.ok(heli, 'Helicopter must be dispatched');
  assert.equal(heli.landed, true, 'Helicopter must be marked landed on delivery');
  assert.equal(heli.y, 1.25, 'Helicopter must sit on ground clearance (1.25m, resting on skids)');

  // 2. Simulate 60 frames of idle time waiting for player: MUST NOT PHANTOM HOVER!
  for (let i = 0; i < 60; i++) {
    dispatch.update(0.05, null, null); // heli is not activeVehicle
  }
  assert.equal(heli.y, 1.25, 'Helicopter must remain grounded on pavement (not floating 6ft)');
  assert.equal(heli.vy, 0, 'Vertical velocity must remain zero while unpiloted');

  // 3. Board helicopter: simulate car state and decoupling
  const car = { x: 100, y: 0.62, z: 100, vx: 0, vz: 0, throttle: 0, brake: 1, hand: 1 };
  const heroMesh = new THREE.Group();
  heroMesh.visible = true;

  // Boarding
  heli.enter(heroMesh);
  heroMesh.visible = false; // Decoupled!

  assert.equal(heli.driver, heroMesh);
  assert.equal(heroMesh.visible, false, 'Car mesh must be hidden when boarding helicopter');

  // 4. Test takeoff with W (throttle)
  heli.rotorRpm = 1.0;
  for (let i = 0; i < 20; i++) {
    heli.update({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, 0.05);
  }
  assert.equal(heli.landed, false, 'Helicopter must take off from ground when W is held');
  assert.ok(heli.y > 1.35, `Helicopter altitude must increase above ground, got y=${heli.y}`);
  assert.ok(heli.fwdSpeed > 0, `Forward speed must increase, got fwdSpeed=${heli.fwdSpeed}`);

  // 5. Test rapid vertical climb with Space
  const altitudeBeforeClimb = heli.y;
  for (let i = 0; i < 30; i++) {
    heli.update({ throttle: 0, brake: 0, steer: 0, handbrake: 1 }, 0.05);
  }
  assert.ok(heli.y > altitudeBeforeClimb + 8, `Space must produce rapid climb, climbed from ${altitudeBeforeClimb} to ${heli.y}`);

  // 6. Verify car position was NEVER touched by helicopter
  assert.equal(car.x, 100, 'Parked car X must not be overwritten by helicopter movement');
  assert.equal(car.z, 100, 'Parked car Z must not be overwritten by helicopter movement');

  // 7. Test controlled descent with Shift (hold)
  const altitudeAloft = heli.y;
  for (let i = 0; i < 60; i++) {
    heli.update({ throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: 1 }, 0.05);
  }
  assert.ok(heli.y < altitudeAloft, 'Shift must descend helicopter');

  // Continue descent until touchdown
  for (let i = 0; i < 60; i++) {
    heli.update({ throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: 1 }, 0.05);
  }
  assert.equal(heli.y, 1.25, 'Helicopter must touch down and rest on ground clearance');
  assert.equal(heli.landed, true, 'Helicopter must be marked landed upon touchdown');

  // 8. Exit helicopter
  heli.exit();
  heroMesh.visible = true; // Restored upon exit
  assert.equal(heli.driver, null);
  assert.equal(heroMesh.visible, true);
});
