import * as THREE from 'three';
import { texture, uv, attribute, vec2, materialReference } from 'three/tsl';
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
 * Window quads (Phase 2): a dark glass face with a per-instance emissive tint
 * in `aTint`. About 40% are unlit (tint 0). Stands 8cm proud of the wall on
 * the storeys above the shopfront so the facade stops reading as a print.
 */
export function buildWindowMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x1a2028, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.1 });
  m.name = 'window_quad';
  m.emissiveNode = attribute('aTint', 'vec3').mul(materialReference('emissiveIntensity', 'float', m));
  return m;
}

/** One quad, +Z out of the board, unit size: the instance matrix carries width and height. */
export function signGeometry() {
  return new THREE.PlaneGeometry(1, 1);
}

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
  const cell = uv().mul(vec2(1 / SIGN_COLS, 1 / SIGN_ROWS)).add(attribute('aTile', 'vec2'));
  const s = texture(atlas, cell);
  m.colorNode = s.mul(materialReference('color', 'color', m));
  m.emissiveNode = s.mul(materialReference('emissive', 'color', m))
    .mul(materialReference('emissiveIntensity', 'float', m));
  return m;
}
