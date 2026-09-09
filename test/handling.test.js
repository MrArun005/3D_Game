import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, brake100, coastLock, handbrake, heldLock, scrape, headOn } from '../tools/sim/handling.mjs';

/*
 * Handling balance, pinned. Every number here comes from tools/sim/handling.mjs
 * driving the shipped stepVehicle at 1/120 s. Bands, not exact values, so a
 * tuning pass has room -- but a regression to the 2026-09-09 review's state
 * (front wheels chattering at the Nyquist rate, the velocity vector welded to
 * the heading, a coast at 80 km/h spinning 179 deg, the handbrake gripping
 * harder than no handbrake) fails loudly.
 *
 * Measured 2026-09-09 after the fix: 0-100 7.24 s, 100-0 42.1 m with the
 * fronts locked 1% of the stop, coast + full lock at 80 km/h 55 deg of heading
 * in 2 s at 21 deg body slip, handbrake 25 deg vs 22 deg without, peak
 * lateral 0.91-1.00 g.
 */

test('0-100 km/h lands in the sports-sedan band', () => {
  const { t100, vmax } = launch();
  assert.ok(t100 !== null && t100 > 6.0 && t100 < 8.0, `0-100 should take 6-8 s, got ${t100?.toFixed(2)}`);
  assert.ok(vmax > 170 && vmax < 210, `top speed should be 170-210 km/h, got ${vmax.toFixed(1)}`);
});

test('100-0 stops in 36-46 m without locking the fronts', () => {
  const { dist, frontLockedFrac } = brake100();
  assert.ok(dist > 36 && dist < 46, `100-0 should take 36-46 m, got ${dist.toFixed(1)}`);
  // the brake torque cap is the ABS: a locked front cannot steer and stops longer
  assert.ok(frontLockedFrac < 0.15, `fronts locked for ${(frontLockedFrac * 100).toFixed(0)}% of the stop; want under 15%`);
});

test('lifting off and winding on full lock at 80 km/h is a drift, not a spin', () => {
  const { headingDeg, maxBetaDeg, speed } = coastLock(80);
  assert.ok(headingDeg < 60, `heading changed ${headingDeg.toFixed(0)} deg in 2 s; over 60 means the rear let go`);
  assert.ok(maxBetaDeg < 45, `body slip reached ${maxBetaDeg.toFixed(0)} deg; over 45 is a spin`);
  assert.ok(speed > 40, `still carrying ${speed.toFixed(0)} km/h after 2 s; a spun car scrubs to nothing`);
});

test('the car can pull at least 0.85 g before the rear breaks away', () => {
  const { peakLatG } = heldLock(80);
  assert.ok(peakLatG >= 0.85, `peak lateral ${peakLatG.toFixed(2)} g, want >= 0.85`);
});

test('the handbrake makes the tail step out further than no handbrake', () => {
  const off = handbrake(0), on = handbrake(1);
  assert.ok(on.maxBetaDeg > off.maxBetaDeg,
    `handbrake body slip ${on.maxBetaDeg.toFixed(0)} deg should exceed ${off.maxBetaDeg.toFixed(0)} deg without`);
  assert.ok(Math.abs(on.rearW) < 3, `the handbrake should lock the rears, rear wheel at ${on.rearW.toFixed(1)} rad/s`);
});

test('a glancing wall scrape keeps most of its speed and a head-on still stops', () => {
  const s = scrape(60, 6);
  assert.ok(s.after > 25, `6 deg scrape at 60 km/h left ${s.after.toFixed(0)} km/h after 3 s; the wall is sticky`);
  assert.ok(s.after < 58, `6 deg scrape at 60 km/h left ${s.after.toFixed(0)} km/h; a wall must cost something`);
  const h = headOn(60);
  assert.ok(h.after < 5, `head-on at 60 km/h left ${h.after.toFixed(0)} km/h 0.5 s after contact`);
});
