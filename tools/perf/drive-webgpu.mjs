// The border drive on the WEBGPU backend (SwiftShader adapter), draws stubbed: pipelines created,
// queue.writeBuffer calls and CPU ms per frame. The backend the owner's laptop uses, on a software
// adapter -- counts transfer, milliseconds only roughly.
//   npx vite build && npx vite preview --port 4174 --strictPort &
//   node tools/perf/drive-webgpu.mjs          env: N (frames, 340)  X (extra query, e.g. '&ubo&ranges' = three's defaults)  BOOT_MS
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.addInitScript(() => {
  const C = window.__g = { pipe: 0, write: 0, draws: 0 };
  const w = (P, n, f) => { if (!P) return; const r = P.prototype[n]; if (!r) return; P.prototype[n] = function (...a) { return f.call(this, r, a); }; };
  for (const n of ['createRenderPipeline', 'createRenderPipelineAsync']) w(window.GPUDevice, n, function (r, a) { C.pipe++; return r.apply(this, a); });
  w(window.GPUQueue, 'writeBuffer', function (r, a) { C.write++; return r.apply(this, a); });
  for (const P of [window.GPURenderPassEncoder, window.GPURenderBundleEncoder]) for (const n of ['draw', 'drawIndexed']) w(P, n, function () { C.draws++; });
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  let virtual = false, vt = 0, s0 = 0, inS = false; const q = [];
  performance.now = () => (virtual ? vt + (inS ? Math.min(realNow() - s0, 33) : 0) : realNow());
  window.requestAnimationFrame = (cb) => { if (!virtual) return realRaf(cb); q.push(cb); return q.length; };
  window.__goVirtual = () => { vt = realNow(); virtual = true; };
  window.__step = (ms) => { const c0 = { ...C }; vt += ms; s0 = realNow(); inS = true; for (const cb of q.splice(0)) cb(vt); inS = false; return [+(realNow() - s0).toFixed(0), C.pipe - c0.pipe, C.write - c0.write, Math.floor(window.car.x / 256)]; };
});
const t0 = Date.now(), say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);
await page.goto('http://localhost:4174/?quality=balanced&nodrs&debug' + (process.env.X || ''), { waitUntil: 'load', timeout: 120000 });
const ok = await page.waitForFunction(() => !document.getElementById('boot') && (window._world?.chunks?.size ?? 0) >= 9, null, { timeout: +process.env.BOOT_MS || 420000, polling: 2000 }).then(() => true).catch(() => false);
say(`booted=${ok} backend=${await page.evaluate(() => window.renderer?.backend?.isWebGPUBackend ? 'WebGPU' : window.renderer?.backend?.isWebGLBackend ? 'WebGL' : 'none')} ` + JSON.stringify(await page.evaluate(() => window.__g)));
if (ok) {
  await page.evaluate(() => { window.__goVirtual(); });
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.__step(33.3));
  await page.evaluate(() => window.runBenchmark(30));
  const F = [];
  for (let i = 0; i < +(process.env.N || 340); i++) F.push(await page.evaluate(() => window.__step(33.3)));
  const d = F.slice(40), ms = d.map((f) => f[0]).sort((a, b) => a - b);
  const bi = d.findIndex((f, i) => i > 0 && f[3] !== d[i - 1][3]);
  say(JSON.stringify({ frames: d.length, p50: ms[ms.length >> 1], worst3: ms.slice(-3), writesPerFrame: Math.round(d.reduce((s, f) => s + f[2], 0) / d.length), pipelinesTotal: d.reduce((s, f) => s + f[1], 0), borderAt: bi + 40, pipelinesAfterBorder: bi < 0 ? null : d.slice(bi).reduce((s, f) => s + f[1], 0), worstAfterBorder: bi < 0 ? null : Math.max(...d.slice(bi).map((f) => f[0])) }));
}
console.log(errs.slice(0, 6).join('\n'));
await b.close();
