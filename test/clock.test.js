import test from 'node:test';
import assert from 'node:assert/strict';
import { nightFactor, GameClock, DUSK_FROM, NIGHT_FROM, NIGHT_TO, DAWN_TO } from '../src/game/clock.js';

test('nightFactor: 0 by day, 1 through the night, monotonic through dusk and dawn, wraps at 24', () => {
  assert.equal(nightFactor(12), 0);
  assert.equal(nightFactor(17.9), 0);
  for (let h = NIGHT_FROM; h < 24; h += 0.25) assert.equal(nightFactor(h), 1, `night at ${h}`);
  for (let h = 0; h < NIGHT_TO; h += 0.25) assert.equal(nightFactor(h), 1, `night at ${h}`);
  let prev = -1;
  for (let h = DUSK_FROM; h <= NIGHT_FROM; h += 0.05) { const k = nightFactor(h); assert.ok(k >= prev - 1e-9, `dusk falls back at ${h}`); assert.ok(k >= 0 && k <= 1); prev = k; }
  prev = 2;
  for (let h = NIGHT_TO; h <= DAWN_TO; h += 0.05) { const k = nightFactor(h); assert.ok(k <= prev + 1e-9, `dawn climbs at ${h}`); prev = k; }
  assert.equal(nightFactor(DAWN_TO), 0);
  assert.equal(nightFactor(36), nightFactor(12));
  assert.equal(nightFactor(-2), nightFactor(22));
});

test('the clock drives every night knob from one factor: grade, exposure, light pool, traffic', () => {
  const clock = new GameClock({ startHour: 19.0 });
  const seen = {};
  const grade = { setNight: (k) => { seen.grade = k; } };
  const renderer = { toneMappingExposure: 1 };
  const lightPool = { night: 0 };
  const traffic = { setNight: (k) => { seen.traffic = k; } };
  const assets = { mat: { windowQuad: { emissiveIntensity: 0 } }, base: { materials: [{ emissiveIntensity: 0.05 }] } };
  clock.update(0, { grade, renderer, lightPool, traffic, assets });
  const k = clock.nightFactor;
  assert.ok(k > 0.4 && k < 0.7, `dusk factor ${k}`);
  assert.equal(seen.grade, k);
  assert.equal(seen.traffic, k);
  assert.equal(lightPool.night, k);
  assert.ok(Math.abs(renderer.toneMappingExposure - (1 + 0.15 * k)) < 1e-9);
  // deep night restores what daylightAssets() zeroed at boot
  clock.hour = 23; clock.update(0, { assets, renderer });
  assert.equal(assets.mat.windowQuad.emissiveIntensity, 0.9);
  assert.equal(assets.base.materials[0].emissiveIntensity, 0.9);
  assert.ok(Math.abs(renderer.toneMappingExposure - 1.15) < 1e-9);
  clock.hour = 12; clock.update(0, { assets, renderer });
  assert.equal(assets.mat.windowQuad.emissiveIntensity, 0);
  assert.equal(assets.base.materials[0].emissiveIntensity, 0.05);
  assert.equal(renderer.toneMappingExposure, 1);
});
