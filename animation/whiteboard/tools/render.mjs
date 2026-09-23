// Renders the whiteboard story frame by frame (canvas pixels straight out of the
// page) into ffmpeg, then muxes the synthesised soundtrack if it exists.
//   node tools/render.mjs              -> out/whiteboard-1549.mp4
//   node tools/render.mjs --stills 3,15 -> out/still-*.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => { console.error('[page error]', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?render`);
await page.waitForFunction(() => window.ready === true);
const { DURATION, FPS } = await page.evaluate(() => ({ DURATION: window.DURATION, FPS: window.FPS }));
const grab = (i, type) => page.evaluate(([i, type]) => { window.renderFrame(i); return document.getElementById('c').toDataURL(type, 0.93); }, [i, type]);

if (opt('stills')) {
  for (const s of opt('stills').split(',').map(Number)) {
    const url = await grab(Math.round(s * FPS), 'image/png');
    fs.writeFileSync(path.join(OUT, `still-${s}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('stills written');
} else {
  const video = path.join(OUT, 'whiteboard-1549-video.mp4');
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', video], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round(DURATION * FPS);
  for (let i = 0; i < N; i++) {
    const url = await grab(i, 'image/jpeg');
    if (!ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`frame ${i}/${N}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  const wav = path.join(OUT, 'whiteboard-1549.wav'), mp4 = path.join(OUT, 'whiteboard-1549.mp4');
  if (fs.existsSync(wav)) {
    spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    console.log(`wrote ${path.relative(ROOT, mp4)}`);
  } else console.log(`wrote ${path.relative(ROOT, video)} (no soundtrack found)`);
}
await browser.close();
server.close();
