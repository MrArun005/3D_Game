import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TankVehicle } from '../src/game/tank.js';

test('TankVehicle initializes with skid steering and heavy armor specs', () => {
  const scene = new THREE.Group();
  const tank = new TankVehicle(scene, null, null, null, { x: 20, z: 40, yaw: 0 });

  assert.equal(tank.type, 'tank');
  assert.equal(tank.x, 20);
  assert.equal(tank.z, 40);
  assert.equal(tank.mass, 55000);
  assert.equal(tank.health, 500);

  // Enter tank
  tank.enter({ id: 'player' });
  assert.equal(tank.driver.id, 'player');
});

test('TankVehicle skid steering pivots in place when throttle is zero', () => {
  const scene = new THREE.Group();
  const tank = new TankVehicle(scene, null, null, null, { x: 0, z: 0, yaw: 0 });
  tank.enter({ id: 'player' });

  // Steer right with zero throttle
  tank.update({ throttle: 0, brake: 0, steer: -1, handbrake: 0 }, 0.1);
  assert.ok(tank.yawRate > 0, 'Tank should pivot yaw when steering with zero throttle');

  for (let i = 0; i < 10; i++) {
    tank.update({ throttle: 0, brake: 0, steer: -1, handbrake: 0 }, 0.05);
  }
  assert.ok(tank.yaw > 0.2, 'Yaw angle should change during pivot turn');
});

test('TankVehicle cannon fires shell, starts 3-second reload cooldown, and applies recoil', () => {
  const scene = new THREE.Group();
  let brokeNearCalled = false;
  const mockDebris = {
    breakNear: () => { brokeNearCalled = true; },
  };
  const tank = new TankVehicle(scene, null, null, mockDebris, { x: 0, z: 0, yaw: 0 });
  tank.enter({ id: 'player' });

  assert.equal(tank.reloadTime, 0);
  tank.fire();

  assert.ok(tank.reloadTime > 2.8, 'Reload cooldown should be ~3.0s');
  assert.ok(tank.recoil > 0.5, 'Recoil impulse should trigger on cannon fire');
  assert.equal(tank.projectiles.length, 1);

  // Update projectile until it detonates
  for (let i = 0; i < 30; i++) {
    tank.update(null, 0.1);
  }

  assert.ok(brokeNearCalled, 'Detonating shell should trigger debris breakNear blast');
});
