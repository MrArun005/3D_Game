// Frame-exact recording of the running game, for machines without a usable GPU (CI, cloud containers).
//   npx vite build && npx vite preview --port 4173 &   then
//   FFMPEG=/path/to/ffmpeg node tools/record-virtual.mjs out.mp4
// env: W H (viewport, 1280x720)  FPS (24)  SECONDS (63: the feature tour)  URL (http://localhost:4173/)
//      Q (query, ?debug&nodrs&quality=balanced&webgl)  HOUR (clock)  PRE (unrecorded lead-in frames)
//      PLAYWRIGHT (module path, default 'playwright')  FFMPEG (needs libx264: pip install imageio-ffmpeg has one)
// The page's clock is virtual (performance.now, rAF, timers): each frame advances exactly 1/FPS, however long
// the software renderer takes to draw it; every frame is screenshotted and piped into x264.
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const out = process.argv[2] || 'tour.mp4';
const W = +(process.env.W || 1280), H = +(process.env.H || 720), FPS = +(process.env.FPS || 24), SECONDS = +(process.env.SECONDS || 63);
const FF = process.env.FFMPEG || 'ffmpeg';
const b = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error') logs.push(`[error] ${m.text()}`.slice(0, 240)); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 240)));
await page.addInitScript(() => {
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  let virtual = false, vt = 0, drift = 0, nextId = 1e9;
  const rafQ = [], timers = new Map();
  performance.now = function () { if (!virtual) return realNow(); drift = Math.min(drift + 0.0002, 12); return vt + drift; };
  window.requestAnimationFrame = function (cb) { if (!virtual) return realRaf(cb); rafQ.push(cb); return rafQ.length; };
  window.setTimeout = function (cb, ms = 0, ...a) { if (!virtual || typeof cb !== 'function') return realST(cb, ms, ...a); const id = nextId++; timers.set(id, { due: vt + Math.max(0, +ms || 0), cb, a }); return id; };
  window.clearTimeout = function (id) { if (!timers.delete(id)) realCT(id); };
  window.setInterval = function (cb, ms = 0, ...a) { if (!virtual || typeof cb !== 'function') return realSI(cb, ms, ...a); const id = nextId++, every = Math.max(1, +ms || 1); timers.set(id, { due: vt + every, cb, a, every }); return id; };
  window.clearInterval = function (id) { if (!timers.delete(id)) realCI(id); };
  window.MediaRecorder = undefined;          // the tour's own canvas recorder: frames come from here instead
  window.__goVirtual = () => { vt = realNow(); drift = 0; virtual = true; };
  window.__step = (ms) => {
    vt += ms; drift = 0;
    for (const [id, t] of [...timers]) if (t.due <= vt) { if (t.every) t.due += t.every; else timers.delete(id); try { t.cb(...t.a); } catch (e) { console.error('timer: ' + e.message); } }
    const cbs = rafQ.splice(0);
    for (const cb of cbs) { try { cb(vt); } catch (e) { console.error('raf: ' + e.message); } }
    return cbs.length;
  };
});
const base = process.env.URL || 'http://localhost:4173/';
const q = process.env.Q || '?debug&nodrs&quality=balanced&webgl';
const t0 = Date.now();
const say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);
await page.goto(base + q, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 900000 }).catch(() => say('boot overlay never cleared'));
say('booted');
await page.waitForFunction(() => (window._world?.chunks?.size ?? 0) >= 9, null, { timeout: 1500000, polling: 2000 }).catch(() => say('chunks never 9'));
say(`chunks ready (${await page.evaluate(() => window._world?.chunks?.size)})`);
if (process.env.HOUR) await page.evaluate((h) => window.__time?.(+h), process.env.HOUR);
await page.evaluate(() => { window.__goVirtual(); window.startFeatureTour(); });
// a few unrecorded frames: the tour's first warp lands and its overlay builds
const PRE = +(process.env.PRE || 6);
for (let i = 0; i < PRE; i++) await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
const N = Math.round(SECONDS * FPS);
const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const stills = process.env.STILLS || 'rec-frames';
fs.mkdirSync(stills, { recursive: true });
const tRec = Date.now();
for (let i = 0; i < N; i++) {
  await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 90, timeout: 600000 });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 30 === 0) fs.writeFileSync(`${stills}/f${String(i).padStart(5, '0')}.jpg`, jpg);   // a still a second-ish, for checking
  if (i % 15 === 0 || i === N - 1) {
    const per = (Date.now() - tRec) / (i + 1);
    const stage = await page.evaluate(() => { const t = window.featureTour; return t?.active ? `${t.stages[t.stageIdx]?.id} ${t.stageTime.toFixed(1)}s` : 'tour off'; });
    say(`frame ${i + 1}/${N}  ${(per / 1000).toFixed(1)} s/frame  ETA ${((N - i - 1) * per / 60000).toFixed(0)} min  | ${stage}`);
  }
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
say(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
console.log(logs.slice(0, 15).join('\n'));
await b.close();
