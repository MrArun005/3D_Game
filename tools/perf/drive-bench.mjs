// CPU-side frame cost of DRIVING, for machines without a usable GPU (2026-11-11).
// Drives the game's own benchmark route (window.runBenchmark) under a virtual
// clock (each frame advances exactly 1/FPS of game time) with the GL draw calls
// stubbed out, and records per frame: JS milliseconds, shader programs linked,
// buffer uploads, draw calls, the chunk the car is in. What transfers to a real
// GPU: hitch counts, programs compiled, uploads, draws. What does not: fps.
//   npx vite build --minify false --outDir /tmp/hb-perf && npx vite preview --outDir /tmp/hb-perf --port 4174 &
//   PLAYWRIGHT=/opt/node-tools/node_modules/playwright/index.mjs node tools/perf/drive-bench.mjs out.json
// env: URL (http://localhost:4174/)  Q (?quality=balanced&webgl&nodrs&debug)  FRAMES (600)  FPS (30)
//      PROFILE=a,b  CPU-profiles bench frames a..b (CDP) and prints the top self and inclusive times
//      DRAW=1 keeps the real draw calls (slow; they are stubbed from page load otherwise)   SCENARIO=bench|idle
// Inside a frame performance.now() advances with REAL time, so the streamer's
// millisecond budgets trip as they would in play.
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const out = process.argv[2] || 'drive-bench.json';
const FRAMES = +(process.env.FRAMES || 600), FPS = +(process.env.FPS || 30);
const url = (process.env.URL || 'http://localhost:4174/') + (process.env.Q || '?quality=balanced&webgl&nodrs&debug');
const b = await chromium.launch({ channel: 'chromium', headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
  env: { ...process.env, EGL_PLATFORM: 'surfaceless', GALLIUM_DRIVER: 'llvmpipe', LIBGL_ALWAYS_SOFTWARE: '1' } });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`.slice(0, 300)); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 300)));
await page.addInitScript((stubDraws) => {
  const C = window.__gl = { builds: 0, kinds: [], link: 0, sub: 0, subBytes: 0, data: 0, dataBytes: 0, tex: 0, draws: 0, del: 0, stub: true };
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, fn) => { const real = P[name]; P[name] = function (...a) { return fn.call(this, real, a); }; };
  wrap('linkProgram', function (real, a) { C.link++; return real.apply(this, a); });
  const H = window.__hist = { on: false, size: {}, stack: {} };   // HIST=1: who uploads what, by size and call site
  wrap('bufferSubData', function (real, a) {
    const n = a[2]?.byteLength ?? 0; C.sub++; C.subBytes += n;
    if (H.on) { H.size[n] = (H.size[n] || 0) + 1; if (Math.random() < 0.02) { const k = n + ' ' + new Error().stack.split('\n').slice(3, 9).map((l) => l.trim().replace(/\(?https?:\/\/[^/]+\/assets\//, '(').slice(3, 60)).join(' < '); H.stack[k] = (H.stack[k] || 0) + 1; } }
    return real.apply(this, a); });
  wrap('bufferData', function (real, a) { C.data++; C.dataBytes += a[1]?.byteLength ?? (typeof a[1] === 'number' ? a[1] : 0); return real.apply(this, a); });
  wrap('deleteBuffer', function (real, a) { C.del++; return real.apply(this, a); });
  for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'texStorage2D']) wrap(n, function (real, a) { C.tex++; return real.apply(this, a); });
  for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'])
    wrap(n, function (real, a) { C.draws++; if (C.stub && stubDraws) return; return real.apply(this, a); });
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  let virtual = false, vt = 0, stepReal = 0, inStep = false, nextId = 1e9;
  const rafQ = [], timers = new Map();
  performance.now = function () { if (!virtual) return realNow(); return vt + (inStep ? Math.min(realNow() - stepReal, 1000 / 30 - 0.01) : 0); };
  window.requestAnimationFrame = function (cb) { if (!virtual) return realRaf(cb); rafQ.push(cb); return rafQ.length; };
  window.setTimeout = function (cb, ms = 0, ...a) { if (!virtual || typeof cb !== 'function') return realST(cb, ms, ...a); const id = nextId++; timers.set(id, { due: vt + Math.max(0, +ms || 0), cb, a }); return id; };
  window.clearTimeout = function (id) { if (!timers.delete(id)) realCT(id); };
  window.setInterval = function (cb, ms = 0, ...a) { if (!virtual || typeof cb !== 'function') return realSI(cb, ms, ...a); const id = nextId++, every = Math.max(1, +ms || 1); timers.set(id, { due: vt + every, cb, a, every }); return id; };
  window.clearInterval = function (id) { if (!timers.delete(id)) realCI(id); };
  window.MediaRecorder = undefined;
  window.__goVirtual = () => { vt = realNow(); virtual = true; C.stub = true; };
  window.__step = (ms) => {
    const before = { ...C }; C.kinds = [];
    const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    vt += ms; stepReal = realNow(); inStep = true;
    for (const [id, t] of [...timers]) if (t.due <= vt) { if (t.every) t.due += t.every; else timers.delete(id); try { t.cb(...t.a); } catch (e) { console.error('timer: ' + e.message); } }
    const cbs = rafQ.splice(0);
    for (const cb of cbs) { try { cb(vt); } catch (e) { console.error('raf: ' + e.message + ' ' + (e.stack || '').slice(0, 200)); } }
    inStep = false;
    const js = realNow() - stepReal, w = window._world, c = window.car;
    return [+js.toFixed(1), C.link - before.link, C.sub - before.sub, C.subBytes - before.subBytes, C.data - before.data, C.dataBytes - before.dataBytes,
      C.tex - before.tex, C.draws - before.draws, C.del - before.del, c ? Math.floor(c.x / 256) : 0, c ? Math.floor(c.z / 256) : 0, w?.chunks?.size ?? 0,
      c ? +(Math.hypot(c.vx ?? 0, c.vz ?? 0) * 3.6).toFixed(0) : 0, C.builds - before.builds,
      performance.memory ? +((performance.memory.usedJSHeapSize - heap0) / 1e6).toFixed(1) : 0, C.kinds.join(' ')];
  };
}, !process.env.DRAW);
const t0 = Date.now();
const say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 1500000, polling: 1000 }).catch(() => say('boot overlay never cleared'));
const bootS = (Date.now() - t0) / 1000;
say('boot overlay gone');
await page.waitForFunction(() => (window._world?.chunks?.size ?? 0) >= 9, null, { timeout: 1500000, polling: 2000 }).catch(() => say('chunks never 9'));
const boot = await page.evaluate(() => ({ ...window.__gl, chunks: window._world?.chunks?.size }));
say(`playable: ${JSON.stringify(boot)}`);
await page.evaluate((process_trace) => {
  window.__goVirtual();
  // TSL node builds per frame, and what was built: three builds one per new render object (see world/instPool.js)
  const n = window.renderer?._nodes, C = window.__gl;
  if (n?._createNodeBuilder) { const real = n._createNodeBuilder.bind(n); n._createNodeBuilder = (ro, mat) => { C.builds++; const o = ro.object; if (C.kinds.length < 12) C.kinds.push(`${o.isInstancedMesh ? 'inst' : o.isSprite ? 'sprite' : o.isSkinnedMesh ? 'skinned' : o.isMesh ? 'mesh' : o.type}:${mat.name || mat.type}${o.name ? '(' + o.name + ')' : ''}${process_trace ? ' ' + JSON.stringify({ ctx: ro.context?.id, p: o.userData?.pooled ? [o.userData.pooled.main ? 1 : 0, o.userData.pooled.cast ? 1 : 0] : null, cam: ro.camera?.type + (ro.camera?.isArrayCamera ? 'A' : ''), rt: ro.context?.renderTarget ? (ro.context.renderTarget.width + 'x' + ro.context.renderTarget.height + (ro.context.renderTarget.isShadow ? 's' : '')) : 'canvas', cast: o.castShadow, vis: o.visible, cold: o.userData?.coldMask !== undefined }) : ''}`); return real(ro, mat); }; }
}, !!process.env.TRACE);
const frames = [];
const step = async () => { const r = await page.evaluate((ms) => window.__step(ms), 1000 / FPS); frames.push(r); return r; };
for (let i = 0; i < 20; i++) await step();                       // settle on the virtual clock
if (process.env.SCENARIO === 'warp') {
  /* A teleport (respawn at the hospital, /tp, a story warp): worst frame, and frames until the 3x3 ring is in and
     nothing is waiting. WARP="x,z" (default the Quadrant, ~600 m from the spawn). */
  const [wx, wz] = (process.env.WARP || '1934,1659').split(',').map(Number);
  await page.evaluate(([x, z]) => window.__warp(x, z, 0), [wx, wz]);
  const W = []; let ready = -1;
  for (let i = 0; i < 600; i++) {
    const r = await step(); W.push(r);
    const st = await page.evaluate(() => { const w = window._world, c = window.car, ix = Math.floor(c.x / 256), iz = Math.floor(c.z / 256); let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (w.chunks.has(`${ix + a},${iz + b}`) || (w.keptCells && !w.keptCells.has(`${ix + a},${iz + b}`))) n++; return [n, w.queue.length, w.building ? 1 : 0, w.ringReady ? (w.ringReady(c.x, c.z) ? 0 : 1) : (w.cold ? w.cold.length : 0)]; });   // ringReady: built, and nothing DRAWN still waiting to join
    if (ready < 0 && st[0] === 9 && st[3] === 0) ready = i;
    if (ready >= 0 && i > ready + 30) break;
  }
  const ms = W.map((f) => f[0]);
  console.log(JSON.stringify({ warp: [wx, wz], worstMs: Math.max(...ms), over250: ms.filter((m) => m > 250).length, over100: ms.filter((m) => m > 100).length, framesToRing: ready, cpuMsToRing: Math.round(ms.slice(0, ready + 1).reduce((a, b) => a + b, 0)), builds: W.reduce((a, f) => a + f[13], 0), first12: W.slice(0, 12).map((f) => `${f[0]}ms b${f[13]} ${(f[5] / 1e6).toFixed(1)}MB ch${f[11]} ${(f[15] || "").slice(0, 120)}`) }, null, 1));
  await b.close(); process.exit(0);
}
if ((process.env.SCENARIO || 'bench') === 'bench') await page.evaluate((sec) => window.runBenchmark(sec), Math.max(30, Math.ceil(FRAMES / FPS)));   // the route lasts ~90 s
const mark = frames.length;
const [pa, pb] = (process.env.PROFILE || '').split(',').map(Number);
const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null;
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); }
const [ha, hb] = (process.env.ALLOC || '').split(',').map(Number);   // ALLOC=a,b: sampled allocation profile of frames a..b
const hcdp = process.env.ALLOC ? await page.context().newCDPSession(page) : null;
for (let i = 0; i < FRAMES; i++) {
  if (hcdp && i === ha) await hcdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  if (hcdp && i === hb) {
    const { profile } = await hcdp.send('HeapProfiler.stopSampling');
    const self = new Map(); let total = 0;
    const walk = (n, path) => { const nm = `${n.callFrame.functionName || '(anon)'} :${n.callFrame.lineNumber}`; if (n.selfSize) { total += n.selfSize; const k = nm + '  <  ' + path.slice(-3).reverse().join(' < '); self.set(k, (self.get(k) || 0) + n.selfSize); } for (const c of n.children || []) walk(c, [...path, nm]); };
    walk(profile.head, []);
    console.log(`ALLOC frames ${ha}..${hb}: ${(total / 1e6 / (hb - ha)).toFixed(2)} MB per frame\n  ` + [...self].sort((x, y) => y[1] - x[1]).slice(0, 22).map(([k, v]) => `${(v / 1e6 / (hb - ha)).toFixed(3)} MB/frame  ${k}`).join('\n  '));
  }
  if (cdp && i === pa) await cdp.send('Profiler.start');
  if (cdp && i === pb) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])), dt = profile.timeDeltas, parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const incl = new Map(), name = (n) => `${n.callFrame.functionName || '(anon)'} :${n.callFrame.lineNumber}`;
    profile.samples.forEach((id, k) => {
      const n = byId.get(id), d = (dt[k] || 0) / 1000;
      self.set(name(n), (self.get(name(n)) || 0) + d);
      const seen = new Set();
      for (let c = id; c !== undefined; c = parent.get(c)) { const nm = name(byId.get(c)); if (!seen.has(nm)) { seen.add(nm); incl.set(nm, (incl.get(nm) || 0) + d); } }
    });
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`).join('\n  ');
    console.log(`PROFILE frames ${pa}..${pb}\n self:\n  ${top(self, 30)}\n inclusive:\n  ${top(incl, 70)}`);
  }
  const r = await step();
  if (i % 100 === 0 || (process.env.TRACE && i % 10 === 0)) say(`frame ${i}/${FRAMES} js ${r[0]} ms chunk ${r[9]},${r[10]} live ${r[11]} ${r[12]} km/h ` + await page.evaluate(() => { const w = window._world; return `catchUp ${!!w.catchUp} cold ${w.cold?.length ?? '-'} builds ${window.__gl.builds}`; }));
}
if (process.env.HIST) {
  await page.evaluate(() => { window.__hist.on = true; });
  for (let i = 0; i < 30; i++) await step();
  const h = await page.evaluate(() => window.__hist);
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log('bufferSubData sizes over 30 frames (bytes: calls):', JSON.stringify(top(h.size, 14)));
  for (const [k, v] of top(h.stack, 12)) console.log(v, k);
  frames.length -= 30;
}
let preset = null;
if (process.env.PRESET) {   // PRESET=kingsway-corner: go to a photo preset after the drive, let it stream in, read draws and triangles
  await page.evaluate(() => { document.getElementById('bench')?.remove(); });
  await page.evaluate((n) => { if (!window.photo.on) window.photo.toggle?.(); window.photo.goto(n); }, process.env.PRESET);
  for (let i = 0; i < 500; i++) { await page.evaluate((ms) => window.__step(ms), 1000 / FPS); if (i > 40 && await page.evaluate(() => { const w = window._world; return !w.building && w.queue.length === 0 && (w.ringReady ? w.ringReady(window.photo.camera?.position.x ?? window.car.x, window.photo.camera?.position.z ?? window.car.z) : true); })) break; }
  for (let i = 0; i < 10; i++) await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
  preset = await page.evaluate(() => ({ line: window.photo?.line?.(), on: window.photo?.on, chunks: window._world.chunks.size }));
  console.log('PRESET', process.env.PRESET, JSON.stringify(preset));
}
const info = await page.evaluate(() => ({ bench: document.getElementById('bench')?.textContent?.slice(0, 200), line: window.photo?.line?.() }));
await b.close();
// ---- summary
const F = frames.slice(mark), ms = F.map((f) => f[0]).sort((a, b) => a - b);
const q = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
const borders = [];
for (let i = 1; i < F.length; i++) if (F[i][9] !== F[i - 1][9] || F[i][10] !== F[i - 1][10]) borders.push(i);
const sum = (k, a = F) => a.reduce((s, f) => s + f[k], 0);
const summary = {
  url, frames: F.length, bootS: +bootS.toFixed(0), bootPrograms: boot.link,
  jsMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), worst: ms[ms.length - 1] },
  over100: F.filter((f) => f[0] > 100).length, over250: F.filter((f) => f[0] > 250).length,
  programs: sum(1), perFrame: { bufferSubData: Math.round(sum(2) / F.length), subMB: +(sum(3) / F.length / 1e6).toFixed(2), draws: Math.round(sum(7) / F.length) },
  teleport: { worst3: F.slice(0, 40).map((f) => f[0]).sort((a, b) => b - a).slice(0, 3), programs: sum(1, F.slice(0, 40)) },
  borders: borders.map((i) => ({ frame: i, to: `${F[i][9]},${F[i][10]}`, kmh: F[i][12], worst3: F.slice(i, i + 45).map((f) => f[0]).sort((a, b) => b - a).slice(0, 3), programs: sum(1, F.slice(i, i + 45)), deletes: sum(8, F.slice(i, i + 45)) })),
  worstFrames: F.map((f, i) => [i, ...f]).filter((f) => f[0] >= 40).sort((a, b) => b[1] - a[1]).slice(0, 12).map((f) => ({ frame: f[0], ms: f[1], programs: f[2], sub: f[3], dataMB: +(f[6] / 1e6).toFixed(1), tex: f[7], del: f[9], chunk: `${f[10]},${f[11]}` })),
  /* every driving frame over twice the median, with its cause: node builds (and of what), a heap that fell
     (a major GC ran inside the frame), uploads, or the frames since the last chunk border */
  slow: F.map((f, i) => [i, f]).filter(([i, f]) => i > 40 && f[0] > 2 * q(0.5)).map(([i, f]) => ({ frame: i, ms: f[0], sinceBorder: (() => { const b = borders.filter((x) => x <= i).pop(); return b === undefined ? null : i - b; })(), builds: f[13], heapMB: f[14], dataMB: +(f[5] / 1e6).toFixed(2), what: f[15] })),
  heapDrops: F.filter((f, i) => i > 40 && f[14] < -20).map((f) => ({ ms: f[0], heapMB: f[14] })),
  info, logs: logs.slice(0, 10),
};
fs.writeFileSync(out, JSON.stringify({ summary, cols: ['jsMs', 'programs', 'bufferSubData', 'subBytes', 'bufferData', 'dataBytes', 'tex', 'draws', 'deletes', 'cx', 'cz', 'chunks', 'kmh', 'builds', 'heapDeltaMB', 'built'], frames }));
console.log(JSON.stringify(summary, null, 1));
