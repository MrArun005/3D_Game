import * as THREE from 'three';
import { texture, uv, attribute, vec2, vec3, materialReference, float, mix, step, smoothstep, sin, fract, time, uniform } from 'three/tsl';
import { cv, toTex } from './textures.js';
import { mulberry32 } from '../core/rng.js';

/**
 * Shop signs: Phase 1 of the "Light the City" plan.
 *
 * One seeded atlas of fascia boards, one node material, one quad. Every
 * downtown ground-floor module gets a board 0.14m proud of the wall with a
 * per-instance atlas cell, so a chunk's worth of signs is one instanced draw
 * (districtWorld builds it next to the facade batch). Brand-free names built
 * from the district's own street and family names; the same board on the same
 * shop on every reload, because the cell is a hash of the module's position.
 *
 * Tile is 512x128 -- 4.5:1, the shape of a fascia. That is 142 texels per
 * metre on a 3.6m board, chosen after the 256px tile in the plan measured as
 * mush at three metres. 4 columns x 16 rows = 64 boards in 2048^2, 16MB.
 */
export const SIGN_COLS = 4, SIGN_ROWS = 16, SIGN_TILES = SIGN_COLS * SIGN_ROWS;
const TW = 512, TH = 128;

/** Atlas offset for a tile index, in UV. Canvas row 0 is the top, so v is flipped. */
export function tileUv(tile, isTokyo = false) {
  let t;
  if (isTokyo) {
    t = 32 + (((tile % 32) + 32) % 32);
  } else {
    t = ((tile % 32) + 32) % 32;
  }
  return [(t % SIGN_COLS) / SIGN_COLS, 1 - (Math.floor(t / SIGN_COLS) + 1) / SIGN_ROWS];
}

const FIRST = [
  'Halstead', 'Kingsway', 'Marrow', 'Corvin', 'Ashmoor', 'Pike', 'Ferrier', 'Tarrow',
  'Salter', 'Dunbar', 'Vellery', 'Steelgate', 'Northline', 'Harbour', 'Ellery', 'Wexford',
  'Shinjuku', 'Shibuya', 'Roppongi', 'Akiba', 'Ginza', 'Neo-Tokyo', 'Kyoto', 'Cyber',
];
const TRADE = [
  'Grocers', 'Pharmacy', 'Diner', 'Laundry', 'Records', 'Books', 'Barbers', 'Bakery',
  'Hardware', 'Tailors', 'Cafe', 'Noodles', 'Optics', 'Electrical', 'Florist', 'Butchers', 'Wines',
  'Print Co', 'Motors', 'Dry Clean', 'Pawn', 'Liquor', 'Chemist', 'Bagels', 'Tattoo', 'Pizza', 'Locks & Keys',
  'RAMEN · ラーメン', 'IZAKAYA · 居酒屋', 'KARAOKE · カラオケ', '24H CONVENIENCE', 'CYBER ARCADE',
  'SUSHI BAR · 鮨', 'CAPSULE HOTEL', 'YAKITORI · 鳥', 'MATCHA CAFE', 'NEO TOKYO MOTORS',
];
const TOKYO_SIGNS = [
  'ラーメン 一番 · RAMEN',
  '居酒屋 🏮 赤ちょうちん',
  'カラオケ 館 · KARAOKE',
  '24H CONVENIENCE · コンビニ',
  '秋葉原 CYBER ARCADE',
  'すし処 鮨 · SUSHI BAR',
  'カプセルホテル · SHINJUKU',
  '炭火焼鳥 · YAKITORI',
  '宇治抹茶 · MATCHA CAFE',
  'パチンコ · PACHINKO NEO',
  'ネオ東京 · NEO-TOKYO MOTORS',
  '新宿 歌舞伎町 · KABUKICHO',
  '渋谷 センター街 · SHIBUYA',
  '六本木 · ROPPONGI NIGHT',
  'ドン・キホーテ · DISCOUNT',
  'セガ ゲームセンター · ARCADE',
  '大衆酒場 · SAKE & BEER',
  'とんかつ · TONKATSU',
  '牛丼 · BEEF BOWL 24H',
  'アニメイト · ANIME & MANGA',
  '銀座 クラブ · GINZA CLUB',
  '東京タワー · TOKYO VIEW',
  '原宿 ファッション · HARAJUKU',
  '築地海鮮 · TSUKIJI FISH',
  '珈琲 喫茶 · KISSATEN',
  'インターネットカフェ · NET CAFE',
  'カクテルバー · BAR TOKYO',
  '立ち飲み · STANDING BAR',
  'おでん · ODEN NOREN',
  '夜市 · NIGHT MARKET',
  '電脳街 · CYBER DISTRICT',
  '浅草 雷門 · ASAKUSA',
];
// [board, text, accent]
const PALETTE = [
  ['#8e1b1b', '#f6e7c8', '#f2c14e'], ['#12284a', '#f4f1e8', '#d94f30'], ['#1d4d2b', '#f1e9c9', '#e8b64a'],
  ['#111214', '#f5f5f0', '#e23b3b'], ['#efe6cf', '#1c1c1e', '#8e1b1b'], ['#d9a520', '#1a1a1a', '#8e1b1b'],
  ['#0f6b6b', '#f3f3ee', '#f2c14e'], ['#f4f2ec', '#12284a', '#d94f30'], ['#3b1f4f', '#f5e9ff', '#f2c14e'],
  ['#0d0d0f', '#39ffb0', '#ff4fd8'], ['#0d0d0f', '#ff4fd8', '#39ffb0'], ['#0d0d0f', '#ffd23f', '#3fd2ff'],
  ['#080812', '#ff007f', '#00f0ff'], ['#060e0a', '#39ff14', '#ffe600'], ['#14080a', '#ff1a40', '#ffaa00'],
  ['#0a0614', '#bd00ff', '#39ffb0'],
];
const TOKYO_PALETTES = [
  ['#06070e', '#ff007f', '#00f0ff'],
  ['#080512', '#00f0ff', '#ff007f'],
  ['#120406', '#ff2200', '#ffd23f'],
  ['#040e08', '#39ff14', '#ffea00'],
  ['#060614', '#ffd23f', '#00f0ff'],
  ['#0e0516', '#bd00ff', '#39ffb0'],
  ['#180608', '#ff3344', '#ffbb00'],
  ['#050d12', '#00e5ff', '#ff007f'],
];
const FONTS = [
  '700 {s}px "Hiragino Kaku Gothic Pro", "Noto Sans JP", -apple-system, sans-serif',
  '900 {s}px "Hiragino Sans", "Arial Black", Impact, sans-serif',
  '700 {s}px "Helvetica Neue", Arial, sans-serif',
  '700 {s}px Georgia, "Times New Roman", serif',
  '600 {s}px "Avenir Next Condensed", "Arial Narrow", sans-serif',
];

export function texSignAtlas() {
  const c = cv(TW * SIGN_COLS, TH * SIGN_ROWS), g = c.getContext('2d');
  const rnd = mulberry32(7);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let t = 0; t < SIGN_TILES; t++) {
    const x0 = (t % SIGN_COLS) * TW, y0 = Math.floor(t / SIGN_COLS) * TH;
    const isTokyoTile = t >= 32;
    const [board, ink, accent] = isTokyoTile ? TOKYO_PALETTES[(t - 32) % TOKYO_PALETTES.length] : pick(PALETTE);
    g.fillStyle = board; g.fillRect(x0, y0, TW, TH);
    // frame
    g.strokeStyle = isTokyoTile ? accent : 'rgba(0,0,0,0.35)';
    g.lineWidth = isTokyoTile ? 4 : 6;
    g.strokeRect(x0 + 3, y0 + 3, TW - 6, TH - 6);
    // an accent device: stripe, or a disc logo on the left
    const r = rnd();
    let tx = x0 + TW / 2, maxW = TW - 60;
    if (r < 0.35) { g.fillStyle = accent; g.fillRect(x0 + 14, y0 + TH - 22, TW - 28, 8); }
    else if (r < 0.65) {
      g.fillStyle = accent; g.beginPath(); g.arc(x0 + 64, y0 + TH / 2, 40, 0, 7); g.fill();
      g.fillStyle = board; g.beginPath(); g.arc(x0 + 64, y0 + TH / 2, 22, 0, 7); g.fill();
      tx = x0 + 110 + (TW - 120) / 2; maxW = TW - 140;
    }
    const name = isTokyoTile
      ? TOKYO_SIGNS[t - 32]
      : (rnd() < 0.7 ? `${pick(FIRST)} ${pick(TRADE)}` : pick(TRADE).toUpperCase());
    const font = isTokyoTile
      ? '800 {s}px "Hiragino Kaku Gothic Pro", "Noto Sans JP", sans-serif'
      : pick(FONTS);
    let size = isTokyoTile ? 58 : 64;
    g.font = font.replace('{s}', size);
    const w = g.measureText(name).width;
    if (w > maxW) { size = Math.floor(size * maxW / w); g.font = font.replace('{s}', size); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(name, tx + 3, y0 + TH / 2 + 3);
    // Optical neon glow bloom
    if (isTokyoTile || board.startsWith('#0')) {
      g.shadowColor = accent; g.shadowBlur = 14;
    }
    g.fillStyle = ink; g.fillText(name, tx, y0 + TH / 2);
    g.shadowBlur = 0;
  }
  return toTex(c);
}

/**
 * Window quads (Phase 2, states in Phase 5): a dark glass face with a
 * per-instance emissive tint in `aTint` (dressing.js rolls ~42% of them dark
 * from a hash of the module position). Phase 5 turns the remaining lit-warm /
 * lit-cool roll into real STATES, entirely inside the material -- no extra
 * attribute, no extra draw:
 *
 *   dark | dim warm | bright warm | curtained (dim, desaturated) |
 *   blinds (warm through horizontal slats) | TV-blue (cool, flickering)
 *
 * The seed is the tint itself. `lv` in dressing.js is a seeded 0.45..1 hash of
 * the window's own position, so one chaotic `sin` of it is a per-window random
 * that is stable across reloads and costs nothing to carry.
 *
 * Distribution over ALL window quads (0.42 dark from dressing x these bands):
 *   dark 51.9% | dim warm 19.1% | bright warm 8.1% | curtained 5.8% |
 *   blinds 5.8% | TV-blue 9.3%      -- most dark, a few bright.
 *
 * The TV flicker copies tokyo.js's per-vertex buzz: two detuned sines on a
 * per-window phase, so no two sets cut at the same moment.
 */
const WIN_BANDS = { dark: 0.17, dim: 0.50, bright: 0.64, curtain: 0.74, blinds: 0.84 };   // upper edge of each band in the hash

/** The states a window hash lands in, for the tests and for reporting the distribution. */
export function windowState(h) {
  if (h < WIN_BANDS.dark) return 'dark';
  if (h < WIN_BANDS.dim) return 'dim';
  if (h < WIN_BANDS.bright) return 'bright';
  if (h < WIN_BANDS.curtain) return 'curtain';
  if (h < WIN_BANDS.blinds) return 'blinds';
  return 'tv';
}

let WIN = null;
const uWinNight = uniform(1);   // 1 = night: without the main.js hook the windows behave exactly as they did

/**
 * 0 by day, 1 at night -- the INTERIOR ramp, and it runs ahead of the fascia
 * signs (setSignNight): a shop's lights are on before its sign is lit, and
 * living-room windows come up at dusk. Each window has its own threshold in
 * the first 55% of the ramp, so a street lights up window by window instead of
 * as one dimmer.
 *
 * It also owns `emissiveIntensity`: nothing else drives this material (clock.js
 * staggers the facade/sign/lamp materials but never the window quads, so they
 * sat at whatever main.js set at boot -- 0 forever on a daylight boot).
 */
export function setWindowNight(k) {
  uWinNight.value = Math.max(0, Math.min(1, k));
  if (WIN) WIN.emissiveIntensity = 1.25;
}

export function buildWindowMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x1a2028, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.25, metalness: 0.1 });
  m.name = 'window_quad';

  const tint = attribute('aTint', 'vec3');
  const lit = step(float(0.001), tint.x.add(tint.y).add(tint.z));            // dressing already rolled the dark ones
  const h = fract(sin(tint.x.mul(97.31).add(tint.z.mul(41.7)).add(0.37)).mul(43758.5453));
  const h2 = fract(h.mul(613.7));                                            // second roll: switch-on threshold and flicker phase
  const band = (a, b) => step(float(a), h).mul(step(h, float(b)));

  const warm = vec3(1.0, 0.80, 0.52);
  const cream = vec3(0.95, 0.90, 0.80);                                      // curtain: the light through cloth loses its colour
  const tv = vec3(0.42, 0.64, 1.0);
  const slat = mix(float(0.12), float(1.0), step(float(0.55), fract(uv().y.mul(6.0))));   // blinds: six slats up the pane
  const ph = h2.mul(6.283);
  const flick = float(0.55).add(sin(time.mul(7.1).add(ph)).mul(0.30)).add(sin(time.mul(19.3).add(ph.mul(2.3))).mul(0.15));

  const state = warm.mul(0.30).mul(band(WIN_BANDS.dark, WIN_BANDS.dim))
    .add(warm.mul(1.0).mul(band(WIN_BANDS.dim, WIN_BANDS.bright)))
    .add(cream.mul(0.22).mul(band(WIN_BANDS.bright, WIN_BANDS.curtain)))
    .add(warm.mul(0.55).mul(slat).mul(band(WIN_BANDS.curtain, WIN_BANDS.blinds)))
    .add(tv.mul(0.62).mul(flick).mul(band(WIN_BANDS.blinds, 1.001)));

  // per-window switch-on: its own threshold in the first 55% of the interior ramp
  const on = smoothstep(h2.mul(0.55), h2.mul(0.55).add(0.18), uWinNight);
  m.emissiveNode = state.mul(lit).mul(on).mul(materialReference('emissiveIntensity', 'float', m));
  WIN = m;
  return m;
}

/** One quad, +Z out of the board, unit size: the instance matrix carries width and height. */
export function signGeometry() {
  return new THREE.PlaneGeometry(1, 1);
}

const uSignOn = uniform(1);
/** 0 by day, 1 at night: the fascia ramp, deliberately BEHIND setWindowNight's
 *  interiors. clock.js still owns `mat.sign.emissiveIntensity`; this is the
 *  per-shop stagger on top of it, so at full night nothing changes. */
export function setSignNight(k) { uSignOn.value = Math.max(0, Math.min(1, k)); }

/**
 * The material. colorNode and emissiveNode both sample the atlas through the
 * per-instance cell, and every material property is read through a reference
 * PINNED to this material (third argument) -- the shadow pass compiles our
 * colorNode inside its own depth material, and an unpinned reference there
 * has no .color to read (see city.js:makeTileable). emissiveIntensity is what
 * main.js dims for daylight, so it must stay a live reference, not a number.
 */
export function buildSignMaterial(atlas) {
  const m = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4,
    roughness: 0.55, metalness: 0.0,
  });
  m.name = 'sign_emissive';
  const tile = attribute('aTile', 'vec2');
  const cell = uv().mul(vec2(1 / SIGN_COLS, 1 / SIGN_ROWS)).add(tile);
  const s = texture(atlas, cell);
  m.colorNode = s.mul(materialReference('color', 'color', m));

  /* Phase 5 -- the sign is NOT the shop. The interior (setWindowNight) is up
     at dusk; the fascia ignites later, shop by shop, and a few never do:
     the shutter is down and the board is dead while the interior behind it
     still glows. Tokyo's kanban (atlas rows 8-15, so aTile.y < 0.5) are
     exempt -- a dark kanban street is not Little Tokyo.
     ponytail: the roll is per ATLAS CELL, the only per-instance value the
     quad carries, so "shut" picks ~4 of the 32 shop brands rather than 12%
     of individual shops. Per-shop needs an `aShop` float from dressing.js
     (hook reported); the shop's own sign stays put across reloads either way. */
  const isTokyo = step(tile.y, 0.49);
  const hs = fract(sin(tile.x.mul(127.1).add(tile.y.mul(311.7)).add(0.19)).mul(43758.5453));
  const open = float(1).sub(step(hs, float(0.12)).mul(float(1).sub(isTokyo)));
  const buzz = mix(float(1), float(0.42).add(float(0.58).mul(step(float(0.3), sin(time.mul(21).add(hs.mul(37)))))),
    step(float(0.93), hs));                       // one brand's tube is on its way out
  const on = smoothstep(hs.mul(0.35).add(0.18), hs.mul(0.35).add(0.42), uSignOn).mul(open).mul(buzz);

  m.emissiveNode = s.mul(materialReference('emissive', 'color', m))
    .mul(materialReference('emissiveIntensity', 'float', m))
    .mul(on);
  return m;
}

