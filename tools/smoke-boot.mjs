// Boot smoke test: does the built game actually START? (2026-09-24)
// Catches what node tests cannot: a missing import that kills the bundle, a
// district that never loads ("every boot fell back to the legacy grid"), a
// spawn that lands somewhere else. No GPU needed (software GL).
//   npx vite build && npx vite preview --port 4173 &
//   node tools/smoke-boot.mjs [url]        exit 0 = pass, 1 = fail
// Takes ~5 min on a GPU-less container (shader compile under llvmpipe).
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/?quality=low&webgl&nowarm';
const LIMIT = +(process.env.LIMIT_S || 900) * 1000;
const b = await chromium.launch({ channel: 'chromium', headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
  env: { ...process.env, EGL_PLATFORM: 'surfaceless', GALLIUM_DRIVER: 'llvmpipe', LIBGL_ALWAYS_SOFTWARE: '1' } });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], warns = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { const t = m.text(); if (/district not loaded|staying on the grid/i.test(t)) errors.push(t); if (m.type() === 'error') warns.push(t.slice(0, 200)); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
let state = null;
while (Date.now() - t0 < LIMIT && !errors.length) {
  await new Promise((r) => setTimeout(r, 10000));
  state = await Promise.race([page.evaluate(() => ({ d: !!window._world?.district, chunks: window._world?.chunks?.size ?? 0, x: window.car?.x ?? 0, z: window.car?.z ?? 0 })), new Promise((r) => setTimeout(() => r(null), 8000))]);
  if (state?.d && state.chunks >= 4) break;
}
await b.close();
const s = ((Date.now() - t0) / 1000).toFixed(0);
const fail = [];
if (errors.length) fail.push(...errors.map((e) => 'page error: ' + e.slice(0, 300)));
if (!state?.d) fail.push('district never loaded');
else if (state.chunks < 4) fail.push(`only ${state.chunks} chunks built`);
// default spawn is Little Tokyo (2354,1408): landing elsewhere means the spawn path broke
if (state?.d && Math.hypot(state.x - 2354, state.z - 1408) > 60) fail.push(`spawned at ${state.x.toFixed(0)},${state.z.toFixed(0)}, not Little Tokyo`);
console.log(fail.length ? `SMOKE FAIL after ${s} s\n  ` + fail.join('\n  ') : `SMOKE PASS in ${s} s: district loaded, ${state.chunks} chunks, spawn ${state.x.toFixed(0)},${state.z.toFixed(0)}`);
if (warns.length) console.log(`(${warns.length} console errors, first: ${warns[0]})`);
process.exit(fail.length ? 1 : 0);
