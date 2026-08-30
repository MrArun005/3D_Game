import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_BANDS, engineLayerGains, renderEngineLoop,
} from '../src/game/engine-samples.js';

test('layer gains peak on the nearest RPM band and sum to about 1', () => {
  const idle = engineLayerGains(900, 0);
  assert.equal(idle.bands.length, ENGINE_BANDS.length);
  assert.ok(idle.bands[0].off > 0.95);
  assert.ok(idle.bands[0].on < 0.01);

  const mid = engineLayerGains(3000, 1);
  const peak = mid.bands.reduce((a, b) => (b.on + b.off > a.on + a.off ? b : a));
  assert.equal(peak.rpm, 3000);
  assert.ok(peak.on > 0.95);
  const sum = mid.bands.reduce((s, b) => s + b.on + b.off, 0);
  assert.ok(sum > 0.95 && sum < 1.05);

  const between = engineLayerGains(2400, 0.5);
  const live = between.bands.filter((b) => b.on + b.off > 0.05);
  assert.equal(live.length, 2);
  assert.ok(Math.abs(between.bands.find((b) => b.rpm === 1800).rate - 2400 / 1800) < 0.001);
});

test('limiter only comes in near redline', () => {
  assert.equal(engineLayerGains(5000, 1).limiter, 0);
  assert.ok(engineLayerGains(6700, 1).limiter > 0.4);
  assert.ok(engineLayerGains(6800, 1).limiter > 0.9);
});

test('baked loop is seamless and louder on load', () => {
  const sr = 22050;
  const off = renderEngineLoop(sr, 3000, 0);
  const on = renderEngineLoop(sr, 3000, 1);
  assert.ok(off.length > sr * 0.2);
  const seam = Math.abs(off[0] - off[off.length - 1]);
  assert.ok(seam < 0.08, `loop seam ${seam}`);
  const energy = (buf) => {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return s / buf.length;
  };
  assert.ok(energy(on) > energy(off) * 1.2);
});
