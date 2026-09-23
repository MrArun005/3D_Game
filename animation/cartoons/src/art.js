// Flat cartoon drawing kit: every prop and character, drawn with canvas paths.
// Nothing here knows about time except through arguments.

export const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (k) => { k = clamp(k, 0, 1); return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2; };
export const mix = (c1, c2, t) => {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
};
export const W = 1280, H = 720;
const FONT = '"Liberation Sans", Arial, sans-serif';

// ---- landscape ------------------------------------------------------------------------
export function sky(g, top = '#8fc6ea', bottom = '#f3e3c3') {
  const s = g.createLinearGradient(0, 0, 0, H);
  s.addColorStop(0, top); s.addColorStop(0.7, bottom);
  g.fillStyle = s; g.fillRect(0, 0, W, H);
}
export function sun(g, x, y, r = 46, col = '#ffd45e') {
  g.fillStyle = 'rgba(255,220,120,0.25)'; g.beginPath(); g.arc(x, y, r * 1.8, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
export function moon(g, x, y, r = 30) {
  g.fillStyle = '#f4f1e2'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.arc(x + 8, y - 4, r * 0.3, 0, 7); g.fill();
}
export function clouds(g, t, alpha = 1) {
  g.fillStyle = `rgba(255,255,255,${0.85 * alpha})`;
  for (const [x0, y, s] of [[100, 110, 1], [520, 70, 0.8], [900, 130, 1.2], [1250, 90, 0.9]]) {
    const x = ((x0 + t * 12 * s) % (W + 300)) - 150;
    for (const [dx, dy, r] of [[0, 0, 34], [36, -14, 40], [76, 0, 32], [38, 8, 34]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill(); }
  }
}
export function hills(g, layers) {
  // layers: [{ y, amp, len, phase, color }]
  for (const L of layers) {
    g.fillStyle = L.color; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) g.lineTo(x, L.y + Math.sin(x / L.len + L.phase) * L.amp + Math.sin(x / (L.len * 0.37) + L.phase * 2) * L.amp * 0.3);
    g.lineTo(W, H); g.closePath(); g.fill();
  }
}
export function ground(g, y, col = '#b9c26a', col2 = '#a1ab55') {
  g.fillStyle = col; g.fillRect(0, y, W, H - y);
  const r = rng(y);
  g.fillStyle = col2;
  for (let i = 0; i < 90; i++) { g.fillRect(r() * W, y + 6 + r() * (H - y), 3 + r() * 10, 2); }
}
export function river(g, y, col = '#6fb4d8') {
  g.fillStyle = col; g.beginPath(); g.moveTo(0, y);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x / 130) * 8);
  for (let x = W; x >= 0; x -= 20) g.lineTo(x, y + 22 + Math.sin(x / 110 + 1) * 6);
  g.closePath(); g.fill();
}

// ---- plants ------------------------------------------------------------------------------
// A wheat stalk from (x, y) upward. seeds: 0..1 fraction still on the head; big: grain size.
export function wheat(g, x, y, h, t, { sway = 1, seeds = 1, big = 1, ripe = 1, glow = 0, phase = 0 } = {}) {
  const lean = Math.sin(t * 1.6 + phase + x * 0.01) * 6 * sway;
  const tx = x + lean, ty = y - h;
  g.strokeStyle = mix('#7fa650', '#c9a24a', ripe); g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.3, y - h * 0.5, tx, ty); g.stroke();
  // Two leaves.
  g.beginPath(); g.moveTo(x, y - h * 0.3); g.quadraticCurveTo(x - 16, y - h * 0.45, x - 22, y - h * 0.38); g.stroke();
  g.beginPath(); g.moveTo(x + lean * 0.1, y - h * 0.5); g.quadraticCurveTo(x + 18, y - h * 0.62, x + 24, y - h * 0.55); g.stroke();
  if (glow > 0) { g.fillStyle = `rgba(255,220,90,${0.35 * glow})`; g.beginPath(); g.ellipse(tx, ty - 14 * big, 22 * big, 34 * big, 0, 0, 7); g.fill(); }
  const n = 10, col = mix('#9cbf5e', '#e0b44e', ripe);
  for (let i = 0; i < n; i++) {
    if (i / n >= seeds) continue;
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
    const gx = tx + side * 5 * big, gy = ty - k * 7 * big;
    g.fillStyle = col; g.beginPath(); g.ellipse(gx, gy, 4.2 * big, 7 * big, side * 0.4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(120,80,20,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(gx, gy - 6 * big); g.lineTo(gx + side * 3, gy - 18 * big); g.stroke();
  }
  return [tx, ty];
}
export function grain(g, x, y, big = 1, col = '#e0b44e', rot = 0) {
  g.fillStyle = col; g.beginPath(); g.ellipse(x, y, 4.2 * big, 7 * big, rot, 0, 7); g.fill();
}
export function bush(g, x, y, s = 1, berries = true) {
  g.fillStyle = '#5f8f3e';
  for (const [dx, dy, r] of [[-30, 0, 30], [0, -18, 36], [32, 0, 30], [0, 6, 30]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill(); }
  if (berries) { g.fillStyle = '#c8344a'; const r = rng(x | 0); for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(x + (r() - 0.5) * 80 * s, y - 20 * s + (r() - 0.5) * 40 * s, 5 * s, 0, 7); g.fill(); } }
}

// ---- people -----------------------------------------------------------------------------------
// A cartoon person standing on (x, y). pose: { walk: phase or null, dir: 1/-1, reach: 0..1, wave: 0..1,
// bend: 0..1, carry: bool }. look: { skin, hair, tunic, s (scale), bun, beard }.
export function person(g, x, y, look, pose = {}) {
  const s = look.s || 1, dir = pose.dir || 1;
  const walk = pose.walk;
  const sw = walk == null ? 0 : Math.sin(walk);
  const bob = walk == null ? 0 : Math.abs(Math.cos(walk)) * 3 * s;
  g.save(); g.translate(x, y - bob); g.scale(dir * s, s);
  const bend = pose.bend || 0;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // Legs.
  g.strokeStyle = look.skin; g.lineWidth = 9;
  for (const k of [-1, 1]) {
    const a = sw * 0.45 * k;
    g.beginPath(); g.moveTo(0, -48); g.lineTo(Math.sin(a) * 26, -48 + Math.cos(a) * 26); g.lineTo(Math.sin(a) * 44 + (k * sw > 0 ? 3 : 0), -3); g.stroke();
  }
  g.fillStyle = '#5a3d27'; for (const k of [-1, 1]) { const a = sw * 0.45 * k; g.beginPath(); g.ellipse(Math.sin(a) * 44 + 4, -2, 8, 4, 0, 0, 7); g.fill(); }
  g.save(); g.translate(0, -48); g.rotate(bend * 0.6);
  // Tunic.
  g.fillStyle = look.tunic;
  g.beginPath(); g.moveTo(-15, -52); g.lineTo(15, -52); g.lineTo(21, 6); g.lineTo(-21, 6); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(-19, -8, 38, 5);
  // Arms. Angle is measured from straight down, positive = forward.
  g.strokeStyle = look.skin; g.lineWidth = 8;
  const arm = (sx, th) => {
    const ex = sx + Math.sin(th - 0.25) * 17, ey = -46 + Math.cos(th - 0.25) * 17;
    const hx = sx + Math.sin(th) * 34, hy = -46 + Math.cos(th) * 34;
    g.beginPath(); g.moveTo(sx, -46); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
    return [hx, hy];
  };
  arm(-4, walk == null ? -0.15 : -sw * 0.5);
  let fa = walk == null ? 0.2 : sw * 0.5;
  if (pose.reach) fa = lerp(fa, 1.9, pose.reach);
  if (pose.wave) fa = lerp(fa, 2.7 + Math.sin(pose.wave * 20) * 0.25, Math.min(1, pose.wave * 4));
  if (pose.carry) fa = 1.1;
  const [hx, hy] = arm(6, fa);
  if (pose.carry) basket(g, hx + 8, hy + 16, 0.8, pose.basketFill || 0);
  // Head.
  g.fillStyle = look.skin; g.beginPath(); g.arc(2, -72, 17, 0, 7); g.fill();
  g.fillStyle = look.hair;
  g.beginPath(); g.arc(0, -76, 17.5, Math.PI * 0.95, Math.PI * 2.1); g.fill();
  if (look.bun) { g.beginPath(); g.arc(-14, -86, 8, 0, 7); g.fill(); }
  if (look.long) { g.fillRect(-17, -76, 9, 26); }
  if (look.beard) { g.beginPath(); g.arc(4, -64, 12, 0.1, Math.PI - 0.1); g.fill(); }
  g.fillStyle = '#1d1a18'; g.beginPath(); g.arc(9, -73, 2.4, 0, 7); g.fill();
  g.strokeStyle = '#1d1a18'; g.lineWidth = 2; g.beginPath(); g.arc(8, -66, 5, 0.2, 1.3); g.stroke();
  g.restore(); g.restore();
}
export const ANA = { skin: '#c98d62', hair: '#2f2118', tunic: '#b8653a', bun: true };
export const DAD = { skin: '#b57a52', hair: '#3a281c', tunic: '#7a6a4a', beard: true };
export const KID = { skin: '#c98d62', hair: '#2f2118', tunic: '#5f8f7a', s: 0.62 };
export const GRAN = { skin: '#b98a66', hair: '#d9d4cc', tunic: '#8f5b6a', long: true, s: 0.95 };

export function basket(g, x, y, s = 1, fill = 0) {
  g.save(); g.translate(x, y); g.scale(s, s);
  if (fill > 0) { g.fillStyle = '#e0b44e'; g.beginPath(); g.ellipse(0, -14, 20, 6 + 6 * fill, 0, Math.PI, 0); g.fill(); }
  g.fillStyle = '#a8793f'; g.beginPath(); g.moveTo(-22, -14); g.lineTo(22, -14); g.lineTo(16, 12); g.lineTo(-16, 12); g.closePath(); g.fill();
  g.strokeStyle = '#7e5629'; g.lineWidth = 2;
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-20, i * 8); g.lineTo(20, i * 8); g.stroke(); }
  g.restore();
}

// ---- dwellings, animals, things -----------------------------------------------------------------
export function tent(g, x, y, s = 1, col = '#a4835c') {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = col; g.beginPath(); g.moveTo(-70, 0); g.quadraticCurveTo(-40, -70, 0, -96); g.quadraticCurveTo(40, -70, 70, 0); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(-14, 0); g.lineTo(0, -52); g.lineTo(14, 0); g.fill();
  g.strokeStyle = '#6b4f30'; g.lineWidth = 4; g.beginPath(); g.moveTo(-6, -90); g.lineTo(-16, -116); g.moveTo(6, -90); g.lineTo(16, -116); g.stroke();
  g.strokeStyle = 'rgba(80,55,30,0.35)'; g.lineWidth = 2;
  for (const k of [-40, 40]) { g.beginPath(); g.moveTo(k, -30); g.quadraticCurveTo(k * 0.5, -60, 0, -86); g.stroke(); }
  g.restore();
}
export function house(g, x, y, s = 1, rise = 1) {
  const h = 110 * rise;
  if (h <= 1) return;
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#c99a63'; g.fillRect(-70, -h, 140, h);
  g.fillStyle = '#b3844f';
  for (let r = 0; r * 16 < h; r++) for (let c = 0; c < 6; c++) g.fillRect(-70 + c * 24 + (r % 2) * 12, -h + r * 16, 22, 2);
  if (rise > 0.95) {
    g.fillStyle = '#8c6a3f'; g.fillRect(-78, -h - 10, 156, 12);
    g.fillStyle = '#4d3520'; g.beginPath(); g.moveTo(-16, 0); g.lineTo(-16, -52); g.arc(0, -52, 16, Math.PI, 0); g.lineTo(16, 0); g.fill();
    g.fillStyle = '#4d3520'; g.fillRect(34, -80, 18, 18);
  }
  g.restore();
}
export function sheep(g, x, y, s = 1, t = 0, dir = 1) {
  g.save(); g.translate(x, y); g.scale(dir * s, s);
  g.strokeStyle = '#3a332e'; g.lineWidth = 5;
  for (const lx of [-18, -6, 10, 22]) { const a = Math.sin(t * 8 + lx) * 0.2; g.beginPath(); g.moveTo(lx, -12); g.lineTo(lx + Math.sin(a) * 10, 0); g.stroke(); }
  g.fillStyle = '#f2efe6';
  for (const [dx, dy, r] of [[-18, -26, 14], [0, -32, 16], [18, -26, 14], [-8, -18, 14], [10, -18, 14]]) { g.beginPath(); g.arc(dx, dy, r, 0, 7); g.fill(); }
  g.fillStyle = '#3a332e'; g.beginPath(); g.ellipse(34, -30, 10, 8, 0.3, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(37, -32, 1.8, 0, 7); g.fill();
  g.restore();
}
export function goat(g, x, y, s = 1, t = 0, dir = 1) {
  g.save(); g.translate(x, y); g.scale(dir * s, s);
  g.strokeStyle = '#5b4332'; g.lineWidth = 5;
  for (const lx of [-18, -6, 10, 20]) { const a = Math.sin(t * 8 + lx) * 0.25; g.beginPath(); g.moveTo(lx, -14); g.lineTo(lx + Math.sin(a) * 10, 0); g.stroke(); }
  g.fillStyle = '#8b6a4f'; g.beginPath(); g.ellipse(0, -26, 28, 15, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(30, -40, 10, 8, -0.5, 0, 7); g.fill();
  g.strokeStyle = '#3d2f25'; g.lineWidth = 3; g.beginPath(); g.moveTo(28, -46); g.quadraticCurveTo(24, -62, 14, -60); g.stroke();
  g.fillStyle = '#e8e0d4'; g.beginPath(); g.moveTo(36, -34); g.lineTo(34, -24); g.lineTo(40, -32); g.fill();
  g.restore();
}
export function gazelle(g, x, y, s = 1, t = 0, dir = 1) {
  g.save(); g.translate(x, y); g.scale(dir * s, s);
  const run = Math.sin(t * 14);
  g.strokeStyle = '#a7773f'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(-18, -28); g.lineTo(-30 - run * 12, -2); g.moveTo(18, -28); g.lineTo(30 + run * 12, -2); g.stroke();
  g.fillStyle = '#d19a55'; g.beginPath(); g.ellipse(0, -34, 28, 12, 0, 0, 7); g.fill();
  g.fillStyle = '#f3e6cf'; g.beginPath(); g.ellipse(0, -28, 22, 5, 0, 0, 7); g.fill();
  g.fillStyle = '#d19a55'; g.beginPath(); g.moveTo(20, -40); g.lineTo(34, -62); g.lineTo(42, -58); g.lineTo(30, -36); g.fill();
  g.beginPath(); g.ellipse(40, -62, 9, 6, 0.3, 0, 7); g.fill();
  g.strokeStyle = '#3d2f25'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(38, -67); g.quadraticCurveTo(34, -86, 40, -92); g.stroke();
  g.restore();
}
export function jar(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#b86b3f'; g.beginPath(); g.moveTo(-10, -48); g.lineTo(10, -48); g.quadraticCurveTo(28, -30, 18, 0); g.lineTo(-18, 0); g.quadraticCurveTo(-28, -30, -10, -48); g.fill();
  g.fillStyle = '#8d4c2a'; g.fillRect(-12, -52, 24, 6);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-18, -26); g.lineTo(18, -26); g.stroke();
  g.restore();
}
export function fence(g, x0, x1, y) {
  g.strokeStyle = '#7e5a36'; g.lineWidth = 5;
  for (let x = x0; x <= x1; x += 40) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 40); g.stroke(); }
  g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y - 30); g.lineTo(x1, y - 30); g.moveTo(x0, y - 14); g.lineTo(x1, y - 14); g.stroke();
}

// ---- text and labels --------------------------------------------------------------------------
export function label(g, text, x, y, { size = 30, color = '#2a241f', bg = 'rgba(255,250,240,0.9)', alpha = 1, align = 'center' } = {}) {
  if (alpha <= 0) return;
  g.save(); g.globalAlpha = alpha; g.font = `bold ${size}px ${FONT}`;
  const w = g.measureText(text).width + size * 0.9, h = size * 1.45;
  const lx = align === 'center' ? x - w / 2 : x;
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(lx, y - h * 0.72, w, h, 12); g.fill(); }
  g.fillStyle = color; g.textAlign = 'left'; g.fillText(text, lx + size * 0.45, y + size * 0.02);
  g.restore();
}
export function title(g, text, x, y, size, color, alpha = 1, stroke = '#fff') {
  g.save(); g.globalAlpha = alpha; g.font = `bold ${size}px ${FONT}`; g.textAlign = 'center';
  g.lineWidth = size * 0.16; g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y); g.restore();
}

// ---- Clawd, the teacher (same sprite as the whiteboard stories) ----------------------------------
export function clawd(g, x, y, cell, t, { talking = false, hop = 0, wave = false, dir = 1 } = {}) {
  const GW = 11, ORANGE = '#cc7f61', TOP = '#dd9a80';
  const bob = talking ? -Math.abs(Math.sin(t * 14)) * 0.4 : 0;
  const baseY = y - 10.8 * cell - hop;
  const px = (cx, cy, w, h, col = ORANGE) => {
    const X = dir > 0 ? cx : GW - cx - w;
    g.fillStyle = col; g.fillRect(Math.round(x + X * cell), Math.round(baseY + (cy + bob) * cell), Math.ceil(w * cell), Math.ceil(h * cell));
  };
  g.fillStyle = `rgba(0,0,0,${0.18 - hop / 500})`; g.beginPath(); g.ellipse(x + 5.5 * cell, y + 2, 5 * cell, cell * 0.6, 0, 0, 7); g.fill();
  px(1, 0, 9, 8); px(1, 0, 9, 0.35, TOP);
  px(0, 3, 1, 2.4);
  if (wave) { const up = Math.sin(t * 10) > 0; px(10, up ? 0.8 : 1.6, 1.4, 1.4); } else px(10, 3, 1, 2.4);
  for (const lx of [1, 3, 7, 9]) px(lx, 8, 0.95, 2.8);
  const blink = (t % 3.1) < 0.13;
  const eh = blink ? 0.35 : 1.4, ey = 3.1 + (blink ? 0.6 : 0);
  px(1.9, ey, 1.1, eh, '#111'); px(8.0, ey, 1.1, eh, '#111');
}
