// Renders the film frame by frame in headless Chromium and pipes the frames to ffmpeg.
//
//   node tools/render.mjs                    -> out/flight1549-video.mp4 (no sound)
//   node tools/render.mjs --stills 3,30,72   -> out/still-*.png (quick look)
//   node tools/render.mjs --from 60 --to 70  -> a slice, for iterating on one shot
//
// The page exposes window.renderFrame(i); every frame is a pure function of i,
// so a slice renders exactly as it does in the full film.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html?render`;

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => { console.error('[page error]', e.message); process.exitCode = 1; });
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.ready === true, null, { timeout: 600000 });
console.log(`scene built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const { DURATION, FPS } = await page.evaluate(() => ({ DURATION: window.DURATION, FPS: window.FPS }));

const stills = opt('stills');
if (stills) {
  for (const s of stills.split(',').map(Number)) {
    const i = Math.round(s * FPS);
    const info = await page.evaluate((i) => window.renderFrame(i), i);
    const f = path.join(OUT, `still-${String(s).replace('.', '_')}.png`);
    await page.screenshot({ path: f });
    console.log(`still ${s}s (${info.shot}, ft ${info.ft.toFixed(1)}) -> ${path.relative(ROOT, f)}`);
  }
} else {
  const from = Math.round(parseFloat(opt('from', '0')) * FPS);
  const to = Math.round(parseFloat(opt('to', String(DURATION))) * FPS);
  const file = path.join(OUT, opt('out', from === 0 && to === Math.round(DURATION * FPS) ? 'flight1549-video.mp4' : `slice-${from}-${to}.mp4`));
  const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '19'), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const tStart = Date.now();
  for (let i = from; i < to; i++) {
    await page.evaluate((i) => window.renderFrame(i), i);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((i - from) % 60 === 0) {
      const done = i - from + 1, rate = (Date.now() - tStart) / done;
      console.log(`frame ${i}/${to} · ${(rate / 1000).toFixed(2)} s/frame · eta ${((to - i) * rate / 60000).toFixed(1)} min`);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`wrote ${path.relative(ROOT, file)}`);
}
await browser.close();
server.close();
