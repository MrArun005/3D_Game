// Library textures -> KTX2 (2026-09-25). The GPU samples these compressed
// (BC7/ASTC/ETC after transcoding), so each 512^2 map is ~0.25 MB of VRAM
// instead of 1 MB, and the download shrinks too. Colour maps are ETC1S
// (small, sRGB); normal and ORM maps are UASTC (data maps need the quality).
// Writes public/textures/ktx2/<name>.ktx2 beside the PNGs, which stay as the
// fallback. Needs toktx (KTX-Software 4.3). Usage: node tools/ktx2-textures.mjs
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
const lib = JSON.parse(readFileSync('public/textures/library.json', 'utf8'));
mkdirSync('public/textures/ktx2', { recursive: true });
let png = 0, ktx = 0, n = 0;
for (const def of Object.values(lib.materials)) {
  for (const [slot, url] of Object.entries({ albedo: def.albedo, normal: def.normal, orm: def.orm })) {
    if (!url) continue;
    const src = 'public' + url, out = `public/textures/ktx2/${basename(url, '.png')}.ktx2`;
    if (!existsSync(src) || existsSync(out)) continue;
    const args = slot === 'albedo'
      ? ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '200', '--genmipmap', '--lower_left_maps_to_s0t0', '--assign_oetf', 'srgb', '--target_type', 'RGB']
      : ['--t2', '--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18', '--genmipmap', '--lower_left_maps_to_s0t0', '--assign_oetf', 'linear', '--target_type', 'RGB'];
    execFileSync('toktx', [...args, out, src]);
    png += statSync(src).size; ktx += statSync(out).size; n++;
  }
}
console.log(`${n} textures: ${(png / 1e6).toFixed(1)} MB png -> ${(ktx / 1e6).toFixed(1)} MB ktx2`);
