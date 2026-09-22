import * as THREE from 'three';
import { texture, uv, attribute, vec2, materialReference, float, floor, mod, time, uniform, step, mix } from 'three/tsl';
import { cv, toTex } from './textures.js';

/**
 * Little Tokyo's boards: what the kanban, fascias and screens SAY, in one
 * 2048^2 atlas painted at boot, and the one material that shows it.
 *
 * Matched to the Shibuya stills in the repo root (shibuya-day.jpg,
 * shibuya2.jpg): that street's signs are LIGHTBOXES -- white, yellow, red,
 * green and blue boards with heavy black or white lettering, lit from inside
 * -- plus a few big video screens. What Tokyo wore before was the city atlas's
 * 32 neon lines on near-black, every one 4:1 and stretched onto every shape:
 * a vertical kanban showed its lettering lying on its side, a 12 m fascia
 * three times too wide, a near-square wall board squashed flat.
 *
 * Three shapes, one region each:
 *   h  512x128, 24 tiles, rows 0-5    fascias, tenant boards, rooftop frames
 *   v  512x128, 24 tiles, rows 6-11   vertical kanban. Painted a quarter turn
 *                                     round, so the quad districtWorld rolls up
 *                                     the column stands the characters upright
 *                                     and reads them top to bottom
 *   s  512x256,  8 tiles, rows 12-15  video screens, 2:1, cycling their ads
 *
 * A board instance carries `aCell` = (u0, v0, du, dv), so one InstancedMesh
 * per chunk draws all three shapes (tokyoBoardMesh).
 */

const AW = 2048, AH = 2048;
const REGION = {
  h: { y: 0, w: 512, h: 128, n: 24 },
  v: { y: 768, w: 512, h: 128, n: 24 },
  s: { y: 1536, w: 512, h: 256, n: 8 },
};

function tileRect(kind, i) {
  const r = REGION[kind], perRow = AW / r.w, idx = ((i % r.n) + r.n) % r.n;
  return { x: (idx % perRow) * r.w, y: r.y + Math.floor(idx / perRow) * r.h, w: r.w, h: r.h };
}

/** (u0, v0, du, dv) for a board of `kind` ('h' | 'v' | 's') from a 0..1 hash. Canvas y runs down, v runs up. Pure; tested. */
export function tokyoCell(kind, h01) {
  const k = REGION[kind] ? kind : 'h';
  const t = tileRect(k, Math.floor(Math.max(0, Math.min(0.999999, h01)) * REGION[k].n));
  return [t.x / AW, 1 - (t.y + t.h) / AH, t.w / AW, t.h / AH];
}

const JP = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
const EN = '"Helvetica Neue", Arial, sans-serif';

// [board, ink, accent]: the lightboxes in the stills, and two dark ones so a row of them is not all white
const BOX = [
  ['#f5f3ec', '#d7141f', '#1b1b1b'], ['#f5f3ec', '#141414', '#d7141f'], ['#ffd200', '#d7141f', '#141414'],
  ['#ffd200', '#141414', '#d7141f'], ['#d7141f', '#ffffff', '#ffd200'], ['#e5007e', '#ffffff', '#ffe14d'],
  ['#00964b', '#ffffff', '#ffd200'], ['#0a53b5', '#ffffff', '#ffd200'], ['#ff7300', '#ffffff', '#141414'],
  ['#00a0dc', '#ffffff', '#ffe14d'], ['#15171c', '#ffd200', '#e5007e'], ['#15171c', '#ffffff', '#00b0e8'],
];
// brand-free trades, the Japanese the street reads and a line of English under it
const H_SIGNS = [
  ['カラオケ', 'KARAOKE 24H'], ['焼肉', 'YAKINIKU'], ['ラーメン', 'RAMEN'], ['居酒屋', 'IZAKAYA'],
  ['寿司', 'SUSHI'], ['ドラッグ', 'DRUG STORE'], ['ゲームセンター', 'GAME CENTER'], ['漫画喫茶', 'MANGA CAFE'],
  ['歯科', 'DENTAL CLINIC'], ['質', 'PAWN SHOP'], ['牛丼', 'BEEF BOWL'], ['コンビニ', 'CONVENIENCE'],
  ['カフェ', 'CAFE'], ['英会話', 'ENGLISH SCHOOL'], ['麻雀', 'MAHJONG'], ['ホテル', 'HOTEL'],
  ['古着', 'VINTAGE'], ['メガネ', 'OPTICS'], ['中華料理', 'CHINESE'], ['ボウリング', 'BOWLING'],
  ['家電', 'ELECTRONICS'], ['餃子', 'GYOZA'], ['占い', 'FORTUNE'], ['バー 夜', 'NIGHT BAR'],
];
const V_SIGNS = [
  'カラオケ', 'ラーメン', '居酒屋', '焼肉', '寿司', 'ホテル', '麻雀', '薬', '歯科', '質屋', '漫画', 'パチンコ',
  'ゲーム', 'マッサージ', 'うどん', 'そば', '焼鳥', '中華', '喫茶', 'バー', '古着', 'スナック', '整体', 'ネイル',
];

/** The biggest size (to `max`) at which `text` fits `w`, with the font set. */
function fit(g, text, weight, family, w, max) {
  g.font = `${weight} ${max}px ${family}`;
  const m = g.measureText(text).width;
  const s = m > w ? Math.floor(max * w / m) : max;
  g.font = `${weight} ${s}px ${family}`;
  return s;
}

/** Lit from inside: a touch brighter at the top, a touch darker at the foot, and a rim. */
function lightbox(g, x, y, w, h) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
}

function paintH(g, t, i) {
  const [board, ink, accent] = BOX[(i * 5) % BOX.length];
  const [jp, en] = H_SIGNS[i % H_SIGNS.length];
  g.fillStyle = board; g.fillRect(t.x, t.y, t.w, t.h);
  lightbox(g, t.x, t.y, t.w, t.h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const layout = i % 3;
  if (layout === 0) {            // a square badge on the left with the floor, the name beside it
    const b = t.h - 28;
    g.fillStyle = accent; g.fillRect(t.x + 14, t.y + 14, b, b);
    g.fillStyle = board; fit(g, `${2 + (i % 7)}F`, 800, EN, b - 16, 46); g.fillText(`${2 + (i % 7)}F`, t.x + 14 + b / 2, t.y + t.h / 2 + 2);
    const cx = t.x + t.h + (t.w - t.h) / 2;
    g.fillStyle = ink; fit(g, jp, 900, JP, t.w - t.h - 36, 76); g.fillText(jp, cx, t.y + 54);
    g.globalAlpha = 0.8; fit(g, en, 700, EN, t.w - t.h - 60, 19); g.fillText(en, cx, t.y + 104); g.globalAlpha = 1;
  } else if (layout === 1) {     // the name, and the English on an accent stripe along the foot
    g.fillStyle = ink; fit(g, jp, 900, JP, t.w - 48, 74); g.fillText(jp, t.x + t.w / 2, t.y + 50);
    g.fillStyle = accent; g.fillRect(t.x + 12, t.y + t.h - 36, t.w - 24, 24);
    g.fillStyle = accent === '#141414' || accent === '#1b1b1b' ? '#ffffff' : board;
    fit(g, en, 800, EN, t.w - 80, 18); g.fillText(en, t.x + t.w / 2, t.y + t.h - 23);
  } else {                       // one big name, a price tag in the corner
    g.fillStyle = ink; fit(g, jp, 900, JP, t.w - 150, 90); g.fillText(jp, t.x + (t.w - 110) / 2 + 8, t.y + t.h / 2 + 2);
    g.fillStyle = accent; g.beginPath(); g.arc(t.x + t.w - 62, t.y + t.h / 2, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = accent === '#141414' || accent === '#1b1b1b' ? '#ffd200' : board;
    const price = `¥${[390, 480, 550, 690, 880, 980][i % 6]}`;
    fit(g, price, 800, EN, 76, 28); g.fillText(price, t.x + t.w - 62, t.y + t.h / 2 + 1);
  }
}

/** A vertical kanban, painted upright on its own 128x512 canvas: the characters stacked top to bottom. */
function paintVUpright(i) {
  const U = cv(128, 512), u = U.getContext('2d');
  const [board, ink, accent] = BOX[(i * 7 + 3) % BOX.length];
  u.fillStyle = board; u.fillRect(0, 0, 128, 512);
  lightbox(u, 0, 0, 128, 512);
  u.textAlign = 'center'; u.textBaseline = 'middle';
  let top = 16;
  if (i % 3 !== 2) {             // a cap in the accent colour: the floor it is on
    u.fillStyle = accent; u.fillRect(10, 10, 108, 58);
    u.fillStyle = accent === '#141414' || accent === '#1b1b1b' ? '#ffffff' : board;
    const tag = i % 2 ? `${2 + (i % 6)}F` : 'B1';
    fit(u, tag, 800, EN, 90, 38); u.fillText(tag, 64, 41);
    top = 76;
  }
  // vertical writing draws the long vowel mark as a vertical stroke
  const chars = [...V_SIGNS[i % V_SIGNS.length].replace(/ー/g, '｜')];
  // a short word sits as a centred stack, not spread down the whole board with a gap between its characters
  const avail = 512 - top - 18;
  const size = Math.floor(Math.min(chars.length <= 2 ? 108 : 98, avail / chars.length * 0.9));
  const pitch = Math.min(avail / chars.length, size * 1.18), y0 = top + (avail - pitch * chars.length) / 2;
  u.fillStyle = ink; u.font = `900 ${size}px ${JP}`;
  chars.forEach((ch, k) => u.fillText(ch, 64, y0 + pitch * (k + 0.5) + 2));
  return U;
}

function paintV(g, t, i) {
  /* The rolled quad (districtWorld: Euler z = +PI/2) puts the tile's RIGHT end
     at the top of the board and the tile's TOP edge down the board's left. So
     the upright art goes in turned a quarter clockwise: its top at the tile's
     right end, its left side along the tile's top. */
  g.setTransform(0, 1, -1, 0, t.x + t.w, t.y);
  g.drawImage(paintVUpright(i), 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/* The eight screen ads, brand-free. Big shapes and big words: they are read
   from the far side of a junction, through bloom. */
const ADS = [
  (g, x, y, w, h) => {   // matcha latte
    grad(g, x, y, h, '#0f5a3a', '#1f7a4f');
    g.fillStyle = '#f1ead2'; g.beginPath(); g.arc(x + 128, y + 128, 84, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7fb069'; g.beginPath(); g.arc(x + 128, y + 128, 62, 0, Math.PI * 2); g.fill();
    words(g, '抹茶ラテ', 900, JP, '#f6f1dc', x + 360, y + 104, 260, 70);
    words(g, 'MATCHA LATTE  ¥480', 700, EN, '#d9ead0', x + 360, y + 176, 250, 22);
  },
  (g, x, y, w, h) => {   // a phone network
    grad(g, x, y, h, '#6fd0ff', '#2a7fe0');
    g.fillStyle = '#ffffff'; round(g, x + 360, y + 34, 108, 190, 18); g.fill();
    g.fillStyle = '#2a7fe0'; round(g, x + 370, y + 50, 88, 150, 8); g.fill();
    words(g, 'HALSTEAD', 800, EN, '#ffffff', x + 180, y + 84, 300, 44);
    words(g, 'MOBILE 5G', 800, EN, '#ffffff', x + 180, y + 136, 300, 44);
    words(g, '渋谷 どこでも つながる', 700, JP, '#e8f6ff', x + 180, y + 196, 300, 24);
  },
  (g, x, y, w, h) => {   // a live show
    grad(g, x, y, h, '#ff5fa2', '#7b2be2');
    for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(255,255,255,${0.08 + (k % 3) * 0.05})`; g.beginPath(); g.arc(x + (k * 97) % w, y + (k * 53) % h, 14 + (k % 4) * 10, 0, Math.PI * 2); g.fill(); }
    words(g, 'SAKURA LIVE', 900, EN, '#ffffff', x + w / 2, y + 100, 440, 66);
    words(g, '2026  渋谷ホール', 700, JP, '#ffe3f1', x + w / 2, y + 180, 400, 30);
  },
  (g, x, y, w, h) => {   // a sale
    grad(g, x, y, h, '#ff1a2e', '#c4000f');
    g.fillStyle = '#ffd200'; g.beginPath();
    for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12, r = k % 2 ? 70 : 104; g.lineTo(x + 400 + Math.cos(a) * r, y + 128 + Math.sin(a) * r); }
    g.fill();
    words(g, '50%', 900, EN, '#c4000f', x + 400, y + 120, 120, 50);
    words(g, 'SALE', 900, EN, '#ffd200', x + 160, y + 106, 270, 110);
    words(g, '夏のセール 開催中', 800, JP, '#ffffff', x + 160, y + 196, 270, 30);
  },
  (g, x, y, w, h) => {   // the radio station that is really in the game (game/radio.js)
    grad(g, x, y, h, '#101a3a', '#05070f');
    for (let k = 0; k < 22; k++) { const bh = 20 + ((k * 37) % 90); g.fillStyle = k % 2 ? '#00e5ff' : '#ff3fb4'; g.fillRect(x + 30 + k * 21, y + 226 - bh, 14, bh); }
    words(g, 'SHIBUYA CITY POP', 900, EN, '#ffffff', x + w / 2, y + 62, 460, 44);
    words(g, 'FM 88.1  24H  シティポップ', 700, JP, '#9fe9ff', x + w / 2, y + 112, 440, 24);
  },
  (g, x, y, w, h) => {   // a new game
    grad(g, x, y, h, '#ffe14d', '#ffc400');
    for (let k = 0; k < 18; k++) { g.fillStyle = ['#141414', '#d7141f', '#0a53b5'][k % 3]; g.fillRect(x + 20 + (k % 6) * 22, y + 150 + Math.floor(k / 6) * 22, 18, 18); }
    words(g, '新作ゲーム', 900, JP, '#141414', x + w / 2 + 50, y + 92, 330, 74);
    words(g, 'NOW ON SALE', 900, EN, '#d7141f', x + w / 2 + 50, y + 170, 300, 34);
  },
  (g, x, y, w, h) => {   // a soda
    grad(g, x, y, h, '#e8f7ff', '#8fd3ff');
    g.fillStyle = '#12a5b8'; round(g, x + 60, y + 70, 70, 160, 20); g.fill(); g.fillRect(x + 82, y + 34, 26, 44);
    g.fillStyle = '#ffffff'; g.fillRect(x + 66, y + 120, 58, 34);
    words(g, 'KAZE SODA', 900, EN, '#0b3a66', x + 320, y + 92, 320, 56);
    words(g, '爽快', 900, JP, '#12a5b8', x + 320, y + 178, 300, 74);
  },
  (g, x, y, w, h) => {   // a race meet
    grad(g, x, y, h, '#2a0e3f', '#08040d');
    g.strokeStyle = 'rgba(255,190,60,0.5)'; g.lineWidth = 3;
    for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(x, y + 150 + k * 9); g.lineTo(x + 200 - k * 12, y + 150 + k * 9); g.stroke(); }
    g.fillStyle = '#d7141f'; g.beginPath(); g.moveTo(x + 180, y + 216); g.lineTo(x + 250, y + 170); g.lineTo(x + 420, y + 176); g.lineTo(x + 470, y + 216); g.fill();
    words(g, 'HALSTEAD BAY RACING', 900, EN, '#ffffff', x + w / 2, y + 60, 470, 40);
    words(g, '首都高  峠  ナイトレース', 800, JP, '#ffbe3c', x + w / 2, y + 112, 440, 28);
  },
];
function grad(g, x, y, h, a, b) { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(x, y, 512, h); }
function words(g, text, weight, family, colour, cx, cy, w, max) { g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = colour; fit(g, text, weight, family, w, max); g.fillText(text, cx, cy); }
function round(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

function paintS(g, t, i) {
  g.save(); g.beginPath(); g.rect(t.x, t.y, t.w, t.h); g.clip();
  ADS[i % ADS.length](g, t.x, t.y, t.w, t.h);
  // LED rows: a faint dark line every 4 px, which is what a screen looks like from under it
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let yy = t.y; yy < t.y + t.h; yy += 4) g.fillRect(t.x, yy, t.w, 1);
  g.restore();
}

export function texTokyoAtlas() {
  const c = cv(AW, AH), g = c.getContext('2d');
  g.fillStyle = '#15171c'; g.fillRect(0, 0, AW, AH);
  for (let i = 0; i < REGION.h.n; i++) paintH(g, tileRect('h', i), i);
  for (let i = 0; i < REGION.v.n; i++) paintV(g, tileRect('v', i), i);
  for (let i = 0; i < REGION.s.n; i++) paintS(g, tileRect('s', i), i);
  return toTex(c);
}

const uNight = uniform(0);
/** 0 by day, 1 at night (tokyo.js setTokyoNight forwards it). */
export function setTokyoSignNight(k) { uNight.value = Math.max(0, Math.min(1, k)); }

/* How brightly a board lights from inside, day -> night, as a multiple of its
   own colour. A white lightbox at night emits 0.8 -- at the bloom threshold,
   so it glows and does not blow out; the old neon tiles emitted 2.46 in their
   lettering. Screens are LED: they are bright by day too. The look knobs. */
const BOARD_DAY = 0.06, BOARD_NIGHT = 0.8, SCREEN_DAY = 0.85, SCREEN_NIGHT = 1.2;

let MAT = null;
export function tokyoSignMaterial() {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.45, metalness: 0 });
  m.name = 'tokyo_sign';
  const c = attribute('aCell', 'vec4');
  const screen = step(float(0.1), c.w);   // only the screen tiles are 256 px tall
  /* A screen runs the eight ads in turn, eight seconds each. Its starting ad
     comes from its own cell (k, 0..7: the column, plus 4 on the bottom row) and
     its switching beat is offset by k, so a junction of them does not cut in
     step. Row 0 of the screens sits at v0 0.125, row 1 at 0. */
  const k = c.x.mul(4).add(float(1).sub(c.y.mul(8)).mul(4));
  const n = mod(k.add(floor(time.mul(0.125).add(k.mul(0.37)))), float(8));
  const row = floor(n.mul(0.25));
  const base = mix(c.xy, vec2(n.sub(row.mul(4)).mul(0.25), float(1).sub(row).mul(0.125)), screen);
  // 1% inset: the mip chain would otherwise bleed the neighbouring tile in along every edge
  const s = texture(tokyoAtlas(), uv().mul(c.zw.mul(0.98)).add(base).add(c.zw.mul(0.01)));
  m.colorNode = s.mul(materialReference('color', 'color', m));
  const lit = mix(mix(float(BOARD_DAY), float(BOARD_NIGHT), uNight), mix(float(SCREEN_DAY), float(SCREEN_NIGHT), uNight), screen);
  m.emissiveNode = s.rgb.mul(lit).mul(materialReference('emissiveIntensity', 'float', m));
  MAT = m;
  return m;
}
let ATLAS = null;
const tokyoAtlas = () => (ATLAS ??= texTokyoAtlas());

/** One InstancedMesh for a chunk's boards, [{ m: Matrix4, cell: [u0, v0, du, dv] }]: one draw for every Tokyo board in it. */
export function tokyoBoardMesh(boards) {
  const g = new THREE.PlaneGeometry(1, 1);
  g.userData.owned = true;   // the chunk's release sweep frees it
  const cells = new Float32Array(boards.length * 4);
  const mesh = new THREE.InstancedMesh(g, tokyoSignMaterial(), boards.length);
  boards.forEach((b, i) => { mesh.setMatrixAt(i, b.m); cells.set(b.cell, i * 4); });
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;   // no casting: a board's shadow is a smear on the wall behind it
  return mesh;
}
