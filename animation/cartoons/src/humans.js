// Early humans: a jointed cartoon rig (no clothes, smooth and simple), plus the
// props for the coconut story: corn, palm tree, coconuts, stones, beach and sea.
import { rng, clamp, lerp } from './art.js';

// Pose: angles in radians, 0 = limb hanging straight down, positive = forward
// (towards where the figure faces). Two segments per limb: [upper, bend].
//   { rot, la, ra, ll, rl, head, mouth, eyes, holdR, holdL }
// look: { skin, hair: 'curly'|'long'|'short', hairCol, s }
export const KOA = { skin: '#b0764e', hairCol: '#1f1611', hair: 'curly', s: 1 };
export const MIRA = { skin: '#8d5a3a', hairCol: '#1a120d', hair: 'long', s: 0.92 };
export const TIKI = { skin: '#c28a60', hairCol: '#2b1d14', hair: 'short', s: 0.72 };

const TORSO = 50, UA = 25, FA = 23, TH = 27, SH = 28, HEAD = 18;

export function human(g, x, y, look, pose = {}, dir = 1) {
  const s = look.s || 1;
  g.save(); g.translate(x, y); g.scale(dir * s, s);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const hip = [0, -(TH + SH) + (pose.drop || 0)];
  const rot = pose.rot || 0;
  const sh = [hip[0] + Math.sin(rot) * TORSO, hip[1] - Math.cos(rot) * TORSO];
  const limb = (o, [a, b], l1, l2, w, col) => {
    const e = [o[0] + Math.sin(a) * l1, o[1] + Math.cos(a) * l1];
    const h = [e[0] + Math.sin(a + b) * l2, e[1] + Math.cos(a + b) * l2];
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(e[0], e[1]); g.lineTo(h[0], h[1]); g.stroke();
    return h;
  };
  const dark = shade(look.skin, -18);
  // Back limbs in a darker tone for depth.
  const hl = limb([sh[0] - 2, sh[1] + 6], pose.la || [-0.2, -0.2], UA, FA, 9, dark);
  const fl = limb(hip, pose.ll || [-0.15, 0.1], TH, SH, 11, dark);
  foot(g, fl, dark, pose.ll);
  // Torso: a smooth rounded body, hips to shoulders.
  g.save(); g.translate(hip[0], hip[1]); g.rotate(rot);
  g.fillStyle = look.skin;
  g.beginPath(); g.ellipse(0, -TORSO * 0.5, 17, TORSO * 0.62, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(0, 2, 14, 11, 0, 0, 7); g.fill();
  g.restore();
  const fr = limb(hip, pose.rl || [0.15, 0.1], TH, SH, 11, look.skin);
  foot(g, fr, look.skin, pose.rl);
  // Head.
  const hr = (pose.head || 0) + rot * 0.6;
  const hc = [sh[0] + Math.sin(rot) * 14 + 4, sh[1] - 16];
  g.save(); g.translate(hc[0], hc[1]); g.rotate(hr);
  g.fillStyle = look.skin; g.beginPath(); g.arc(0, 0, HEAD, 0, 7); g.fill();
  g.fillStyle = look.hairCol;
  if (look.hair === 'curly') for (const [dx, dy] of [[-12, -10], [-3, -16], [7, -15], [-15, 0], [14, -8]]) { g.beginPath(); g.arc(dx, dy, 8, 0, 7); g.fill(); }
  else if (look.hair === 'long') { g.beginPath(); g.arc(-2, -5, HEAD + 1, Math.PI * 0.9, Math.PI * 2.05); g.fill(); g.fillRect(-HEAD - 1, -5, 10, 34); }
  else { g.beginPath(); g.arc(-1, -4, HEAD, Math.PI * 1.0, Math.PI * 2.0); g.fill(); }
  // Face.
  const eyes = pose.eyes || 'open';
  g.fillStyle = '#181210'; g.strokeStyle = '#181210'; g.lineWidth = 2.2;
  if (eyes === 'closed' || eyes === 'happy') { g.beginPath(); g.arc(8, -2, 3.4, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
  else if (eyes === 'x') { g.beginPath(); g.moveTo(5, -5); g.lineTo(11, 1); g.moveTo(11, -5); g.lineTo(5, 1); g.stroke(); }
  else if (eyes === 'wide') { g.fillStyle = '#fff'; g.beginPath(); g.arc(8, -2, 4.4, 0, 7); g.fill(); g.fillStyle = '#181210'; g.beginPath(); g.arc(9, -2, 2.2, 0, 7); g.fill(); }
  else if (eyes === 'up') { g.beginPath(); g.arc(9, -5, 2.5, 0, 7); g.fill(); }
  else { g.beginPath(); g.arc(8, -2, 2.5, 0, 7); g.fill(); }
  const m = pose.mouth || 'smile';
  if (m === 'smile') { g.beginPath(); g.arc(8, 5, 5, 0.2, 1.4); g.stroke(); }
  else if (m === 'grin') { g.fillStyle = '#5a1f1a'; g.beginPath(); g.arc(8, 5, 6, 0, Math.PI); g.fill(); }
  else if (m === 'o') { g.beginPath(); g.ellipse(10, 8, 3, 4, 0, 0, 7); g.fill(); }
  else if (m === 'grit') { g.fillStyle = '#fff'; g.fillRect(5, 5, 9, 4); g.strokeRect(5, 5, 9, 4); }
  else if (m === 'flat') { g.beginPath(); g.moveTo(5, 8); g.lineTo(12, 7); g.stroke(); }
  g.restore();
  // Front arm last.
  const hrh = limb([sh[0] + 2, sh[1] + 6], pose.ra || [0.2, 0.2], UA, FA, 9, look.skin);
  g.restore();
  // Hands in world space, for props.
  const W = ([px, py]) => [x + px * s * dir, y + py * s];
  return { handF: W(hrh), handB: W(hl), head: W(hc), hip: W(hip) };
}
function foot(g, p, col, leg) {
  g.fillStyle = col; g.beginPath(); g.ellipse(p[0] + 5, p[1], 8, 4.5, 0, 0, 7); g.fill();
}
function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => clamp(v + d, 0, 255));
  return `rgb(${c.join(',')})`;
}

// ---- pose library -------------------------------------------------------------------------------
export const P = {
  stand: () => ({}),
  run: (ph) => {
    const s = Math.sin(ph);
    return { rot: 0.25, la: [-s * 1.0, -0.9], ra: [s * 1.0, -0.9], ll: [s * 0.9, -Math.max(0, s) * 1.4 - 0.2], rl: [-s * 0.9, -Math.max(0, -s) * 1.4 - 0.2], mouth: 'grin', eyes: 'happy' };
  },
  walk: (ph) => { const s = Math.sin(ph); return { la: [-s * 0.5, -0.3], ra: [s * 0.5, -0.3], ll: [s * 0.45, -Math.max(0, s) * 0.6], rl: [-s * 0.45, -Math.max(0, -s) * 0.6] }; },
  jump: (k) => ({ la: [2.6, 0.2], ra: [2.8, 0.2], ll: [0.5, -1.2 * k], rl: [0.2, -1.0 * k], mouth: 'grin', eyes: 'happy' }),
  lookUp: () => ({ head: -0.5, eyes: 'up', mouth: 'o', ra: [0.6, 1.8] }),
  // Hugging a trunk: arms up and around, knees drawn up; ph alternates the reach.
  climb: (ph) => { const s = Math.sin(ph); return { rot: 0.1, la: [2.3 + s * 0.3, 0.5], ra: [2.3 - s * 0.3, 0.5], ll: [1.2 - s * 0.3, -1.9], rl: [1.2 + s * 0.3, -1.9], mouth: 'grit' }; },
  slide: () => ({ rot: 0.1, la: [2.9, 0.1], ra: [2.9, 0.1], ll: [0.6, -1.0], rl: [0.9, -1.2], mouth: 'o', eyes: 'wide' }),
  sit: () => ({ drop: 38, ll: [1.4, -1.2], rl: [1.5, -1.3], la: [0.3, 0.4], ra: [0.5, 0.4], eyes: 'x', mouth: 'flat' }),
  twist: (ph) => ({ rot: 0.1, la: [2.2, 0.6], ra: [2.5 + Math.sin(ph) * 0.3, 0.3], ll: [1.2, -1.9], rl: [1.3, -1.9], mouth: 'grit' }),
  bite: () => ({ rot: 0.15, head: 0.25, la: [1.0, 1.6], ra: [1.1, 1.7], mouth: 'grit' }),
  squeeze: (ph) => ({ rot: 0.05, la: [0.9, 1.2 + Math.sin(ph) * 0.15], ra: [0.9, 1.2 - Math.sin(ph) * 0.15], mouth: 'grit', eyes: 'closed' }),
  kick: (k) => ({ rot: -0.15, la: [-0.6, -0.4], ra: [0.8, -0.6], rl: [lerp(0.1, 1.5, k), lerp(0, -0.1, k)], ll: [-0.1, 0], mouth: 'grit' }),
  ow: (ph) => ({ rot: 0.1, ll: [-0.1, 0], rl: [0.8, -2.3], la: [1.0, 1.0], ra: [1.2, 1.1], mouth: 'o', eyes: 'x', drop: Math.abs(Math.sin(ph)) * -10 }),
  crouch: () => ({ drop: 16, rot: 0.5, ll: [0.9, -1.4], rl: [1.1, -1.6], la: [0.7, 0.3], ra: [0.8, 0.2], eyes: 'open', mouth: 'o' }),
  lift: (k) => ({ la: [lerp(0.8, 3.0, k), 0.2], ra: [lerp(0.8, 3.0, k), 0.2], ll: [0.35, -0.2], rl: [-0.1, 0], mouth: 'grit' }),
  bash: (k) => ({ rot: lerp(-0.05, 0.4, k), la: [lerp(3.1, 1.0, k), 0.1], ra: [lerp(3.1, 1.0, k), 0.1], ll: [0.35, -0.2], rl: [-0.1, 0], mouth: 'grit', eyes: 'closed' }),
  drink: () => ({ head: -0.35, la: [2.2, 0.8], ra: [2.3, 0.8], mouth: 'o', eyes: 'happy' }),
  cheer: (ph) => ({ la: [2.8 + Math.sin(ph) * 0.2, 0.1], ra: [2.8 - Math.sin(ph) * 0.2, 0.1], mouth: 'grin', eyes: 'happy', drop: -Math.abs(Math.sin(ph)) * 18 }),
};

// ---- props ----------------------------------------------------------------------------------------
export function corn(g, x, y, h, t, phase = 0) {
  const sway = Math.sin(t * 1.4 + phase + x * 0.013) * 5;
  g.strokeStyle = '#5f8e32'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + sway * 0.4, y - h / 2, x + sway, y - h); g.stroke();
  g.fillStyle = '#6fa83c';
  for (let i = 0; i < 5; i++) {
    const ly = y - h * (0.2 + i * 0.15), side = i % 2 ? 1 : -1, len = 46 - i * 5;
    g.beginPath(); g.moveTo(x + sway * (1 - ly / y), ly);
    g.quadraticCurveTo(x + side * len * 0.6, ly - 22, x + side * len + sway, ly - 6 + Math.sin(t * 2 + i) * 3);
    g.quadraticCurveTo(x + side * len * 0.5, ly - 10, x, ly + 4); g.fill();
  }
  // An ear of corn with husk, and the tassel.
  g.fillStyle = '#e8c33e'; g.beginPath(); g.ellipse(x + 10, y - h * 0.5, 8, 22, 0.25, 0, 7); g.fill();
  g.fillStyle = '#8bb84f'; g.beginPath(); g.ellipse(x + 6, y - h * 0.48, 6, 20, 0.35, 0, 7); g.fill();
  g.strokeStyle = '#c9a44a'; g.lineWidth = 2;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + sway, y - h); g.lineTo(x + sway + k * 7, y - h - 18 + Math.abs(k) * 4); g.stroke(); }
}
export function soil(g, y0, W, H) {
  g.fillStyle = '#8a5a34'; g.fillRect(0, y0, W, H - y0);
  g.fillStyle = '#7a4d2b';
  for (let r = 0; r < 4; r++) g.fillRect(0, y0 + 14 + r * 30, W, 6);
  const q = rng(3); g.fillStyle = '#9c6a40'; for (let i = 0; i < 120; i++) g.fillRect(q() * W, y0 + q() * (H - y0), 4, 3);
}
export function sea(g, y, W, t) {
  const s = g.createLinearGradient(0, y, 0, y + 140);
  s.addColorStop(0, '#3d9ac9'); s.addColorStop(1, '#79c7e0');
  g.fillStyle = s; g.fillRect(0, y, W, 160);
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3;
  for (let r = 0; r < 4; r++) { g.beginPath(); for (let x = 0; x <= W; x += 16) g.lineTo(x, y + 20 + r * 30 + Math.sin(x / 50 + t * 1.5 + r) * 4); g.stroke(); }
}
export function sand(g, y, W, H) {
  g.fillStyle = '#ecd29a'; g.beginPath(); g.moveTo(0, y + 10);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x / 140) * 8);
  g.lineTo(W, H); g.lineTo(0, H); g.fill();
  const q = rng(8); g.fillStyle = '#d9bb7d'; for (let i = 0; i < 90; i++) g.fillRect(q() * W, y + 20 + q() * (H - y), 3, 2);
}
// A palm on a curving trunk: base (bx, by), top (tx, ty), bend control (cx, cy).
export const PALM = { bx: 850, by: 590, cx: 800, cy: 360, tx: 900, ty: 150 };
export function palmPoint(k, p = PALM) {
  const x = (1 - k) ** 2 * p.bx + 2 * (1 - k) * k * p.cx + k * k * p.tx;
  const y = (1 - k) ** 2 * p.by + 2 * (1 - k) * k * p.cy + k * k * p.ty;
  const dx = 2 * (1 - k) * (p.cx - p.bx) + 2 * k * (p.tx - p.cx), dy = 2 * (1 - k) * (p.cy - p.by) + 2 * k * (p.ty - p.cy);
  return { x, y, ang: Math.atan2(dx, -dy) };
}
export function palm(g, t, coconuts = 3, p = PALM) {
  for (let i = 0; i <= 30; i++) {
    const k = i / 30, q = palmPoint(k, p), w = lerp(26, 16, k);
    g.fillStyle = i % 2 ? '#8b6440' : '#7a5636';
    g.save(); g.translate(q.x, q.y); g.rotate(q.ang); g.fillRect(-w / 2, -10, w, 12); g.restore();
  }
  // Fronds.
  g.strokeStyle = '#3f8a3a'; g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.5 + Math.sin(t * 1.2 + i) * 0.04, L = 130;
    const ex = p.tx + Math.cos(a) * L, ey = p.ty + Math.sin(a) * L * 0.6 + 50;
    g.lineWidth = 9; g.beginPath(); g.moveTo(p.tx, p.ty); g.quadraticCurveTo(p.tx + Math.cos(a) * L * 0.6, p.ty + Math.sin(a) * L * 0.5 - 30, ex, ey); g.stroke();
    g.lineWidth = 3; g.strokeStyle = '#5aa84a';
    for (let j = 1; j < 8; j++) {
      const k = j / 8, mx = lerp(p.tx, ex, k), my = lerp(p.ty, ey, k) - Math.sin(k * Math.PI) * 30;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a + 1.2) * 22, my + 16); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a - 1.2) * 22, my + 16); g.stroke();
    }
    g.strokeStyle = '#3f8a3a';
  }
  for (let i = 0; i < coconuts; i++) coconut(g, p.tx - 18 + i * 16, p.ty + 18 + (i % 2) * 8, 1);
}
export function coconut(g, x, y, s = 1, rot = 0, opened = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  if (opened > 0) {
    // Two halves, apart, white flesh showing.
    for (const d of [-1, 1]) {
      g.save(); g.translate(d * 12 * opened, 4 * opened); g.rotate(d * 0.5 * opened);
      g.fillStyle = '#6b4526'; g.beginPath(); g.arc(0, 0, 13, d < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, d < 0 ? Math.PI * 1.5 : Math.PI * 0.5); g.fill();
      g.fillStyle = '#f7f3e8'; g.beginPath(); g.arc(0, 0, 9.5, d < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, d < 0 ? Math.PI * 1.5 : Math.PI * 0.5); g.fill();
      g.restore();
    }
  } else {
    g.fillStyle = '#6b4526'; g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
    g.fillStyle = '#4e3119'; for (const [dx, dy] of [[-4, -4], [3, -5], [0, 1]]) { g.beginPath(); g.arc(dx, dy, 1.8, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(40,24,10,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 9, 0.5, 2.2); g.stroke();
  }
  g.restore();
}
export function stone(g, x, y, s = 1) {
  g.fillStyle = '#8c8a86'; g.beginPath(); g.ellipse(x, y, 16 * s, 11 * s, 0.2, 0, 7); g.fill();
  g.fillStyle = '#a7a5a0'; g.beginPath(); g.ellipse(x - 4 * s, y - 4 * s, 7 * s, 4 * s, 0.2, 0, 7); g.fill();
}
export function stars(g, x, y, t, n = 3, r = 26) {
  g.fillStyle = '#ffd24a';
  for (let i = 0; i < n; i++) {
    const a = t * 5 + i * Math.PI * 2 / n, sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r * 0.4;
    g.beginPath(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? 3 : 8, aa = k * Math.PI / 5; g.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr); } g.fill();
  }
}
export function impact(g, x, y, k, col = '#ffffff') {
  if (k <= 0 || k >= 1) return;
  g.strokeStyle = col; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.3, r0 = 14 + k * 20, r1 = r0 + 18 * (1 - k); g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); g.stroke(); }
}
export function word(g, text, x, y, size, col, k = 1, rot = -0.08) {
  if (k <= 0) return;
  const pop = 1 + 0.3 * Math.sin(clamp(k, 0, 1) * Math.PI);
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(pop, pop);
  g.font = `900 ${size}px "Liberation Sans", Arial, sans-serif`; g.textAlign = 'center';
  g.lineWidth = size * 0.18; g.strokeStyle = '#2a1a10'; g.lineJoin = 'round'; g.strokeText(text, 0, 0);
  g.fillStyle = col; g.fillText(text, 0, 0); g.restore();
}
