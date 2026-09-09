/** Kinematic sanity probe: a body rotating with no steering must NOT drag its
    world velocity round with it (only tyre forces may). Compare how far the
    velocity vector turns against how far the heading turns in a few steps. */
import { settled, H } from './handling.mjs';
import { stepVehicle } from '../../src/vehicle/dynamics.js';
const c = settled(); c.wantsForward = true; c.throttle = 1;
while (c.fwdSpeed * 3.6 < 80) stepVehicle(c, H);
c.throttle = 0; c.steerTarget = 0; c.steer = 0;
const head0 = c.yaw, vel0 = Math.atan2(-c.vz, c.vx);
c.yawRate = 0.5;
for (let i = 0; i < 3; i++) {
  stepVehicle(c, H);
  const head = c.yaw - head0, vel = Math.atan2(-c.vz, c.vx) - vel0;
  console.log('step', i, 'heading turned', (head * 1000).toFixed(2), 'mrad   velocity turned', (vel * 1000).toFixed(2), 'mrad   ratio', (vel / head).toFixed(2), ' ay', (c.lastAy / 9.81).toFixed(2), 'r', c.yawRate.toFixed(3));
}
console.log('physical expectation: |ratio| < 1 (tyres pull the velocity toward the heading, never past it)');
