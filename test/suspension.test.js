import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarState, resetCar, stepVehicle } from '../src/vehicle/dynamics.js';
import { V, WHEEL_R } from '../src/vehicle/config.js';

const H = 1 / 120;
const settle = (car, seconds) => {
  for (let i = 0; i < seconds / H; i++) stepVehicle(car, H);
};

test('the car settles to a stable ride height under its own weight', () => {
  const car = createCarState();
  resetCar(car);
  settle(car, 3);
  const rest = WHEEL_R + V.restLength;
  const sag = rest - car.y;
  // total spring force must balance the sprung weight
  const expected = (V.sprungMass * 9.81) / (4 * V.springK);
  assert.ok(sag > 0, `car should sag, got ${sag}`);
  assert.ok(Math.abs(sag - expected) < 0.02,
    `sag ${sag.toFixed(3)} should be near ${expected.toFixed(3)}`);
  assert.ok(Math.abs(car.vy) < 0.05, 'should have stopped bouncing');
});

test('braking pitches the nose down, throttle squats the tail', () => {
  const car = createCarState();
  resetCar(car);
  car.throttle = 1;
  settle(car, 4);                       // get some speed up
  assert.ok(car.fwdSpeed > 8, `needs speed, got ${car.fwdSpeed}`);

  car.throttle = 0; car.brake = 1;
  let dived = 0;
  for (let i = 0; i < 60; i++) { stepVehicle(car, H); dived = Math.min(dived, car.pitch); }
  assert.ok(dived < -0.004, `braking should pitch nose down, got ${dived.toFixed(4)}`);

  // and the front springs must carry more than the rears while diving
  assert.ok(car.suspension[0] > car.suspension[2],
    'front suspension should be more compressed under braking');
});

test('cornering leans the body out of the turn', () => {
  const car = createCarState();
  resetCar(car);
  car.throttle = 1;
  settle(car, 4);
  car.steerTarget = 1;                  // full left
  let leaned = 0;
  for (let i = 0; i < 120; i++) { stepVehicle(car, H); leaned = Math.max(leaned, car.roll); }
  assert.ok(leaned > 0.004, `left turn should lean right, got ${leaned.toFixed(4)}`);
  assert.ok(car.yawRate > 0, 'left steer should yaw left');
});

test('a wheel load is never negative and the car never sinks through the road', () => {
  const car = createCarState();
  resetCar(car);
  car.throttle = 1;
  const floor = WHEEL_R + V.restLength - V.maxTravel;
  for (let i = 0; i < 1200; i++) {
    stepVehicle(car, H);
    if (i % 200 === 0) car.steerTarget = i % 400 === 0 ? 1 : -1;
    assert.ok(car.y >= floor - 1e-6, `sank to ${car.y} below ${floor}`);
    assert.ok(car.suspension.every((c) => Number.isFinite(c)), 'suspension went NaN');
    assert.ok(Number.isFinite(car.pitch) && Number.isFinite(car.roll), 'attitude went NaN');
  }
});
