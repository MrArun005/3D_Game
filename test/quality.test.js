import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PRESETS, FIELDS, resolveQuality, describeQuality, nextLower, limitTraffic, limitFarTraffic, DENSITY_STEPS } from '../src/core/quality.js';
import { renderScale, autoResolution, createLights } from '../src/core/renderer.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('every preset carries every field, and the ladder is ordered', () => {
  for (const name of ['low', 'balanced', 'medium', 'high']) {
    for (const f of FIELDS) assert.ok(f in PRESETS[name], `${name}.${f} missing`);
    assert.ok(['off', 'near', 'full'].includes(PRESETS[name].shadows), `${name}.shadows`);
  }
  assert.ok(PRESETS.low.pixelBudget < PRESETS.medium.pixelBudget && PRESETS.medium.pixelBudget < PRESETS.high.pixelBudget);
  assert.ok(PRESETS.low.traffic < PRESETS.medium.traffic && PRESETS.medium.traffic < PRESETS.high.traffic);
  assert.equal(nextLower('high'), 'medium'); assert.equal(nextLower('medium'), 'balanced'); assert.equal(nextLower('balanced'), 'low'); assert.equal(nextLower('low'), null);
  assert.equal(DENSITY_STEPS[0], 1);
  for (let i = 1; i < DENSITY_STEPS.length; i++) assert.ok(DENSITY_STEPS[i] < DENSITY_STEPS[i - 1]);
});

test('resolution order: ?quality > localStorage hb.quality > auto (balanced on LITE, high otherwise)', () => {
  assert.equal(resolveQuality({ isLite: true, search: '?quality=high', storage: mem({ 'hb.quality': 'low' }) }).name, 'high');
  assert.equal(resolveQuality({ isLite: false, search: '', storage: mem({ 'hb.quality': 'low' }) }).name, 'low');
  const auto = resolveQuality({ isLite: true, search: '', storage: mem() });
  assert.equal(auto.name, 'balanced'); assert.match(auto.source, /auto, integrated/);
  assert.equal(resolveQuality({ isLite: false, search: '', storage: mem() }).name, 'high');
  assert.equal(resolveQuality({ isLite: true, search: '?quality=auto', storage: mem({ 'hb.quality': 'high' }) }).name, 'balanced');   // ?quality=auto beats a saved preset
  // gpu.js's 'lite' | 'full' live in the same key: not preset names, so they fall through to auto
  assert.equal(resolveQuality({ isLite: true, search: '', storage: mem({ 'hb.quality': 'lite' }) }).name, 'balanced');
  assert.equal(resolveQuality({ isLite: false, search: '?quality=bogus', storage: mem() }).name, 'high');
  assert.equal(resolveQuality({ isLite: true, search: '', storage: { getItem() { throw new Error('private'); } } }).name, 'balanced');
});

test('the boot line reads as specified', () => {
  const line = describeQuality('medium', 'auto, integrated GPU', PRESETS.medium, { crowd: 0 });
  assert.equal(line, 'quality: MEDIUM (auto, integrated GPU) shadows near, bloom on, aa off, 0.78 MP, radius 1, traffic 26, crowd 0');
});

test('renderScale honours the preset pixel budget and keeps the old LITE/FULL default', () => {
  const w = 2560, h = 1664;   // the M2 Air panel
  const px = (s) => w * s * h * s;
  assert.ok(Math.abs(px(renderScale(w, h, true)) - 1152 * 680) < 1);
  assert.ok(Math.abs(px(renderScale(w, h, false, PRESETS.low.pixelBudget)) - PRESETS.low.pixelBudget) < 1);
  assert.ok(Math.abs(px(renderScale(w, h, true, PRESETS.high.pixelBudget)) - PRESETS.high.pixelBudget) < 1);
});

test('limitTraffic hides and restores civilians without traffic.js; limitFarTraffic never exceeds the boot count', () => {
  const car = () => ({ live: true, mesh: { visible: true } });
  const traffic = { cars: Array.from({ length: 26 }, car) };
  assert.equal(limitTraffic(traffic, 16), 16);
  assert.equal(traffic._spare.length, 10);
  assert.ok(traffic._spare.every((c) => !c.live && !c.mesh.visible));
  assert.equal(limitTraffic(traffic, 9), 9);
  assert.equal(limitTraffic(traffic, 40), 26);   // only what was built comes back
  assert.equal(traffic._spare.length, 0);
  const far = { n: 120 };
  assert.equal(limitFarTraffic(far, 42), 42);
  assert.equal(limitFarTraffic(far, 500), 120);
});

test('autoResolution steps density before pixels, restores after 20 s stable, fires sustained once', () => {
  let ratio = 1, densityCalls = [], sustained = 0;
  const renderer = { setPixelRatio: (r) => { ratio = r; }, setSize() {} };
  // innerWidth/Height are CSS pixels: the 2560x1664 M2 Air panel is 1280x832 to the page (DPR 2), so base = sqrt(0.78/1.06) = 0.86
  global.window = { innerWidth: 1280, innerHeight: 832 };
  let now = 0; const realNow = performance.now.bind(performance); performance.now = () => now;
  try {
    const update = autoResolution(renderer, { resize() {} }, true, {
      pixelBudget: PRESETS.medium.pixelBudget, densitySteps: 2,
      onDensity: (s) => densityCalls.push(s), onSustained: () => sustained++,
    });
    const base = renderScale(1280, 832, true, PRESETS.medium.pixelBudget);
    assert.ok(base > 0.5 && base < 1, `base ${base}`);
    const windows = (n, ms) => { for (let k = 0; k < n; k++) { now += 3000; for (let i = 0; i < 60; i++) update(ms); } };
    windows(2, 0.030);
    assert.deepEqual(densityCalls, [1]); assert.equal(ratio, 1, 'pixels moved before density');
    windows(2, 0.030);
    assert.deepEqual(densityCalls, [1, 2]); assert.equal(ratio, 1);
    windows(2, 0.030);
    assert.ok(ratio < base, 'resolution steps only once density is spent');
    // grind to MIN_SCALE and hold >22 ms: the sustained hook fires exactly once (after 12 s since 2026-09-22)
    windows(60, 0.030);
    assert.ok(Math.abs(ratio - 0.5) < 1e-6);
    windows(40, 0.030);
    assert.equal(sustained, 1);
    // recovery: pixels first, then one density step per 20 s of stable frames
    windows(40, 0.008);
    assert.ok(ratio >= base - 1e-9, `ratio ${ratio} not back at base ${base}`);
    windows(8, 0.008);
    assert.ok(densityCalls.at(-1) < 2, `density never recovered: ${densityCalls}`);
  } finally { performance.now = realNow; }
});

test('createLights shadow tier: off has no caster, near is one cascade, the old lite boolean still works', () => {
  const scene = { add() {} };
  const off = createLights(scene, true, { lite: true, shadows: 'off' });
  assert.equal(off.sun.castShadow, false); assert.equal(off.csm, null);
  const near = createLights(scene, true, { lite: true, shadows: 'near' });
  assert.equal(near.sun.castShadow, true); assert.equal(near.csm.cascades, 1); assert.equal(near.csm.maxFar, 160);
  assert.equal(near.sun.shadow.mapSize.x, 1024);
  const full = createLights(scene, true, false);
  assert.equal(full.csm.cascades, 3); assert.equal(full.sun.shadow.mapSize.x, 2048);
  const nightOff = createLights(scene, false, { shadows: 'off' });
  assert.equal(nightOff.sun.castShadow, false);
});

test('every preset knob reaches its consumer in main.js', () => {
  const main = fs.readFileSync('src/main.js', 'utf8');
  for (const s of ['Q.shadows', 'Q.bloom', 'Q.aa', 'Q.blur', 'Q.pixelBudget', 'Q.streamRadius', 'Q.traffic', 'Q.crowd', 'Q.farTraffic']) {
    assert.ok(main.includes(s), `${s} is not consumed in main.js`);
  }
  assert.ok(fs.readFileSync('index.html', 'utf8').includes('class="quality"'));
});
