// Renders spark.html to a looping transparent GIF: spark-128.gif, spark-256.gif, spark-512.gif.
import { chromium } from '../hudson-1549/node_modules/playwright-core/index.mjs';
import ffmpeg from '../hudson-1549/node_modules/ffmpeg-static/index.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const F = 36;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.goto('file://' + path.join(dir, 'spark.html'));
fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
for (let i = 0; i < F; i++) {
  // Read the canvas's own pixels: page screenshots darken semi-transparent edges.
  const url = await p.evaluate((t) => { window.draw(t); return document.getElementById('c').toDataURL('image/png'); }, i / F);
  fs.writeFileSync(path.join(dir, 'frames', `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
}
await b.close();
for (const s of [128, 256, 512]) {
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, 'frames', 'f%03d.png'),
    '-filter_complex', `scale=${s}:${s}:flags=area,split[a][b];[a]palettegen=reserve_transparent=1:max_colors=64[p];[b][p]paletteuse=alpha_threshold=128`,
    '-loop', '0', path.join(dir, `spark-${s}.gif`)], { stdio: 'inherit' });
  if (r.status) process.exit(1);
}
fs.rmSync(path.join(dir, 'frames'), { recursive: true });
console.log('done');
