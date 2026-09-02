#!/usr/bin/env node
/**
 * framediff — how different are two PNG screenshots?
 *
 *   node tools/framediff.mjs a.png b.png [threshold=24]
 *
 * Prints the fraction of pixels whose max channel delta exceeds the
 * threshold, plus a coarse 12x8 heat grid so you can see WHERE they differ.
 * Written for the render-bundle work: a stale bundle draws objects that are
 * not in the scene graph, so "frame as rendered" vs "frame after forcing
 * every bundle to re-record" differ wherever a ghost stood. Zero deps: a
 * minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) over node:zlib.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function png(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || !(ctype === 2 || ctype === 6)) throw new Error(`${path}: unsupported PNG (depth ${depth}, type ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++]; const row = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, b = y > 0 ? out[prev + x] : 0, c = (x >= bpp && y > 0) ? out[prev + x - bpp] : 0;
      let v = raw[p++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[row + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

const [a, b, thr = '24'] = process.argv.slice(2);
if (!a || !b) { console.error('usage: framediff a.png b.png [threshold]'); process.exit(2); }
const A = png(a), B = png(b);
if (A.w !== B.w || A.h !== B.h) { console.error(`size mismatch ${A.w}x${A.h} vs ${B.w}x${B.h}`); process.exit(2); }
const T = +thr, GX = 12, GY = 8, grid = new Float64Array(GX * GY), cells = new Float64Array(GX * GY);
let diff = 0;
for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
  const i = (y * A.w + x) * A.bpp, j = (y * B.w + x) * B.bpp;
  const d = Math.max(Math.abs(A.data[i] - B.data[j]), Math.abs(A.data[i + 1] - B.data[j + 1]), Math.abs(A.data[i + 2] - B.data[j + 2]));
  const g = Math.floor(y / A.h * GY) * GX + Math.floor(x / A.w * GX); cells[g]++;
  if (d > T) { diff++; grid[g]++; }
}
const frac = diff / (A.w * A.h);
console.log(`${a} vs ${b}: ${(frac * 100).toFixed(2)}% of pixels differ by > ${T} (${A.w}x${A.h})`);
const glyph = (r) => r > 0.5 ? '#' : r > 0.2 ? '+' : r > 0.05 ? '.' : ' ';
for (let gy = 0; gy < GY; gy++) console.log('  |' + Array.from({ length: GX }, (_, gx) => glyph(grid[gy * GX + gx] / cells[gy * GX + gx])).join('') + '|');
process.exit(frac > 0.002 ? 1 : 0);   // exit 1 = frames differ meaningfully
