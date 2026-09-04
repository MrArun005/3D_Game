import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, CarVehicle } from '../src/game/vehicle.js';
import { createCarState } from '../src/vehicle/dynamics.js';

test('Vehicle base class has standard vehicle interface', () => {
  const v = new Vehicle('test');
  assert.equal(v.type, 'test');
  assert.equal(v.isAirborne, false);
  assert.equal(typeof v.update, 'function');
  assert.equal(typeof v.camera, 'function');
  assert.equal(typeof v.enter, 'function');
  assert.equal(typeof v.exit, 'function');
  assert.equal(typeof v.solid, 'function');
  assert.equal(typeof v.onMap, 'function');

  v.enter({ id: 'player' });
  assert.deepEqual(v.driver, { id: 'player' });
  v.exit();
  assert.equal(v.driver, null);
});

test('CarVehicle proxies state and updates controls correctly', () => {
  const state = createCarState();
  state.x = 100;
  state.z = 200;
  state.yaw = 1.57;

  let stepped = false;
  const stepFn = (s, dt) => {
    stepped = true;
    s.vx = 10;
  };

  const carVehicle = new CarVehicle(state, stepFn);
  assert.equal(carVehicle.type, 'car');
  assert.equal(carVehicle.x, 100);
  assert.equal(carVehicle.z, 200);
  assert.equal(carVehicle.yaw, 1.57);

  // Update input
  carVehicle.update({ throttle: 0.8, brake: 0, steer: 0.5, handbrake: 0 }, 0.016);
  assert.equal(stepped, true);
  assert.equal(state.throttle, 0.8);
  assert.equal(state.steerTarget, 0.5);
  assert.equal(carVehicle.vx, 10);

  const solid = carVehicle.solid();
  assert.equal(solid.tag, 'hero_car');
  assert.equal(solid.x, 100);

  const mapInfo = carVehicle.onMap();
  assert.equal(mapInfo.type, 'car');
  assert.equal(mapInfo.x, 100);
});
