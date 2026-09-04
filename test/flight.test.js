import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HelicopterVehicle } from '../src/game/flight.js';

test('HelicopterVehicle initializes with correct flight properties and spooling', () => {
  const scene = new THREE.Group();
  const heli = new HelicopterVehicle(scene, null, { x: 50, y: 10, z: 50, yaw: 0 });

  assert.equal(heli.type, 'helicopter');
  assert.equal(heli.isAirborne, true);
  assert.equal(heli.x, 50);
  assert.equal(heli.y, 10);
  assert.equal(heli.z, 50);
  assert.equal(heli.rotorRpm, 0);

  // Enter vehicle
  heli.enter({ id: 'player' });
  assert.equal(heli.rotorTargetRpm, 1.0);

  // Spool up over 1 second
  heli.update(null, 1.0);
  assert.ok(heli.rotorRpm > 0.4);
});

test('HelicopterVehicle collective and pitch response produces forward flight', () => {
  const scene = new THREE.Group();
  const heli = new HelicopterVehicle(scene, null, { x: 0, y: 20, z: 0, yaw: 0, running: true });
  heli.enter({ id: 'pilot' });
  heli.rotorRpm = 1.0;

  // Press W (throttle forward)
  heli.update({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, 0.1);
  assert.ok(heli.pitch < 0, 'W should pitch nose down (negative pitch)');

  // Multiple steps to build forward speed
  for (let i = 0; i < 10; i++) {
    heli.update({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, 0.05);
  }
  assert.ok(heli.fwdSpeed > 0.5, 'Forward speed should increase when nose is tilted down');

  // Auto-level when input released
  for (let i = 0; i < 20; i++) {
    heli.update({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 0.05);
  }
  assert.ok(Math.abs(heli.pitch) < 0.08, 'Pitch should auto-level towards 0 when keys released');
});

test('HelicopterVehicle ground cushion prevents sinking through ground', () => {
  const scene = new THREE.Group();
  const heli = new HelicopterVehicle(scene, null, { x: 0, y: 2.0, z: 0, yaw: 0, running: true });
  heli.enter({ id: 'pilot' });
  heli.rotorRpm = 1.0;

  // Let it descend toward ground
  for (let i = 0; i < 30; i++) {
    heli.update({ throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: 1 }, 0.05);
  }

  // Minimum ground clearance is 1.25
  assert.ok(heli.y >= 1.25, `Helicopter should rest on skids above ground, got y=${heli.y}`);
  assert.equal(heli.landed, true);
});

test('HelicopterVehicle stays grounded when unpiloted and does not phantom hover', () => {
  const scene = new THREE.Group();
  const heli = new HelicopterVehicle(scene, null, { x: 10, y: 1.25, z: 10, running: true });

  // Update while unpiloted over multiple seconds
  for (let i = 0; i < 40; i++) {
    heli.update(null, 0.05);
  }

  assert.equal(heli.landed, true);
  assert.equal(heli.y, 1.25, 'Unpiloted helicopter must remain landed on ground skids');
  assert.equal(heli.vy, 0, 'Vertical velocity must be zero when unpiloted');
});

test('HelicopterVehicle takes off and climbs with W and Space keys', () => {
  const scene = new THREE.Group();
  const heli = new HelicopterVehicle(scene, null, { x: 0, y: 1.25, z: 0, running: true });
  heli.enter({ id: 'pilot' });
  heli.rotorRpm = 1.0;

  // Press W from ground: must initiate takeoff and lift off
  for (let i = 0; i < 20; i++) {
    heli.update({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, 0.05);
  }
  assert.ok(heli.y > 1.35, `Helicopter should lift off from ground when W is held, got y=${heli.y}`);
  assert.equal(heli.landed, false);

  // Press Space: dedicated full climb
  const prevY = heli.y;
  for (let i = 0; i < 20; i++) {
    heli.update({ throttle: 0, brake: 0, steer: 0, handbrake: 1 }, 0.05);
  }
  assert.ok(heli.y > prevY + 5.0, `Helicopter should climb rapidly with Space, gained ${heli.y - prevY}m`);
});

