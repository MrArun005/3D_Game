const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
import fs from 'fs';
const [url, tag, NF = '450', FPS = '30', MODE = 'bench'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'], env: { ...process.env, EGL_PLATFORM: 'surfaceless', GALLIUM_DRIVER: 'llvmpipe', LIBGL_ALWAYS_SOFTWARE: '1' } });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const cdp = await page.context().newCDPSession(page);
const log = []; const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1);
const out = (s) => { log.push(`[${T()}] ${s}`); fs.writeFileSync(`${tag}.log`, log.join('\n')); };
const seen = new Map();
page.on('pageerror', (e) => out('PAGEERROR ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
page.on('console', (m) => { const t = m.text(); if (/GPU stall|AttributeNode/.test(t)) return; if (!['error', 'warning'].includes(m.type())) return; const k = t.replace(/[\d.]+/g, '#').slice(0, 60); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n <= 3 || /\[lag\]/.test(t)) out(`CONSOLE.${m.type()} ${t.slice(0, 400)}`); });
page.on('response', (r) => { if (r.status() >= 400) out(`HTTP ${r.status()} ${r.url()}`); });
page.on('crash', () => out('PAGE CRASH'));
await page.addInitScript(() => {
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window), realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  let virtual = false, vt = 0, drift = 0, nextId = 1e9; const rafQ = [], timers = new Map();
  performance.now = function () { if (!virtual) return realNow(); drift = Math.min(drift + 0.0002, 12); return vt + drift; };
  window.requestAnimationFrame = function (cb) { if (!virtual) return realRaf(cb); rafQ.push(cb); return rafQ.length; };
  window.setTimeout = function (cb, ms = 0, ...a) { if (!virtual || typeof cb !== 'function') return realST(cb, ms, ...a); const id = nextId++; timers.set(id, { due: vt + Math.max(0, +ms || 0), cb, a }); return id; };
  window.clearTimeout = function (id) { if (!timers.delete(id)) realCT(id); };
  window.setInterval = function (cb, ms = 0, ...a) { if (!virtual || typeof cb !== 'function') return realSI(cb, ms, ...a); const id = nextId++, every = Math.max(1, +ms || 1); timers.set(id, { due: vt + every, cb, a, every }); return id; };
  window.clearInterval = function (id) { if (!timers.delete(id)) realCI(id); };
  window.MediaRecorder = undefined;
  const G = window.__gl = { link: 0, compile: 0, tex: 0, buf: 0, bufBytes: 0, draws: 0, fbo: 0, del: 0 };
  const P = WebGL2RenderingContext.prototype; const wrap = (n, f) => { const o = P[n]; if (!o) return; P[n] = function (...a) { f(a); return o.apply(this, a); }; };
  wrap('linkProgram', () => G.link++); wrap('compileShader', () => G.compile++);
  for (const n of ['texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D']) wrap(n, () => G.tex++);
  wrap('bufferData', (a) => { G.buf++; G.bufBytes += (typeof a[1] === 'number' ? a[1] : a[1]?.byteLength) || 0; });
  wrap('bufferSubData', (a) => { G.buf++; G.bufBytes += a[2]?.byteLength || 0; });
  for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { if (P[n]) P[n] = function () { G.draws++; }; }   // NO-OP draws: CPU side only
  wrap('bindFramebuffer', () => G.fbo++); wrap('deleteBuffer', () => G.del++);
  window.__goVirtual = () => { vt = realNow(); drift = 0; virtual = true; };
  window.__step = (ms) => {
    const g0 = { ...G }; const r0 = realNow(); vt += ms; drift = 0;
    for (const [id, t] of [...timers]) if (t.due <= vt) { if (t.every) t.due += t.every; else timers.delete(id); try { t.cb(...t.a); } catch (e) { console.error('timer: ' + e.message); } }
    const r1 = realNow(); const cbs = rafQ.splice(0);
    for (const cb of cbs) { try { cb(vt); } catch (e) { console.error('raf: ' + e.message + ' ' + (e.stack || '').split('\n')[1]); } }
    const r2 = realNow(); const d = {}; for (const k in G) d[k] = G[k] - g0[k];
    const c = window.car, w = window._world; const st = window.__perf?.();
    return { timers: +(r1 - r0).toFixed(2), js: +(r2 - r1).toFixed(2), ...d, x: c?.x, z: c?.z, v: Math.hypot(c?.vx || 0, c?.vz || 0), y: c?.y, yaw: c?.yaw, chunks: w?.chunks?.size, building: w?.building?.k ?? null, queue: w?.queue?.length, worst: w?.worstSlice ? [w.worstSlice.ms, w.worstSlice.step] : null, chunkMs: st?.chunk, fin: [c?.x, c?.z, c?.vx, c?.vz, c?.yaw, c?.yawRate].every(Number.isFinite) };
  };
});
await page.goto(url, { waitUntil: 'load', timeout: 300000 }); out('loaded');
const ev = (f, a, ms = 120000) => Promise.race([page.evaluate(f, a), new Promise((r) => setTimeout(() => r('EVAL-TIMEOUT'), ms))]);
let ok = false;
while (Date.now() - t0 < 40 * 60000) { await new Promise((r) => setTimeout(r, 15000)); const s = await ev(() => ({ chunks: window._world?.chunks?.size ?? 0, boot: !!document.getElementById('boot'), gl: window.__gl, q: window.__quality?.name })); out('STATE ' + JSON.stringify(s)); if (s?.chunks >= 9 && !s.boot) { ok = true; break; } }
if (!ok) { out('never booted'); await b.close(); process.exit(1); }
out('SPAWN ' + await ev(() => window.photo?.line?.()));
await ev(() => { window.__goVirtual(); });
const dt = 1000 / +FPS; const frames = []; const total = new Map();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
const stepP = async (prof = true) => {
  if (prof) await cdp.send('Profiler.start');
  const r = await page.evaluate((ms) => window.__step(ms), dt);
  if (prof) {
    const { profile } = await cdp.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    (profile.samples || []).forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const name = (f.functionName || '(anon)') + (f.url ? ':' + f.lineNumber : ' [native]'); self.set(name, (self.get(name) || 0) + (profile.timeDeltas[i] || 0) / 1000); });
    for (const [k, v] of self) total.set(k, (total.get(k) || 0) + v);
    r.top = [...self].filter(([k]) => !/^\((idle|program)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, +v.toFixed(1)]);
  }
  return r;
};
for (let i = 0; i < 20; i++) frames.push({ i: -20 + i, ...(await stepP()) });   // idle baseline at spawn
out('idle baseline done');
if (MODE === 'bench') await page.evaluate(() => window.runBenchmark());
for (let i = 0; i < +NF; i++) {
  const r = await stepP(); frames.push({ i, ...r });
  if (i % 25 === 0) { out(`frame ${i} js ${r.js} draws ${r.draws} link ${r.link} x ${r.x?.toFixed(0)} z ${r.z?.toFixed(0)} v ${r.v?.toFixed(1)} chunks ${r.chunks}`); fs.writeFileSync(`${tag}.json`, JSON.stringify({ frames, total: [...total].sort((a, b) => b[1] - a[1]).slice(0, 150) })); }
}
fs.writeFileSync(`${tag}.json`, JSON.stringify({ frames, total: [...total].sort((a, b) => b[1] - a[1]).slice(0, 150) }));
out('END ' + await ev(() => window.photo?.line?.()));
out('BENCHLABEL ' + await ev(() => document.getElementById('bench')?.textContent));
try { await page.screenshot({ path: `${tag}.png`, timeout: 240000 }); out('shot'); } catch { out('shot fail'); }
await b.close(); out('done');
