// Renders critter.html into looping transparent GIFs.
import { chromium } from '../whiteboard/node_modules/playwright-core/index.mjs';
import ffmpeg from '../whiteboard/node_modules/ffmpeg-static/index.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
await p.goto('file://' + path.join(dir, 'critter.html'));
async function frames(mode, n, w, h) {
  const d = path.join(dir, 'frames'); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d);
  await p.evaluate(([w, h]) => { const c = document.getElementById('c'); c.width = w; c.height = h; }, [w, h]);
  for (let i = 0; i < n; i++) {
    const url = await p.evaluate(([m, t]) => { window.draw(m, t); return document.getElementById('c').toDataURL('image/png'); }, [mode, i / n]);
    fs.writeFileSync(path.join(d, `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  return d;
}
function gif(d, out, scale) {
  // Pixel art: nearest-neighbour scaling keeps the cells crisp.
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '24', '-i', path.join(d, 'f%03d.png'),
    '-filter_complex', `scale=${scale}:flags=neighbor,split[a][b];[a]palettegen=reserve_transparent=1:max_colors=32[p];[b][p]paletteuse=dither=none:alpha_threshold=100`,
    '-loop', '0', path.join(dir, out)], { stdio: 'inherit' });
  if (r.status) process.exit(1);
}
let d = await frames('place', 24, 512, 512);
gif(d, 'critter-run-128.gif', '128:128'); gif(d, 'critter-run-512.gif', '512:512');
d = await frames('around', 96, 1024, 384);
gif(d, 'critter-around.gif', '640:240');
fs.rmSync(d, { recursive: true });
await b.close();
console.log('done');
