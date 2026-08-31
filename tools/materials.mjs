#!/usr/bin/env node
/**
 * The material library — 27 procedural PBR sets.
 *
 *   npm run gentex            build every material
 *   npm run gentex -- brick_red asphalt   build only these
 *
 * Each material is a height field plus a shading function. Normal, cavity AO
 * and much of the albedo variation fall out of the height, which is why mortar
 * is recessed, darker and rougher without being specified three times.
 *
 * Colours are authored in LINEAR and encoded on write. They are darker than
 * they look as swatches on purpose: ACES tone mapping plus a bright sky washes
 * pale albedo to near-white, and the first pass of vegetation proved it.
 *
 * `tile` is metres per texture tile. The mesh builder emits UVs in metres, so
 * this is the only place tiling is decided — nothing sets `repeat` anywhere.
 */
import { fbm, value, ridge, cell, bond, grid, clamp, raster, writePng } from './lib/texture.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/textures');

/* Grime that runs downward from a feature. Every real facade has it and its
 * absence is what makes a generated city look printed rather than weathered. */
const streak = (u, v, seed = 0, scale = 24) =>
  clamp(fbm(u * scale, v * 1.6, 16, 4, seed) * 1.15 - 0.1);

const mix = (a, b, t) => a + (b - a) * clamp(t);
const tint = (base, k) => ({ r: base[0] * k, g: base[1] * k, b: base[2] * k });

export const MATERIALS = {

  /* ------------------------------------------------------------- masonry -- */

  brick_red: {
    tile: 1.0, relief: 1.5,
    height: (u, v) => {
      const b = bond(u, v, 13, 4.4, 0.055);
      const face = 1 - b.joint;
      return 0.35 + face * 0.5 + fbm(u, v, 64, 3) * 0.09 * face + b.id * 0.05 * face;
    },
    shade: (u, v, h) => {
      const b = bond(u, v, 13, 4.4, 0.055);
      // per-brick colour spread is what stops brick reading as wallpaper
      const k = 0.72 + b.id * 0.55;
      const brick = [0.115 * k, 0.055 * k * 0.95, 0.040 * k];
      const grain = fbm(u, v, 96, 3, 7) * 0.02;
      const mortar = 0.16 + value(u, v, 48, 3) * 0.05;
      const s = streak(u, v, 3) * 0.10;
      const c = b.joint > 0.5
        ? { r: mortar, g: mortar * 0.99, b: mortar * 0.96 }
        : { r: brick[0] + grain, g: brick[1] + grain, b: brick[2] + grain };
      return { r: c.r * (1 - s), g: c.g * (1 - s), b: c.b * (1 - s),
               rough: b.joint > 0.5 ? 0.96 : 0.84 - b.id * 0.06 };
    },
  },

  brick_painted: {
    tile: 1.0, relief: 0.8,
    height: (u, v) => {
      const b = bond(u, v, 13, 4.4, 0.05);
      return 0.45 + (1 - b.joint) * 0.35 + fbm(u, v, 48, 3) * 0.06;
    },
    shade: (u, v, h) => {
      const b = bond(u, v, 13, 4.4, 0.05);
      // paint blown off in patches, showing the brick beneath
      const blown = clamp(fbm(u, v, 7, 4, 21) * 1.9 - 0.95);
      const paint = 0.30 + value(u, v, 24, 2) * 0.04;
      const under = 0.10 + b.id * 0.05;
      const c = mix(paint, under, blown);
      const s = streak(u, v, 11) * 0.14;
      return { r: c * (1 - s) * 1.0, g: c * (1 - s) * 0.97, b: c * (1 - s) * 0.92,
               rough: mix(0.72, 0.93, blown) };
    },
  },

  concrete_cast: {
    tile: 2.0, relief: 0.7,
    height: (u, v) => {
      // shutter board lines plus tie holes: cast concrete records its formwork
      const board = Math.abs(((v * 8) % 1) - 0.5) < 0.03 ? 0.12 : 0;
      const tie = cell(u, v, 3, 41).f1 < 0.14 ? -0.3 : 0;
      return 0.6 + fbm(u, v, 24, 4) * 0.16 - board + tie;
    },
    shade: (u, v, h) => {
      const base = 0.155 + fbm(u, v, 20, 4, 5) * 0.055;
      const s = streak(u, v, 2, 18) * 0.22;
      const c = base * (1 - s) + 0.006;
      return { r: c, g: c * 0.995, b: c * 0.97, rough: 0.88 + fbm(u, v, 40, 2, 9) * 0.09 };
    },
  },

  concrete_precast: {
    tile: 2.4, relief: 0.5,
    height: (u, v) => {
      const g = grid(u, v, 2, 3, 0.012);
      return 0.65 - g.joint * 0.35 + fbm(u, v, 32, 3) * 0.08;
    },
    shade: (u, v, h) => {
      const g = grid(u, v, 2, 3, 0.012);
      const base = 0.215 + g.id * 0.02 + fbm(u, v, 28, 3, 13) * 0.035;
      const s = streak(u, v, 6, 20) * 0.16;
      const c = base * (1 - s);
      return { r: c, g: c * 0.99, b: c * 0.96, rough: 0.8 + g.joint * 0.12 };
    },
  },

  plaster_worn: {
    tile: 2.0, relief: 0.9,
    height: (u, v) => {
      const blown = clamp(fbm(u, v, 6, 4, 33) * 1.8 - 0.86);
      return 0.68 - blown * 0.45 + fbm(u, v, 40, 3) * 0.1;
    },
    shade: (u, v, h) => {
      const blown = clamp(fbm(u, v, 6, 4, 33) * 1.8 - 0.86);
      const face = 0.255 + fbm(u, v, 22, 3, 4) * 0.045;
      const sub = 0.115;
      const c = mix(face, sub, blown);
      const s = streak(u, v, 8, 16) * 0.24;
      return { r: c * (1 - s) * 1.02, g: c * (1 - s) * 0.99, b: c * (1 - s) * 0.93,
               rough: mix(0.86, 0.95, blown) };
    },
  },

  stone_dressed: {
    tile: 1.5, relief: 1.1,
    height: (u, v) => {
      const b = bond(u, v, 5, 2.2, 0.03);
      // tooled face: fine chisel ridges across each block
      const tooled = ridge(u * 3, v * 40, 32, 2, 91) * 0.08;
      return 0.4 + (1 - b.joint) * (0.5 + tooled) + b.id * 0.04;
    },
    shade: (u, v, h) => {
      const b = bond(u, v, 5, 2.2, 0.03);
      const k = 0.86 + b.id * 0.28;
      const base = (0.215 + fbm(u, v, 60, 3, 15) * 0.03) * k;
      const s = streak(u, v, 5, 14) * 0.18;
      const c = b.joint > 0.5 ? 0.14 : base * (1 - s);
      return { r: c * 1.0, g: c * 0.985, b: c * 0.945, rough: b.joint > 0.5 ? 0.95 : 0.82 };
    },
  },

  kerb_stone: {
    tile: 1.0, relief: 0.8,
    height: (u, v) => 0.6 + fbm(u, v, 80, 3) * 0.2 + (cell(u, v, 20, 3).f1 < 0.2 ? 0.1 : 0),
    shade: (u, v) => {
      // granite: light matrix with dark and pale mineral flecks
      const c1 = cell(u, v, 26, 3), c2 = cell(u, v, 40, 77);
      let g = 0.20 + fbm(u, v, 60, 3, 2) * 0.05;
      if (c1.f1 < 0.22) g *= 0.55 + c1.id * 0.3;
      if (c2.f1 < 0.16) g *= 1.5;
      return { r: g, g: g * 0.99, b: g * 0.97, rough: 0.78 + fbm(u, v, 90, 2) * 0.12 };
    },
  },

  pavement_slab: {
    tile: 1.8, relief: 0.9,
    height: (u, v) => {
      const g = grid(u, v, 3, 3, 0.016);
      return 0.62 - g.joint * 0.4 + fbm(u, v, 70, 3) * 0.12;
    },
    shade: (u, v) => {
      const g = grid(u, v, 3, 3, 0.016);
      const base = (0.185 + g.id * 0.035 + fbm(u, v, 64, 3, 6) * 0.03);
      const dirt = fbm(u, v, 12, 3, 19) * 0.16;
      const c = g.joint > 0.5 ? 0.085 : base * (1 - dirt);
      return { r: c, g: c * 0.995, b: c * 0.975, rough: 0.88 };
    },
  },

  /* --------------------------------------------------------------- roads -- */

  asphalt: {
    tile: 2.0, relief: 1.3,
    height: (u, v) => 0.55 + cell(u, v, 34, 11).f1 * 0.3 + fbm(u, v, 90, 3) * 0.15,
    shade: (u, v, h) => {
      const c = cell(u, v, 34, 11);
      // aggregate: a few stones catch the light, the binder does not
      const stone = c.f1 < 0.28 ? 0.05 + c.id * 0.09 : 0;
      const base = 0.030 + fbm(u, v, 40, 3, 8) * 0.012 + stone;
      const patch = fbm(u, v, 5, 3, 55) * 0.02;
      return { r: base + patch, g: base + patch, b: (base + patch) * 1.04, rough: 0.9 - stone * 0.9 };
    },
  },

  asphalt_wet: {
    tile: 2.0, relief: 0.9,
    height: (u, v) => 0.55 + cell(u, v, 34, 11).f1 * 0.22 + fbm(u, v, 90, 3) * 0.1,
    shade: (u, v) => {
      // standing water fills the low points, so roughness is where the height is
      const pool = clamp(fbm(u, v, 7, 4, 61) * 1.7 - 0.55);
      const c = cell(u, v, 34, 11);
      const base = 0.016 + fbm(u, v, 40, 3, 8) * 0.008 + (c.f1 < 0.28 ? 0.018 : 0);
      const d = base * mix(1, 0.55, pool);
      return { r: d, g: d * 1.01, b: d * 1.08, rough: mix(0.82, 0.09, pool) };
    },
  },

  /* --------------------------------------------------------------- metal -- */

  metal_painted: {
    tile: 1.0, relief: 0.5, metalness: 0,
    height: (u, v) => 0.7 + fbm(u, v, 100, 3) * 0.08 - (clamp(fbm(u, v, 26, 3, 71) * 2.2 - 1.5) * 0.35),
    shade: (u, v) => {
      const chip = clamp(fbm(u, v, 26, 3, 71) * 2.2 - 1.5);
      const paint = 0.075 + fbm(u, v, 60, 2, 3) * 0.012;
      const primer = 0.13;
      const c = mix(paint, primer, chip);
      return { r: c * 0.94, g: c, b: c * 1.06, rough: mix(0.42, 0.85, chip), metal: chip * 0.5 };
    },
  },

  metal_galv: {
    tile: 1.0, relief: 0.4, metalness: 1,
    height: (u, v) => 0.65 + cell(u, v, 9, 23).f1 * 0.25 + fbm(u, v, 80, 2) * 0.08,
    shade: (u, v) => {
      // spangle: the crystal pattern that only galvanised steel has
      const c = cell(u, v, 9, 23);
      const g = 0.44 + c.id * 0.16 + fbm(u, v, 70, 3, 12) * 0.05;
      const dull = fbm(u, v, 14, 3, 44) * 0.2;
      return { r: g, g: g * 1.0, b: g * 1.03, rough: clamp(0.34 + c.id * 0.18 + dull) };
    },
  },

  metal_rust: {
    tile: 1.0, relief: 1.2,
    height: (u, v) => {
      const r = clamp(fbm(u, v, 9, 4, 5) * 1.6 - 0.42);
      return 0.7 - r * 0.3 + fbm(u, v, 70, 3) * 0.14 * r;
    },
    shade: (u, v) => {
      const r = clamp(fbm(u, v, 9, 4, 5) * 1.6 - 0.42);
      const steel = 0.09;
      const rust = [0.115 + fbm(u, v, 40, 3, 2) * 0.05, 0.042, 0.018];
      const s = streak(u, v, 9, 20) * 0.5 * r;
      return {
        r: mix(steel, rust[0], clamp(r + s)),
        g: mix(steel * 0.98, rust[1], clamp(r + s)),
        b: mix(steel * 1.05, rust[2], clamp(r + s)),
        rough: mix(0.46, 0.95, r), metal: 1 - r * 0.75,
      };
    },
  },

  alloy_polished: {
    tile: 1.0, relief: 0.25, metalness: 1,
    height: (u, v) => 0.7 + value(u * 200, v, 128, 3) * 0.05,
    shade: (u, v) => {
      // brushed: fine anisotropy along one axis, faked as roughness streaks
      const brush = value(u * 240, v, 128, 3) * 0.1;
      const g = 0.60 + brush * 0.25;
      return { r: g, g: g * 1.0, b: g * 1.02, rough: clamp(0.22 + brush * 0.9) };
    },
  },

  chrome_trim: {
    tile: 1.0, relief: 0.15, metalness: 1,
    height: (u, v) => 0.75 + fbm(u, v, 120, 2) * 0.03,
    shade: (u, v) => {
      const g = 0.74 + fbm(u, v, 90, 2, 3) * 0.03;
      return { r: g, g: g, b: g * 1.01, rough: 0.07 + fbm(u, v, 60, 2, 17) * 0.05 };
    },
  },

  /* --------------------------------------------------------------- glass -- */

  glass_curtain: {
    tile: 1.5, relief: 0.3, metalness: 0,
    height: (u, v) => 0.7 + fbm(u, v, 6, 2) * 0.06,
    shade: (u, v) => {
      // float glass is not flat: the faint roll ripple is what sells a tower
      const ripple = fbm(u, v, 5, 2, 27) * 0.03;
      const dirt = clamp(fbm(u, v, 10, 3, 88) * 1.3 - 0.55) * 0.04;
      return { r: 0.020 + ripple * 0.4 + dirt, g: 0.028 + ripple * 0.5 + dirt,
               b: 0.038 + ripple * 0.6 + dirt, rough: 0.05 + dirt * 2.5 };
    },
  },

  glass_shop: {
    tile: 1.5, relief: 0.25,
    height: (u, v) => 0.72 + fbm(u, v, 6, 2, 3) * 0.05,
    shade: (u, v) => {
      const dirt = clamp(fbm(u, v, 12, 3, 4) * 1.3 - 0.6) * 0.05;
      const smear = streak(u, v, 15, 10) * 0.03;
      return { r: 0.036 + dirt + smear, g: 0.044 + dirt + smear, b: 0.055 + dirt + smear,
               rough: 0.045 + dirt * 3 + smear * 2 };
    },
  },

  car_glass: {
    tile: 1.0, relief: 0.1,
    height: () => 0.75,
    shade: () => ({ r: 0.014, g: 0.017, b: 0.022, rough: 0.035 }),
  },

  /* --------------------------------------------------------------- other -- */

  timber_bare: {
    tile: 1.0, relief: 1.0,
    height: (u, v) => {
      const boards = Math.abs(((u * 6) % 1) - 0.5) < 0.02 ? -0.28 : 0;
      const g = ridge(u * 2, v * 26, 24, 3, 5);
      return 0.62 + g * 0.2 + boards + fbm(u, v, 60, 3) * 0.06;
    },
    shade: (u, v) => {
      const board = Math.floor(u * 6);
      const k = 0.8 + ((board * 2654435761) % 1000) / 1000 * 0.45;
      const g = ridge(u * 2, v * 26, 24, 3, 5);
      const base = (0.085 + g * 0.05) * k;
      return { r: base * 1.14, g: base * 0.86, b: base * 0.58, rough: 0.86 - g * 0.1 };
    },
  },

  timber_painted: {
    tile: 1.0, relief: 0.7,
    height: (u, v) => {
      const boards = Math.abs(((u * 6) % 1) - 0.5) < 0.018 ? -0.25 : 0;
      return 0.68 + ridge(u * 2, v * 26, 24, 3, 5) * 0.09 + boards;
    },
    shade: (u, v) => {
      const flake = clamp(fbm(u, v, 16, 4, 62) * 1.9 - 1.1);
      const paint = 0.235 + fbm(u, v, 30, 2, 9) * 0.02;
      const wood = 0.085;
      const c = mix(paint, wood, flake);
      return { r: c * (flake > 0.4 ? 1.14 : 1.0), g: c * (flake > 0.4 ? 0.9 : 0.99),
               b: c * (flake > 0.4 ? 0.62 : 0.94), rough: mix(0.6, 0.9, flake) };
    },
  },

  fabric_awning: {
    tile: 1.0, relief: 0.9,
    height: (u, v) => 0.6 + Math.abs(Math.sin(u * Math.PI * 34)) * 0.1
                          + Math.abs(Math.sin(v * Math.PI * 34)) * 0.1,
    shade: (u, v) => {
      // woven stripe, faded unevenly by the sun
      const stripe = ((u * 8) % 1) < 0.5 ? 1 : 0.62;
      const fade = fbm(u, v, 6, 3, 31) * 0.22;
      const base = (0.16 + fbm(u, v, 90, 2, 3) * 0.02) * stripe * (1 - fade);
      return { r: base * 1.06, g: base * 0.97, b: base * 0.92, rough: 0.94 };
    },
  },

  plastic_signage: {
    tile: 1.0, relief: 0.2,
    height: (u, v) => 0.72 + fbm(u, v, 110, 2) * 0.04,
    shade: (u, v) => {
      const g = 0.30 + fbm(u, v, 40, 2, 6) * 0.015;
      const dirt = streak(u, v, 21, 12) * 0.12;
      return { r: g * (1 - dirt), g: g * (1 - dirt) * 0.99, b: g * (1 - dirt) * 0.97, rough: 0.36 };
    },
  },

  car_paint: {
    tile: 1.0, relief: 0.15,
    height: (u, v) => 0.75 + fbm(u, v, 140, 2) * 0.02,
    shade: (u, v) => {
      const flake = fbm(u, v, 180, 2, 4) * 0.02;
      const g = 0.10 + flake;
      return { r: g * 0.95, g: g, b: g * 1.12, rough: 0.14 + flake };
    },
  },

  tyre_rubber: {
    tile: 0.4, relief: 1.4,
    height: (u, v) => {
      const tread = Math.abs(((v * 7 + Math.sin(u * 9) * 0.3) % 1) - 0.5) < 0.24 ? 0.35 : 0;
      return 0.45 + tread + fbm(u, v, 70, 3) * 0.1;
    },
    shade: (u, v) => {
      const g = 0.020 + fbm(u, v, 50, 3, 11) * 0.008;
      return { r: g, g: g, b: g * 1.03, rough: 0.92 };
    },
  },

  /* ---------------------------------------------------------- vegetation -- */

  foliage: {
    tile: 0.8, relief: 1.6, aoStrength: 1.4,
    height: (u, v) => {
      const leaf = cell(u, v, 14, 9);
      return 0.4 + (1 - leaf.f1) * 0.5 + fbm(u, v, 40, 3) * 0.12;
    },
    shade: (u, v) => {
      const leaf = cell(u, v, 14, 9);
      const k = 0.6 + leaf.id * 0.9;
      const g = 0.14 * k;
      return { r: g * 0.72, g: g * 1.18, b: g * 0.52, rough: 0.8 };
    },
  },

  grass: {
    tile: 1.0, relief: 1.2, aoStrength: 1.2,
    height: (u, v) => 0.5 + ridge(u * 6, v * 30, 40, 3, 3) * 0.35 + fbm(u, v, 30, 3) * 0.1,
    shade: (u, v) => {
      const blade = ridge(u * 6, v * 30, 40, 3, 3);
      const patch = fbm(u, v, 8, 3, 51);
      const g = (0.115 + blade * 0.07) * (0.72 + patch * 0.6);
      return { r: g * 0.76, g: g * 1.2, b: g * 0.5, rough: 0.88 };
    },
  },


  /* ------------------------------------------------------------ character -- */

  skin: {
    tile: 0.6, relief: 0.55, aoStrength: 0.6,
    height: (u, v) => 0.7 + cell(u, v, 60, 31).f1 * 0.12 + fbm(u, v, 120, 3) * 0.08,
    shade: (u, v) => {
      // pore break-up plus a slow blotch, so skin is not one flat value
      const pore = cell(u, v, 60, 31).f1;
      const blotch = fbm(u, v, 7, 3, 19);
      const k = 0.9 + blotch * 0.2 + pore * 0.06;
      return { r: 0.230 * k, g: 0.140 * k, b: 0.104 * k, rough: 0.62 + pore * 0.12 };
    },
  },

  hair: {
    tile: 0.35, relief: 1.7, aoStrength: 1.3,
    height: (u, v) => 0.4 + ridge(u * 3, v * 34, 40, 3, 23) * 0.5 + fbm(u, v, 70, 3) * 0.1,
    shade: (u, v, h) => {
      const strand = ridge(u * 3, v * 34, 40, 3, 23);
      const g = 0.020 + strand * 0.035 + fbm(u, v, 10, 3, 44) * 0.012;
      return { r: g * 1.15, g: g * 0.9, b: g * 0.7, rough: 0.42 + (1 - strand) * 0.3 };
    },
  },

  cloth_shirt: {
    tile: 0.5, relief: 1.0, aoStrength: 1.1,
    height: (u, v) => 0.55 + Math.abs(Math.sin(u * Math.PI * 9)) * 0.1
                           + Math.abs(Math.sin(v * Math.PI * 9)) * 0.1
                           + fbm(u, v, 12, 3) * 0.16,
    shade: (u, v) => {
      const weave = (Math.sin(u * Math.PI * 9) * Math.sin(v * Math.PI * 9)) * 0.5 + 0.5;
      const fold = fbm(u, v, 9, 3, 66);
      const g = (0.115 + weave * 0.03) * (0.82 + fold * 0.36);
      return { r: g * 0.93, g: g * 0.99, b: g * 1.14, rough: 0.9 };
    },
  },

  cloth_trouser: {
    tile: 0.5, relief: 1.1, aoStrength: 1.1,
    height: (u, v) => 0.55 + ridge(u * 14, v * 14, 32, 2, 12) * 0.2 + fbm(u, v, 10, 3) * 0.16,
    shade: (u, v) => {
      // denim twill: a diagonal weave, and it must read at 2 m not 20 cm
      const twill = ridge((u + v) * 12, (u - v) * 12, 32, 2, 12);
      const fade = fbm(u, v, 8, 3, 77);
      const g = (0.055 + twill * 0.022) * (0.8 + fade * 0.45);
      return { r: g * 0.82, g: g * 0.92, b: g * 1.3, rough: 0.92 };
    },
  },

  shoe_leather: {
    tile: 0.3, relief: 0.9, aoStrength: 1.0,
    height: (u, v) => 0.6 + cell(u, v, 34, 55).f1 * 0.25 + fbm(u, v, 90, 3) * 0.1,
    shade: (u, v) => {
      const grain = cell(u, v, 34, 55).f1;
      const scuff = clamp(fbm(u, v, 11, 3, 91) * 1.6 - 0.7);
      const g = (0.030 + grain * 0.018) * (1 - scuff * 0.3);
      return { r: g * 1.12, g: g * 0.96, b: g * 0.86, rough: mix(0.45, 0.85, scuff) + grain * 0.1 };
    },
  },

  bark: {
    tile: 0.6, relief: 1.8, aoStrength: 1.3,
    height: (u, v) => {
      // deep vertical fissures — bark is a height field before it is a colour
      const fis = ridge(u * 5, v * 1.4, 20, 4, 13);
      return 0.35 + fis * 0.55 + fbm(u, v, 60, 3) * 0.1;
    },
    shade: (u, v, h) => {
      const g = 0.055 + h * 0.075;
      return { r: g * 1.1, g: g * 0.95, b: g * 0.78, rough: 0.93 };
    },
  },
};

/* ------------------------------------------------------------------ main -- */

async function main() {
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));
  const entries = Object.entries(MATERIALS).filter(([n]) => !only.size || only.has(n));
  const library = { version: 1, generated: new Date().toISOString(), materials: {} };

  for (const [name, spec] of entries) {
    const t0 = Date.now();
    const { albedo, orm, normal, size } = raster(spec);
    await writePng(OUT, `${name}_albedo.png`, albedo, size);
    await writePng(OUT, `${name}_orm.png`, orm, size);
    await writePng(OUT, `${name}_normal.png`, normal, size);
    library.materials[name] = {
      albedo: `/textures/${name}_albedo.png`,
      orm: `/textures/${name}_orm.png`,
      normal: `/textures/${name}_normal.png`,
      tile: spec.tile,
      metalness: spec.metalness ?? null,   // null = take it from the ORM blue channel
      normalScale: spec.normalScale ?? 1,
    };
    console.log(`${name.padEnd(20)} ${size}px  ${Date.now() - t0}ms`);
  }

  // merge rather than replace, so building one material does not drop the rest
  const libPath = path.join(OUT, 'library.json');
  let existing = {};
  try { existing = JSON.parse(await (await import('node:fs/promises')).readFile(libPath, 'utf8')).materials ?? {}; }
  catch { /* first run */ }
  library.materials = { ...existing, ...library.materials };
  await mkdir(OUT, { recursive: true });
  await writeFile(libPath, JSON.stringify(library, null, 2) + '\n');
  console.log(`\n${Object.keys(library.materials).length} materials -> ${path.relative(ROOT, OUT)}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
