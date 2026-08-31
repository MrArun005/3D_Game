/**
 * Procedural PBR texture generation.
 *
 * Every material is authored as a HEIGHT FIELD plus a shading function. The
 * normal map, the cavity AO and most of the albedo variation all fall out of
 * that one height field, which is why brick mortar is simultaneously recessed,
 * darker, and rougher without any of those being specified three times.
 *
 * Textures tile in METRES. The mesh builder emits UVs in metres (1 UV unit =
 * 1 m), so a material authored at `tile: 1` needs no repeat setting anywhere —
 * a bin and a wall sampling the same concrete show the same grain size, which
 * is the whole point of the planar UV projection.
 *
 * Output is albedo (sRGB) + normal (linear) + ORM (occlusion / roughness /
 * metalness packed into R / G / B, the glTF convention — three channels, one
 * sampler, one upload).
 */
import { PNG } from 'pngjs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/* ----------------------------------------------------------------- noise -- */

const hash2 = (x, y, seed = 0) => {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
};

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

/**
 * Albedo is authored in LINEAR and encoded to sRGB on write, because the
 * renderer linearises the sRGB texture on sample. Author in the space you
 * reason about; store in the space the format expects.
 */
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Tiling value noise. `period` is the lattice size, so the result wraps. */
export function value(x, y, period, seed = 0) {
  const fx = x * period, fy = y * period;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = smooth(fx - ix), ty = smooth(fy - iy);
  const w = (a, b) => hash2(((a % period) + period) % period, ((b % period) + period) % period, seed);
  return lerp(lerp(w(ix, iy), w(ix + 1, iy), tx), lerp(w(ix, iy + 1), w(ix + 1, iy + 1), tx), ty);
}

/** Tiling fractal noise. Octaves double the lattice, so it still wraps. */
export function fbm(x, y, period, octaves = 4, seed = 0, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += value(x, y, p, seed + o * 131) * amp;
    norm += amp; amp *= gain; p *= 2;
  }
  return sum / norm;
}

/** Ridged noise — veins, cracks, grain. */
export const ridge = (x, y, period, octaves = 3, seed = 0) =>
  1 - Math.abs(fbm(x, y, period, octaves, seed) * 2 - 1);

/** Tiling Worley/cellular. Returns { f1, id } — distance and cell identity. */
export function cell(x, y, period, seed = 0) {
  const fx = x * period, fy = y * period;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let best = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    const wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
    const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 977);
    const d = Math.hypot(px - fx, py - fy);
    if (d < best) { best = d; id = hash2(wx, wy, seed + 5501); }
  }
  return { f1: Math.min(1, best), id };
}

/** Running-bond course lookup. Returns the brick's local uv, id and mortar mask. */
export function bond(u, v, courses, perCourse, mortar) {
  const row = Math.floor(v * courses);
  const offset = (row % 2) * 0.5;
  const cu = (u * perCourse + offset * 1) % 1 * 1;
  const su = ((u + offset / perCourse) * perCourse) % 1;
  const sv = v * courses - row;
  const mu = Math.min(su, 1 - su), mv = Math.min(sv, 1 - sv);
  const mx = mortar * perCourse * 0.5, my = mortar * courses * 0.5;
  const joint = 1 - clamp(Math.min(mu / mx, mv / my), 0, 1);
  return {
    su, sv, joint,
    id: hash2(Math.floor((u + offset / perCourse) * perCourse), row, 17),
  };
}

/** Square grid — slabs, panels, tiles. */
export function grid(u, v, nx, ny, jointW) {
  const su = (u * nx) % 1, sv = (v * ny) % 1;
  const mu = Math.min(su, 1 - su), mv = Math.min(sv, 1 - sv);
  const joint = 1 - clamp(Math.min(mu / (jointW * nx * 0.5), mv / (jointW * ny * 0.5)), 0, 1);
  return { su, sv, joint, id: hash2(Math.floor(u * nx), Math.floor(v * ny), 71) };
}

/* ------------------------------------------------------------- rasterise -- */

const SIZE = 512;

/**
 * Rasterise one material.
 *
 * `shade(u, v, h)` returns { r, g, b, rough } in 0..1. It is called after the
 * height pass, so it can use the height it is standing on — which is how the
 * mortar in a joint gets darker and rougher for free.
 */
export function raster(spec, size = SIZE) {
  const N = size * size;
  const H = new Float32Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    H[y * size + x] = clamp(spec.height((x + 0.5) / size, (y + 0.5) / size));
  }

  const albedo = new Uint8Array(N * 4);
  const orm = new Uint8Array(N * 4);
  const normal = new Uint8Array(N * 4);

  // cavity AO: height against a blurred copy of itself. Cheap, and it reads
  // correctly for the small-scale detail a normal map alone cannot shadow.
  const B = blur(H, size, Math.max(2, Math.round(size / 64)));
  const strength = spec.aoStrength ?? 1.0;

  const at = (x, y) => H[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const relief = spec.relief ?? 1.0;

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    const h = H[i];
    const s = spec.shade(u, v, h);

    albedo[i * 4] = Math.round(srgb(clamp(s.r)) * 255);
    albedo[i * 4 + 1] = Math.round(srgb(clamp(s.g)) * 255);
    albedo[i * 4 + 2] = Math.round(srgb(clamp(s.b)) * 255);
    albedo[i * 4 + 3] = 255;

    const ao = clamp(1 - clamp((B[i] - h) * 3.2 * strength, 0, 1) * 0.85, 0.15, 1);
    orm[i * 4] = Math.round(ao * 255);
    orm[i * 4 + 1] = Math.round(clamp(s.rough) * 255);
    orm[i * 4 + 2] = Math.round(clamp(s.metal ?? spec.metalness ?? 0) * 255);
    orm[i * 4 + 3] = 255;

    // Sobel on the height field. Tangent-space normal, +Y up (glTF/OpenGL).
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
             - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
             - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * size * 0.02 * relief, ny = -dy * size * 0.02 * relief, nz = 1;
    const l = Math.hypot(nx, ny, nz) || 1;
    normal[i * 4] = Math.round((nx / l * 0.5 + 0.5) * 255);
    normal[i * 4 + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
    normal[i * 4 + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
    normal[i * 4 + 3] = 255;
  }
  return { albedo, orm, normal, size };
}

/** Separable box blur, wrapping — the texture has to keep tiling. */
function blur(src, size, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = r * 2 + 1;
  for (let y = 0; y < size; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * size + ((k % size) + size) % size];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = sum / w;
      sum -= src[y * size + (((x - r) % size) + size) % size];
      sum += src[y * size + (((x + r + 1) % size) + size) % size];
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[((((k % size) + size) % size)) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / w;
      sum -= tmp[(((y - r) % size) + size) % size * size + x];
      sum += tmp[(((y + r + 1) % size) + size) % size * size + x];
    }
  }
  return out;
}

export async function writePng(dir, name, data, size) {
  await mkdir(dir, { recursive: true });
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  await writeFile(path.join(dir, name), PNG.sync.write(png, { deflateLevel: 9 }));
}
