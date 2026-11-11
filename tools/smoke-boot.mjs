// Boot smoke test: does the built game actually START? (2026-09-24, reworked 2026-11-11)
// Catches what node tests cannot: a missing import that kills the bundle, a
// district that never loads ("every boot fell back to the legacy grid"), a
// spawn that lands somewhere else. No GPU needed (software GL).
//   npx vite build && node tools/smoke-boot.mjs [url]        exit 0 = pass, 1 = fail
// It starts `vite preview` itself when nothing answers on the URL, and stops
// it again on every exit path (the npm script's `kill %1` left it on :4173
// after a failure). Playwright: $PLAYWRIGHT (a module path), else the
// project's, else the cloud container's pre-installed copy.
// `?nowarm` skips the asset pre-cache and the shader warm-up, so a pass takes
// a couple of minutes on a GPU-less container instead of sitting in llvmpipe
// compiles; GL draw calls are stubbed for the same reason (STUB=0 keeps them).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const t of tries) { try { return await import(t); } catch { /* next */ } }
  console.log('SMOKE FAIL: playwright not found (set PLAYWRIGHT=/path/to/playwright/index.mjs)'); process.exit(1);
}
const { chromium } = await loadPlaywright();
const url = process.argv[2] || 'http://localhost:4173/?quality=low&webgl&nowarm';
const LIMIT = +(process.env.LIMIT_S || 900) * 1000;
const up = async () => { try { return (await fetch(new URL('/', url), { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let server = null, browser = null;
const cleanup = () => { try { browser?.close(); } catch { /* */ } if (server) { try { process.kill(-server.pid); } catch { /* */ } server = null; } };
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(1); });
if (!(await up())) {
  if (!fs.existsSync('dist/index.html')) { console.log('SMOKE FAIL: no dist/ -- run `npx vite build` first'); process.exit(1); }
  const port = new URL(url).port || '4173';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) { console.log(`SMOKE FAIL: vite preview did not come up on :${port}`); process.exit(1); }
}
browser = await chromium.launch({ channel: 'chromium', headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
  env: { ...process.env, EGL_PLATFORM: 'surfaceless', GALLIUM_DRIVER: 'llvmpipe', LIBGL_ALWAYS_SOFTWARE: '1' } });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (process.env.STUB !== '0') await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype;
  for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) P[n] = function () {};
});
const errors = [], warns = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { const t = m.text(); if (/district not loaded|staying on the grid/i.test(t)) errors.push(t); if (m.type() === 'error') warns.push(t.slice(0, 200)); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
let state = null;
while (Date.now() - t0 < LIMIT && !errors.length) {
  await new Promise((r) => setTimeout(r, 5000));
  /* The main thread can sit in one software-GL frame for a minute: a short
     race here read "no state" on every poll and the test could only time out. */
  const s = await Promise.race([page.evaluate(() => ({ d: !!window._world?.district, chunks: window._world?.chunks?.size ?? 0, x: window.car?.x ?? 0, z: window.car?.z ?? 0 })).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 120000))]);
  if (s) state = s;
  if (state?.d && state.chunks >= 4) break;
}
const s = ((Date.now() - t0) / 1000).toFixed(0);
const fail = [];
if (errors.length) fail.push(...errors.map((e) => 'page error: ' + e.slice(0, 300)));
if (!state?.d) fail.push('district never loaded');
else if (state.chunks < 4) fail.push(`only ${state.chunks} chunks built`);
// default spawn is Little Tokyo (2354,1408): landing elsewhere means the spawn path broke
if (state?.d && Math.hypot(state.x - 2354, state.z - 1408) > 60) fail.push(`spawned at ${state.x.toFixed(0)},${state.z.toFixed(0)}, not Little Tokyo`);
console.log(fail.length ? `SMOKE FAIL after ${s} s\n  ` + fail.join('\n  ') : `SMOKE PASS in ${s} s: district loaded, ${state.chunks} chunks, spawn ${state.x.toFixed(0)},${state.z.toFixed(0)}`);
if (warns.length) console.log(`(${warns.length} console errors, first: ${warns[0]})`);
await browser.close().catch(() => {}); browser = null;
cleanup();
process.exit(fail.length ? 1 : 0);
