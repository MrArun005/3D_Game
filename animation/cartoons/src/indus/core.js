// Core of the "rich" cartoon engine: a 1080p canvas, a parallax camera, cached
// layers, procedural textures (baked brick, mud plaster, grain), light and
// atmosphere helpers, particles and the final colour grade.
export const W = 1920, H = 1080;
export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
export const easeOut = (k) => 1 - (1 - clamp(k, 0, 1)) ** 3;
export const easeIn = (k) => clamp(k, 0, 1) ** 3;
export const seg = (t, a, b) => ease((t - a) / (b - a));
export const lin = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
export const fade = (t, t0, d = 0.3) => clamp((t - t0) / d, 0, 1);
export const win = (t, a, b, d = 0.3) => fade(t, a, d) * (1 - fade(t, b - d, d));
export const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function mix(c1, c2, t) { const a = hex(c1), b = hex(c2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t, 0, 1)).toString(16).padStart(2, '0')).join(''); }
export const shade = (c, k) => (k > 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k));
export const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
export const FONT = '"Liberation Sans", Arial, sans-serif';
export const SERIF = '"Liberation Serif", Georgia, serif';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const CACHE = new Map();
export function cached(key, w, h, draw) {
  let c = CACHE.get(key);
  if (!c) { c = canvas(w, h); draw(c.getContext('2d'), c); CACHE.set(key, c); }
  return c;
}

// ---- camera ---------------------------------------------------------------------------------------------
// World units on the action plane are pixels at zoom 1. A layer with parallax p moves p times as far as
// the action plane and zooms 1 + (z - 1) p, so p = 0 is the sky and p > 1 is foreground.
export const cam = { x: 0, y: 0, z: 1, sx: 0, sy: 0 };
let SHAKE = [0, 0];
export function setShake(v) { SHAKE = v; }
export function setCam(x, y, z = 1) { Object.assign(cam, { x, y, z, sx: SHAKE[0], sy: SHAKE[1] }); }
export function layer(g, p, fn) {
  const z = 1 + (cam.z - 1) * p;
  g.save(); g.translate(W / 2 + cam.sx * p, H / 2 + cam.sy * p); g.scale(z, z); g.translate(-cam.x * p, -cam.y * p);
  fn(z); g.restore();
}
export function toScreen(x, y, p = 1) {
  const z = 1 + (cam.z - 1) * p;
  return [W / 2 + cam.sx * p + (x - cam.x * p) * z, H / 2 + cam.sy * p + (y - cam.y * p) * z];
}
export function shakeFrom(t, impacts) {
  let sx = 0, sy = 0;
  for (const [t0, k] of impacts) { const u = t - t0; if (u > 0 && u < 0.5) { const e = k * Math.exp(-u * 8); sx += Math.sin(u * 83) * e; sy += Math.cos(u * 67) * e; } }
  return [sx, sy];
}

// ---- textures ---------------------------------------------------------------------------------------------
// Baked brick in the Indus 4:2:1 proportion (a stretcher face is 4 x 1), laid in English bond:
// a course of stretchers, then a course of headers (2 x 1).
export function brickTile(tint = '#b4643f', mortar = '#caa27a', seed = 1) {
  return cached(`brick${tint}${mortar}${seed}`, 192, 48, (g) => {
    const r = rng(seed);
    g.fillStyle = mortar; g.fillRect(0, 0, 192, 48);
    const course = (y, len) => {
      for (let x = (y / 12) % 2 ? -len / 2 : 0; x < 192; x += len) {
        const v = (r() - 0.5) * 0.22, burnt = r() < 0.12;
        g.fillStyle = shade(burnt ? mix(tint, '#5a2a1a', 0.45) : tint, v);
        g.fillRect(x + 1.2, y + 1.2, len - 2.4, 12 - 2.4);
        g.fillStyle = 'rgba(255,230,190,0.16)'; g.fillRect(x + 1.2, y + 1.2, len - 2.4, 2);
        g.fillStyle = 'rgba(40,15,5,0.18)'; g.fillRect(x + 1.2, y + 8.6, len - 2.4, 2);
        for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,220,180' : '60,25,10'},${0.12 + r() * 0.15})`; g.fillRect(x + 2 + r() * (len - 5), y + 2 + r() * 7, 1.6, 1.6); }
      }
    };
    course(0, 48); course(12, 24); course(24, 48); course(36, 24);
  });
}
export function pattern(g, tile, scale = 1, ox = 0, oy = 0) {
  const p = g.createPattern(tile, 'repeat');
  p.setTransform(new DOMMatrix().translate(ox, oy).scale(scale));
  return p;
}
export function noiseTile(seed = 3, size = 256, amp = 1) {
  return cached(`noise${seed}${size}${amp}`, size, size, (g) => {
    const d = g.createImageData(size, size), r = rng(seed);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - 0.5) * 255 * amp; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  });
}
// Mud plaster / packed earth: soft blotches over a base colour.
export function mudTile(base = '#c9a57a', seed = 5) {
  return cached(`mud${base}${seed}`, 256, 256, (g) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const x = r() * 256, y = r() * 256, rr = 4 + r() * 22, dark = r() < 0.5;
      g.fillStyle = dark ? `rgba(70,40,15,${0.03 + r() * 0.05})` : `rgba(255,235,200,${0.03 + r() * 0.06})`;
      for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { g.beginPath(); g.ellipse(x + dx, y + dy, rr, rr * 0.6, r() * 3, 0, TAU); g.fill(); }
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '60,35,15' : '255,240,210'},${0.08 + r() * 0.12})`; g.fillRect(r() * 256, r() * 256, 1.5, 1.5); }
  });
}

// ---- light and atmosphere ---------------------------------------------------------------------------------------
export function sky(g, stops) {
  const s = g.createLinearGradient(0, 0, 0, H);
  for (const [k, c] of stops) s.addColorStop(k, c);
  g.fillStyle = s; g.fillRect(0, 0, W, H);
}
export function glow(g, x, y, r, col, a, op = 'lighter') {
  const q = g.createRadialGradient(x, y, 0, x, y, r);
  q.addColorStop(0, rgba(col, a)); q.addColorStop(0.35, rgba(col, a * 0.45)); q.addColorStop(1, rgba(col, 0));
  g.save(); g.globalCompositeOperation = op; g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
}
export function sunDisc(g, x, y, r, core = '#fff4d6', halo = '#ffb86b', a = 1) {
  glow(g, x, y, r * 9, halo, 0.35 * a);
  glow(g, x, y, r * 3.2, '#ffe2a8', 0.55 * a);
  g.save(); g.globalAlpha = a; g.fillStyle = core; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.restore();
}
// God rays: soft wedges fanning from the sun.
export function rays(g, x, y, t, a = 0.08, col = '#ffd9a0', n = 9, len = 2200) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ang = Math.PI * 0.55 + (i / (n - 1)) * Math.PI * 0.9 + Math.sin(t * 0.13 + i * 1.7) * 0.03;
    const w = 0.035 + 0.03 * Math.sin(i * 2.3 + 1);
    const q = g.createRadialGradient(x, y, 0, x, y, len);
    const k = a * (0.6 + 0.4 * Math.sin(t * 0.4 + i * 3.1));
    q.addColorStop(0, rgba(col, k)); q.addColorStop(1, rgba(col, 0));
    g.fillStyle = q; g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang - w) * len, y + Math.sin(ang - w) * len); g.lineTo(x + Math.cos(ang + w) * len, y + Math.sin(ang + w) * len); g.closePath(); g.fill();
  }
  g.restore();
}
// Soft painted cloud banks: flat-bottomed, one gradient over the whole shape (lit from `litSide`),
// a bright rim where the sun catches the edge, blurred once when cached.
export function cloud(g, x, y, w, seed, lit = '#fff1dc', dark = '#c98d7a', a = 1, rim = '#ffe2b0') {
  const c = cached(`cloud${seed}${lit}${dark}${rim}`, 640, 240, (cg) => {
    const r = rng(seed), shape = canvas(640, 240), sg = shape.getContext('2d');
    sg.fillStyle = '#fff';
    const n = 18;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1), px = 50 + k * 540 + (r() - 0.5) * 30, hump = Math.sin(k * Math.PI) ** 0.7;
      const pr = (18 + r() * 26) + hump * 42, py = 175 - pr * 0.55 - hump * 30;
      sg.beginPath(); sg.ellipse(px, py, pr * 1.5, pr, 0, 0, TAU); sg.fill();
    }
    sg.fillRect(40, 150, 560, 30);                                  // flat base
    sg.globalCompositeOperation = 'destination-out'; sg.fillRect(0, 186, 640, 60);
    sg.globalCompositeOperation = 'source-atop';
    const q = sg.createLinearGradient(0, 40, 0, 186); q.addColorStop(0, dark); q.addColorStop(0.7, mix(dark, lit, 0.55)); q.addColorStop(1, lit);
    sg.fillStyle = q; sg.fillRect(0, 0, 640, 240);
    // Rim light along the underside.
    const rq = sg.createLinearGradient(0, 150, 0, 186); rq.addColorStop(0, rgba(rim, 0)); rq.addColorStop(1, rgba(rim, 0.9));
    sg.fillStyle = rq; sg.fillRect(0, 150, 640, 40);
    cg.filter = 'blur(3px)'; cg.drawImage(shape, 0, 0); cg.filter = 'none';
  });
  g.save(); g.globalAlpha = a; g.drawImage(c, x - w / 2, y - w * 0.19, w, w * 0.375); g.restore();
}
// Draw into a reusable offscreen layer, then composite it blurred (depth of field).
const BL = [];
export function blurred(g, px, fn, a = 1) {
  if (!BL[0]) BL[0] = canvas(W, H);
  const bc = BL[0], bg = bc.getContext('2d');
  bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, W, H);
  fn(bg);
  g.save(); g.globalAlpha = a; g.filter = `blur(${px}px)`; g.drawImage(bc, 0, 0); g.restore();
}
export function haze(g, y0, y1, col, a) {
  const q = g.createLinearGradient(0, y0, 0, y1);
  q.addColorStop(0, rgba(col, 0)); q.addColorStop(1, rgba(col, a));
  g.fillStyle = q; g.fillRect(-5000, y0, 10000, y1 - y0);
}
export function softShadow(g, x, y, rx, ry, a = 0.28) {
  const q = g.createRadialGradient(x, y, 0, x, y, rx);
  q.addColorStop(0, `rgba(30,15,5,${a})`); q.addColorStop(1, 'rgba(30,15,5,0)');
  g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
  g.fillStyle = q; g.beginPath(); g.arc(x, y, rx, 0, TAU); g.fill(); g.restore();
}

// ---- particles -------------------------------------------------------------------------------------------------------
// Dust motes drifting in sunlight (screen space).
export function motes(g, t, n = 60, col = '#ffe7b8', a = 0.5, seed = 9, box = [0, 0, W, H]) {
  const r = rng(seed);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x0 = r(), y0 = r(), sp = 6 + r() * 14, sz = 1 + r() * 2.6, ph = r() * 10;
    const x = box[0] + (((x0 * box[2] + t * sp + Math.sin(t * 0.7 + ph) * 18) % box[2]) + box[2]) % box[2];
    const y = box[1] + (((y0 * box[3] - t * sp * 0.4 + Math.cos(t * 0.5 + ph) * 14) % box[3]) + box[3]) % box[3];
    g.fillStyle = rgba(col, a * (0.4 + 0.6 * Math.sin(t * 1.3 + ph) ** 2));
    g.beginPath(); g.arc(x, y, sz, 0, TAU); g.fill();
  }
  g.restore();
}
// A flock: V-shaped birds flapping along a path.
export function birds(g, t, x0, y0, vx, vy, n = 9, s = 1, col = '#2a2233', seed = 4) {
  const r = rng(seed);
  g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const ox = (r() - 0.5) * 220 * s, oy = (r() - 0.5) * 90 * s, ph = r() * TAU, sz = (8 + r() * 5) * s;
    const x = x0 + vx * t + ox + Math.sin(t * 0.8 + ph) * 10 * s, y = y0 + vy * t + oy + Math.cos(t * 1.1 + ph) * 6 * s;
    const f = Math.sin(t * 9 + ph);
    g.lineWidth = 2.4 * s;
    g.beginPath(); g.moveTo(x - sz, y - f * sz * 0.6); g.quadraticCurveTo(x - sz * 0.4, y - sz * 0.25, x, y); g.quadraticCurveTo(x + sz * 0.4, y - sz * 0.25, x + sz, y - f * sz * 0.6); g.stroke();
  }
}

// ---- grade --------------------------------------------------------------------------------------------------------------
export function grade(g, t, { warm = 0.1, vignette = 0.45, tint = '#ffb070', grain = 0.035, lift = 0 } = {}) {
  if (warm > 0) { g.save(); g.globalCompositeOperation = 'soft-light'; g.fillStyle = rgba(tint, warm); g.fillRect(0, 0, W, H); g.restore(); }
  if (lift > 0) { g.fillStyle = `rgba(40,30,60,${lift})`; g.fillRect(0, 0, W, H); }
  if (vignette > 0) {
    const q = g.createRadialGradient(W / 2, H * 0.52, H * 0.35, W / 2, H / 2, H * 1.05);
    q.addColorStop(0, 'rgba(20,10,5,0)'); q.addColorStop(1, `rgba(20,10,5,${vignette})`);
    g.fillStyle = q; g.fillRect(0, 0, W, H);
  }
  if (grain > 0) {
    const n = noiseTile(3, 256, 1), f = Math.floor(t * 30);
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = grain;
    g.fillStyle = pattern(g, n, 1, (f * 97) % 256, (f * 61) % 256); g.fillRect(0, 0, W, H); g.restore();
  }
}
export function letterbox(g, k) { if (k <= 0) return; const h = 70 * k; g.fillStyle = '#000'; g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h); }

// ---- type -----------------------------------------------------------------------------------------------------------------
export function text(g, s, x, y, { size = 48, font = FONT, weight = '700', col = '#fff', stroke = null, sw = 0, align = 'center', a = 1, shadow = 0.5, spacing = 0 } = {}) {
  if (a <= 0) return;
  g.save(); g.globalAlpha = a; g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'alphabetic';
  if (spacing) g.letterSpacing = `${spacing}px`;
  if (shadow) { g.shadowColor = `rgba(0,0,0,${shadow})`; g.shadowBlur = size * 0.35; g.shadowOffsetY = size * 0.06; }
  if (stroke) { g.lineJoin = 'round'; g.lineWidth = sw; g.strokeStyle = stroke; g.strokeText(s, x, y); g.shadowColor = 'transparent'; }
  g.fillStyle = col; g.fillText(s, x, y); g.restore();
}
