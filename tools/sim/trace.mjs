/** Time series for one scenario: `node tools/sim/trace.mjs [kmh] [throttle] [hand]`.
    Coast + full lock by default; prints body slip, yaw rate, per-axle slip angles. */
import { settled, H, beta } from './handling.mjs';
import { stepVehicle } from '../../src/vehicle/dynamics.js';
import { V, WHEEL_R } from '../../src/vehicle/config.js';

const kmh = +(process.argv[2] ?? 80), thr = +(process.argv[3] ?? 0), hand = +(process.argv[4] ?? 0);
const c = settled(); c.wantsForward = true; c.throttle = 1;
while (c.fwdSpeed * 3.6 < kmh) stepVehicle(c, H);
c.throttle = thr; c.steerTarget = 1; c.hand = hand;
for (let i = 0; i < 240; i++) {
  stepVehicle(c, H);
  if (i % 12 !== 0) continue;
  const u = c.fwdSpeed, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const v = c.vx * sy + c.vz * cy, r = c.yawRate;
  const saF = Math.atan2(-(v + r * V.a), Math.max(1.2, Math.abs(u))) - c.steer;
  const saR = Math.atan2(-(v - r * V.b), Math.max(1.2, Math.abs(u)));
  console.log((i / 120).toFixed(2), 'u', (u * 3.6).toFixed(0), 'beta', (beta(c) * 57.3).toFixed(0),
    'r', r.toFixed(2), 'steer', (c.steer * 57.3).toFixed(1), 'slipF', (saF * 57.3).toFixed(1), 'slipR', (saR * 57.3).toFixed(1),
    'ay', (c.lastAy / 9.81).toFixed(2), 'roll', c.roll.toFixed(3), 'wRear', c.wheelW[2].toFixed(1), 'wRoad', (u / WHEEL_R).toFixed(1),
    'gear', c.gear, 'susp', c.suspension.map((x) => x.toFixed(2)).join('/'));
}
