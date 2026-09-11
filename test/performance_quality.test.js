import test from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATED_GPU_REGEX, resolveQualityMode } from '../src/core/gpu.js';
import { renderScale, RENDER_BUDGET_PX, RENDER_BUDGET_PX_LITE, autoResolution } from '../src/core/renderer.js';
import { CommandEngine } from '../src/game/commands.js';

test('INTEGRATED_GPU_REGEX accurately identifies integrated vs discrete graphics', () => {
  // Integrated architectures that must trigger LITE mode
  const integratedSamples = [
    'Intel(R) Graphics',
    'Intel(R) Iris(R) Xe Graphics',
    'ANGLE (Intel, Intel(R) Graphics (0x00007D45) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Intel UHD Graphics 620',
    'Intel(R) Arc(TM) Graphics', // Xe architecture
    'Apple M1',
    'Apple M2 Pro',
    'Apple M3 Max',
    'Mali-G78 MP14',
    'Adreno (TM) 730',
    'Qualcomm Adreno 685',
    'AMD Radeon(TM) 780M Graphics',
    'AMD Radeon Vega 8 Graphics',
    'AMD Radeon 680M',
    'AMD Radeon Graphics',
  ];

  for (const sample of integratedSamples) {
    assert.equal(
      INTEGRATED_GPU_REGEX.test(sample),
      true,
      `Expected sample "${sample}" to be classified as integrated GPU`,
    );
  }

  // Discrete high-performance GPUs that should run FULL mode
  const discreteSamples = [
    'NVIDIA GeForce RTX 4070 Ti',
    'NVIDIA GeForce RTX 3080',
    'NVIDIA GeForce GTX 1080',
    'AMD Radeon RX 7900 XTX',
    'AMD Radeon RX 6700 XT',
  ];

  for (const sample of discreteSamples) {
    assert.equal(
      INTEGRATED_GPU_REGEX.test(sample),
      false,
      `Expected sample "${sample}" to be classified as discrete GPU`,
    );
  }
});

test('resolveQualityMode honors URL overrides, preferences, and hardware', () => {
  // URL ?lite forces lite
  const liteUrl = resolveQualityMode({ isIntegrated: false }, '?lite');
  assert.equal(liteUrl.isLite, true);
  assert.match(liteUrl.reason, /URL parameter \?lite/);

  // URL ?full forces full even on integrated GPU
  const fullUrl = resolveQualityMode({ isIntegrated: true }, '?full');
  assert.equal(fullUrl.isLite, false);
  assert.match(fullUrl.reason, /URL parameter \?full/);

  // Hardware detection default when no URL params
  const hwLite = resolveQualityMode({ isIntegrated: true }, '');
  assert.equal(hwLite.isLite, true);
  assert.match(hwLite.reason, /integrated GPU/);

  const hwFull = resolveQualityMode({ isIntegrated: false }, '');
  assert.equal(hwFull.isLite, false);
  assert.match(hwFull.reason, /discrete GPU/);
});

test('renderScale calculates correct drawing buffer budgets', () => {
  // On a 1080p screen (1920x1080):
  const fullScale = renderScale(1920, 1080, false);
  const liteScale = renderScale(1920, 1080, true);

  // Full scale targets ~1.24 MP
  const fullTargetPixels = 1920 * fullScale * (1080 * fullScale);
  assert.ok(Math.abs(fullTargetPixels - RENDER_BUDGET_PX) < 50);

  // Lite scale targets ~0.78 MP
  const liteTargetPixels = 1920 * liteScale * (1080 * liteScale);
  assert.ok(Math.abs(liteTargetPixels - RENDER_BUDGET_PX_LITE) < 50);

  // Lite scale should be ~20% lower pixel ratio (~37% fewer shaded pixels)
  assert.ok(liteScale < fullScale);
  assert.ok(liteScale >= 0.55 && liteScale <= 0.65);

  // Small windows cap at 1.0 (no upscale beyond native window)
  assert.equal(renderScale(800, 600, false), 1.0);
  assert.equal(renderScale(800, 600, true), 1.0);
});

test('autoResolution adjusts resolution dynamically under high frame times', () => {
  let pixelRatio = 1.0;
  let sizeSet = null;
  let gradeResized = null;

  const mockRenderer = {
    setPixelRatio: (r) => { pixelRatio = r; },
    setSize: (w, h) => { sizeSet = { w, h }; },
  };

  const mockGrade = {
    resize: (w, h) => { gradeResized = { w, h }; },
  };

  // Mock global window dimensions
  global.window = { innerWidth: 1920, innerHeight: 1080 };

  const update = autoResolution(mockRenderer, mockGrade, true);
  assert.equal(typeof update, 'function');

  // Push 60 frames with high frame times (30ms = 33 FPS)
  for (let i = 0; i < 60; i++) {
    update(0.030);
  }

  // Should have triggered downscale
  assert.ok(pixelRatio < renderScale(1920, 1080, true));
  assert.ok(sizeSet !== null);
  assert.ok(gradeResized !== null);
});

test('CommandEngine supports /quality and /perf commands', () => {
  const messages = [];
  let qualitySet = null;

  const ctx = {
    chat: {
      post: (sender, msg) => messages.push({ sender, msg }),
    },
    isLite: true,
    gpuInfo: { gpuDesc: 'Intel(R) Graphics' },
    setQuality: (q) => { qualitySet = q; },
    stats: {
      samples: [{ ms: 14.5 }, { ms: 15.2 }, { ms: 14.8 }],
      snapshot: { draws: 420, bundledDraws: 80, tris: 1.1e6, bundledTris: 0.2e6 },
    },
    world: { chunks: { size: 9 } },
    renderer: { getPixelRatio: () => 0.61 },
  };

  const engine = new CommandEngine(ctx);

  // 1. Query quality status
  messages.length = 0;
  engine.execute('/quality');
  assert.ok(messages.some((m) => m.msg.includes('Current quality: LITE')));

  // 2. Set quality to full
  messages.length = 0;
  engine.execute('/quality full');
  assert.equal(qualitySet, 'full');

  // 3. Set quality to auto
  messages.length = 0;
  engine.execute('/quality auto');
  assert.equal(qualitySet, 'auto');

  // 4. Run /perf
  messages.length = 0;
  engine.execute('/perf');
  assert.ok(messages.some((m) => m.msg.includes('[PERF] Mode: LITE')));
  assert.ok(messages.some((m) => m.msg.includes('Draws: 500')));
});
