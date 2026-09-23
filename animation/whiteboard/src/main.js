// Draws one frame of the whiteboard story at time t: board, ink, the eraser,
// the pixel critter and its speech bubbles. window.renderFrame(i) for tools/render.mjs.
import { drawShape, rng } from './ink.js';
import * as I from './ink.js';

// ?story=name loads stories/name.js; the default is story 1 (src/story.js).
const params = new URLSearchParams(location.search);
const story = params.get('story') ? await import(`../stories/${params.get('story')}.js`) : await import('./story.js');
const { FPS, DURATION, ITEMS, WIPES, WIPE_DUR, sceneOf, BUBBLES, TYPE_RATE, HOPS, POINTS, critterX } = story;
const MOVER = story.MOVER || [], SUBTITLES = story.SUBTITLES || [], TALK = story.TALK || [];

const W = 1280, H = 720;
const c = document.getElementById('c'), g = c.getContext('2d');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const FONT = '"Liberation Sans", Arial, sans-serif';

// ---- the board ---------------------------------------------------------------------
const board = document.createElement('canvas');
board.width = W; board.height = H;
{
  const b = board.getContext('2d'), r = rng(4);
  b.fillStyle = '#9aa0a6'; b.fillRect(0, 0, W, H);                      // aluminium frame
  const grd = b.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#fbfbf8'); grd.addColorStop(1, '#eeeeea');
  b.fillStyle = grd; b.fillRect(16, 16, W - 32, H - 74);
  for (let i = 0; i < 40; i++) {                                         // old ghost smudges
    b.fillStyle = `rgba(120,130,150,${0.006 + r() * 0.01})`;
    b.beginPath(); b.ellipse(r() * W, r() * (H - 90), 40 + r() * 160, 10 + r() * 40, r() * 3, 0, 7); b.fill();
  }
  b.fillStyle = 'rgba(255,255,255,0.35)'; b.fillRect(16, 16, W - 32, 6);
  b.fillStyle = '#80868c'; b.fillRect(0, H - 58, W, 58);                 // the tray
  b.fillStyle = '#6c7278'; b.fillRect(0, H - 58, W, 8);
  const markers = [['#d2372c', 900], ['#2359b8', 1010], ['#2e8f4e', 1120]];
  for (const [col, x] of markers) {
    b.fillStyle = '#f2f2f2'; b.fillRect(x, H - 44, 90, 16);
    b.fillStyle = col; b.fillRect(x + 90, H - 44, 18, 16); b.fillRect(x, H - 44, 14, 16);
  }
}

// ---- marker text: char by char, with a little hand jitter -----------------------------
function writeText(it, p) {
  const n = Math.ceil(it.text.length * clamp(p, 0, 1));
  if (!n) return;
  g.font = `bold ${it.size}px ${FONT}`;
  g.fillStyle = it.color; g.textBaseline = 'alphabetic';
  const full = g.measureText(it.text).width;
  let x = it.align === 'center' ? it.x - full / 2 : it.x;
  const r = rng(it.text.length * 131 + Math.round(it.x));
  for (let i = 0; i < n; i++) {
    const ch = it.text[i], w = g.measureText(ch).width;
    const jr = (r() - 0.5) * 0.06, jy = (r() - 0.5) * it.size * 0.05;
    g.save(); g.translate(x + w / 2, it.y + jy); g.rotate(jr); g.fillText(ch, -w / 2, 0); g.restore();
    x += w;
  }
}

// ---- the critter: 11 x 11 cells, a near-square body with side nubs and long legs ----
const CELL = 12, GW = 11, ORANGE = '#cc7f61', TOP = '#dd9a80';
function critter(t) {
  const { x, walking, dir } = critterX(t);
  let hop = 0;
  for (const h of HOPS) { const k = (t - h) / 0.42; if (k > 0 && k < 1) hop = Math.max(hop, Math.sin(k * Math.PI) * 34); }
  const talking = BUBBLES.some((b) => t >= b.t0 && t < b.t0 + b.text.length / TYPE_RATE) || TALK.some((q) => t >= q.t0 && t < q.t1);
  if (talking) hop = Math.max(hop, Math.abs(Math.sin(t * 14)) * 5);
  const pointing = POINTS.some((q) => t >= q.t0 && t < q.t1);
  const blink = (t % 3.1) < 0.13;
  const frame = walking ? Math.floor(t * 12) % 4 : -1;
  const bob = walking ? [0, -0.35, 0, -0.35][frame] : 0;
  const baseY = H - 58 - 10.8 * CELL - hop;
  const px = (cx, cy, w = 1, h = 1, col = ORANGE) => {
    const X = dir > 0 ? cx : GW - cx - w;
    g.fillStyle = col; g.fillRect(Math.round(x + X * CELL), Math.round(baseY + (cy + bob) * CELL), Math.ceil(w * CELL), Math.ceil(h * CELL));
  };
  // Shadow on the tray.
  g.fillStyle = `rgba(0,0,0,${0.18 - hop / 400})`;
  g.beginPath(); g.ellipse(x + 5.5 * CELL, H - 56, 66 - hop * 0.6, 7, 0, 0, 7); g.fill();
  px(1, 0, 9, 8); px(1, 0, 9, 0.35, TOP);
  // Nubs: the front one lifts and reaches out when pointing.
  px(0, 3, 1, 2.4);
  if (pointing) { px(10, 1.6, 1.8, 1.2); } else px(10, 3, 1, 2.4);
  for (const [lx, pair] of [[1, 0], [3, 1], [7, 0], [9, 1]]) {
    const up = frame >= 0 && (frame < 2 ? pair === 0 : pair === 1);
    px(lx + (up ? 0.3 : 0), 8, 0.95, up ? 2.2 : 2.8);
  }
  const eh = blink ? 0.35 : 1.4, ey = 3.1 + (blink ? 0.6 : 0), look = pointing ? 0.3 : 0;
  px(1.9 + look, ey, 1.1, eh, '#111111'); px(8.0 + look, ey, 1.1, eh, '#111111');
  return { x, top: baseY };
}

// ---- speech bubble, drawn like marker on white -------------------------------------------
function wrap(text, maxW) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const s = cur ? `${cur} ${w}` : w; if (g.measureText(s).width > maxW && cur) { lines.push(cur); cur = w; } else cur = s; }
  if (cur) lines.push(cur);
  return lines;
}
function bubble(b, t, who) {
  const o = clamp(Math.min((t - b.t0) / 0.25, (b.t1 - t) / 0.25), 0, 1);
  if (o <= 0) return;
  g.font = `bold 30px ${FONT}`;
  const lines = wrap(b.text, 430);
  const shown = Math.ceil((t - b.t0) * TYPE_RATE);
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 44, h = lines.length * 38 + 30;
  const x = clamp(who.x + 80, 30, W - w - 30), y = who.top - h - 34;
  g.save(); g.globalAlpha = o;
  g.fillStyle = '#ffffff'; g.strokeStyle = '#23262b'; g.lineWidth = 4;
  g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill(); g.stroke();
  // Tail towards the critter.
  const tx = clamp(who.x + 80, x + 20, x + w - 40);
  g.beginPath(); g.moveTo(tx, y + h - 2); g.lineTo(tx - 14, y + h + 26); g.lineTo(tx + 20, y + h - 2); g.fillStyle = '#fff'; g.fill();
  g.beginPath(); g.moveTo(tx, y + h); g.lineTo(tx - 14, y + h + 26); g.lineTo(tx + 20, y + h); g.stroke();
  g.fillStyle = '#23262b';
  let left = shown;
  lines.forEach((l, i) => { if (left > 0) g.fillText(l.slice(0, left), x + 22, y + 44 + i * 38); left -= l.length + 1; });
  g.restore();
}

// ---- subtitles: the narration, for anyone watching muted ------------------------------------
function subtitles(t) {
  const s = SUBTITLES.find((q) => t >= q.t0 && t < q.t1);
  if (!s) return;
  const o = clamp(Math.min((t - s.t0) / 0.2, (s.t1 - t) / 0.2), 0, 1);
  g.font = `bold 25px ${FONT}`;
  const lines = wrap(s.text, 880);
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 36, h = lines.length * 32 + 16;
  const cx = 760, y = H - 58 - 12 - h;
  g.save(); g.globalAlpha = o;
  g.fillStyle = 'rgba(20,22,26,0.82)'; g.beginPath(); g.roundRect(cx - w / 2, y, w, h, 12); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center';
  lines.forEach((l, i) => g.fillText(l, cx, y + 32 + i * 32));
  g.restore();
}

// ---- the eraser ----------------------------------------------------------------------------
function eraserX(t) {
  for (const w of WIPES) if (t >= w && t < w + WIPE_DUR) return -160 + (W + 320) * (t - w) / WIPE_DUR;
  return null;
}
function drawEraser(x, t) {
  const y = 250 + Math.sin(t * 25) * 120;
  g.fillStyle = '#2f3437'; g.beginPath(); g.roundRect(x - 60, y - 34, 120, 44, 8); g.fill();
  g.fillStyle = '#c9c5bb'; g.fillRect(x - 60, y + 8, 120, 22);
}

// ---- a frame -----------------------------------------------------------------------------
function drawScene(scene, t) {
  for (const it of ITEMS) {
    if (it.scene !== scene || t < it.t0) continue;
    const p = (t - it.t0) / it.dur;
    if (it.kind === 'shape') drawShape(g, it.shape, p);
    else if (it.kind === 'custom') it.draw(g, t);
    else writeText(it, p);
  }
  for (const m of MOVER) {
    if (m.scene !== scene || t < m.t0) continue;
    const k = clamp((t - m.t0) / (m.t1 - m.t0), 0, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;
    const x = m.from[0] + (m.to[0] - m.from[0]) * e, y = m.from[1] + (m.to[1] - m.from[1]) * e;
    const rot = Math.atan2(m.to[1] - m.from[1], m.to[0] - m.from[0]);
    drawShape(g, I.airliner(x, y - 22, m.k, rot, 'blue', 4), 1);
  }
}
function frame(t) {
  g.drawImage(board, 0, 0);
  const scene = sceneOf(t), ex = eraserX(t);
  g.save(); g.beginPath(); g.rect(16, 16, W - 32, H - 74); g.clip();
  if (ex !== null) {
    // The old scene survives to the right of the eraser, a faint ghost to its left.
    g.save(); g.beginPath(); g.rect(ex, 0, W, H); g.clip(); drawScene(scene - 1, t); g.restore();
    g.save(); g.globalAlpha = 0.07; g.beginPath(); g.rect(0, 0, ex, H); g.clip(); drawScene(scene - 1, t); g.restore();
  } else {
    const since = t - (WIPES[scene - 1] ?? -99) - WIPE_DUR;
    if (since < 1.5) { g.save(); g.globalAlpha = 0.07 * (1 - since / 1.5); drawScene(scene - 1, t); g.restore(); }
    drawScene(scene, t);
  }
  g.restore();
  if (ex !== null) drawEraser(ex, t);
  const who = critter(t);
  for (const b of BUBBLES) bubble(b, t, who);
  subtitles(t);
  // Fade in and out.
  const f = Math.max(1 - clamp(t / 0.6, 0, 1), clamp((t - (DURATION - 0.8)) / 0.8, 0, 1));
  if (f > 0) { g.fillStyle = `rgba(0,0,0,${f})`; g.fillRect(0, 0, W, H); }
  return { scene };
}

window.DURATION = DURATION;
window.FPS = FPS;
window.renderFrame = (i) => frame(i / FPS);
window.ready = true;

if (!params.has('render')) {
  const t0 = performance.now();
  const loop = () => { frame(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
