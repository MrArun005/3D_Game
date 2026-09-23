// "The First Pet": a caveman, a thieving wolf pup, two failed traps, and the night
// the pup saved him. Wordless slapstick with a few speech bubbles; vertical 9:16.
// Every beat time lives in stories/firstpet.beats.json, shared with the soundtrack.
import * as A from './art.js';
import * as Hm from './humans.js';
import B from '../stories/firstpet.beats.json' with { type: 'json' };
import timing from '../stories/firstpet.timing.json' with { type: 'json' };

const { clamp, lerp, ease, rng } = A;
const { P } = Hm;
const W = 720, H = 1280, FPS = 30, DURATION = B.duration;
const c = document.getElementById('c'); c.width = W; c.height = H;
const g = c.getContext('2d');
const FONT = '"Liberation Sans", Arial, sans-serif';
const VO = Object.fromEntries(timing.lines.map((l) => [l.id, l]));
const fade = (t, t0, d = 0.3) => clamp((t - t0) / d, 0, 1);
const seg = (t, a, b) => ease(clamp((t - a) / (b - a), 0, 1));
const OOG = { skin: '#a5693f', hairCol: '#1d140f', hair: 'curly', s: 1.25, brow: true, nose: true };

// ---- camera ------------------------------------------------------------------------------------------
// World units: ground at y = 0, Oog ~200 tall. A camera is { x, y, z } plus shake.
const IMPACTS = [[B.chomp, 5], [B.plant, 12], [B.slam, 9], [B.land, 14], [B.woof, 7]];
function shake(t) {
  let sx = 0, sy = 0;
  for (const [t0, k] of IMPACTS) { const u = t - t0; if (u > 0 && u < 0.45) { const e = k * Math.exp(-u * 9); sx += Math.sin(u * 90) * e; sy += Math.cos(u * 70) * e; } }
  return [sx, sy];
}
let CAM = { x: 0, y: -110, z: 2, sx: 0, sy: 0 };
const setCam = (t, x, z, gy = 1000) => { const [sx, sy] = shake(t); CAM = { x, y: -(gy - H / 2) / z, z, sx, sy }; };
const toScreen = (x, y) => [W / 2 + CAM.sx + (x - CAM.x) * CAM.z, H / 2 + CAM.sy + (y - CAM.y) * CAM.z];
function world(g, fn) {
  g.save(); g.translate(W / 2 + CAM.sx, H / 2 + CAM.sy); g.scale(CAM.z, CAM.z); g.translate(-CAM.x, -CAM.y); fn(); g.restore();
}

// ---- sets ------------------------------------------------------------------------------------------------
const TOD = {
  day:     { sky: ['#5fb4ea', '#d6eff7'], far: '#a9cf8a', near: '#86b666', ground: '#8db35a', tuft: '#739a45', trees: '#4f8a44' },
  dusk:    { sky: ['#3e2f70', '#f59063'], far: '#8a6278', near: '#6c5068', ground: '#7a7a48', tuft: '#63653a', trees: '#4c4a4e' },
  night:   { sky: ['#1b2658', '#3b4c8a'], far: '#2a3a5a', near: '#22314a', ground: '#3a4a3a', tuft: '#2e3c2f', trees: '#1f2c30' },
  morning: { sky: ['#7cc0ec', '#ffd49a'], far: '#b7c98a', near: '#94b86a', ground: '#93b65c', tuft: '#789c47', trees: '#588f48' },
};
function backdrop(g, tod, t) {
  const p = TOD[tod];
  const s = g.createLinearGradient(0, 0, 0, H * 0.75);
  s.addColorStop(0, p.sky[0]); s.addColorStop(1, p.sky[1]);
  g.fillStyle = s; g.fillRect(0, 0, W, H);
  const [, y0] = toScreen(0, 0);                        // the horizon on screen
  if (tod === 'day' || tod === 'morning') {
    const sy = tod === 'day' ? 170 : y0 - 330;
    g.fillStyle = 'rgba(255,230,150,0.3)'; g.beginPath(); g.arc(560, sy, 110, 0, 7); g.fill();
    g.fillStyle = tod === 'day' ? '#fff3b0' : '#ffd66e'; g.beginPath(); g.arc(560, sy, 62, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [x0, y, k] of [[80, 260, 1], [420, 150, 0.8], [700, 330, 1.1]]) {
      const x = ((x0 + t * 10 * k) % (W + 260)) - 130;
      for (const [dx, dy, r] of [[0, 0, 36], [40, -16, 44], [84, 0, 34], [42, 10, 36]]) { g.beginPath(); g.arc(x + dx * k, y + dy * k, r * k, 0, 7); g.fill(); }
    }
  }
  if (tod === 'dusk') { g.fillStyle = '#ffb36b'; g.beginPath(); g.arc(200, y0 - 60, 70, 0, 7); g.fill(); }
  // Two ranges of hills with a little parallax.
  for (const [amp, base, len, col, par] of [[70, 150, 190, p.far, 0.12], [40, 60, 130, p.near, 0.25]]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, y0 + 2);
    for (let x = 0; x <= W; x += 12) { const u = x + CAM.x * par * CAM.z; g.lineTo(x, y0 - base * 0.6 - Math.sin(u / len) * amp * 0.5 - Math.sin(u / (len * 0.43) + 1) * amp * 0.25); }
    g.lineTo(W, y0 + 2); g.closePath(); g.fill();
  }
}
function groundPlane(g, tod) {
  const p = TOD[tod];
  g.fillStyle = p.ground; g.fillRect(CAM.x - 2000, 0, 4000, 2000);
  const dk = g.createLinearGradient(0, 0, 0, 600); dk.addColorStop(0, 'rgba(0,0,0,0)'); dk.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = dk; g.fillRect(CAM.x - 2000, 0, 4000, 2000);
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(CAM.x - 2000, 0, 4000, 10);
  g.strokeStyle = p.tuft; g.lineWidth = 2.5; g.lineCap = 'round';
  const x0 = Math.floor((CAM.x - 800) / 37) * 37;
  for (let x = x0; x < CAM.x + 800; x += 37) {
    const r = rng(Math.abs(x) * 7 + 3), gx = x + r() * 30, gy = 14 + r() * 260;
    for (const d of [-5, 0, 5]) { g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + d * 1.2, gy - 9 - r() * 6); g.stroke(); }
  }
}
function foreground(g, tod) {
  const p = TOD[tod], sp = 150, off = -CAM.x * CAM.z * 1.25;
  const x0 = Math.floor(-off / sp) - 1;
  for (let i = x0; i < x0 + W / sp + 3; i++) {
    const r = rng(Math.abs(i) * 13 + 5), x = i * sp + off + r() * 60, y = H - 30 - r() * 60, s = 1 + r() * 0.8;
    g.fillStyle = p.tuft;
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(x + k * 9 * s - 6, y + 40); g.quadraticCurveTo(x + k * 12 * s, y - 40 * s, x + k * 16 * s + 4, y - (70 - Math.abs(k) * 12) * s); g.quadraticCurveTo(x + k * 10 * s + 4, y - 20 * s, x + k * 9 * s + 6, y + 40); g.fill(); }
    if (r() < 0.45 && tod !== 'night') { g.fillStyle = r() < 0.5 ? '#f5d34a' : '#f3f0e6'; g.beginPath(); g.arc(x + 20 * s, y - 50 * s, 7 * s, 0, 7); g.fill(); g.fillStyle = '#e39b2a'; g.beginPath(); g.arc(x + 20 * s, y - 50 * s, 2.5 * s, 0, 7); g.fill(); }
  }
}
function seat(g, x) {
  g.fillStyle = '#6b4a2e'; g.beginPath(); g.roundRect(x - 34, -30, 68, 30, 12); g.fill();
  g.fillStyle = '#c9a26a'; g.beginPath(); g.ellipse(x + 30, -15, 7, 14, 0, 0, 7); g.fill();
  g.strokeStyle = '#8a6440'; g.lineWidth = 2; g.beginPath(); g.ellipse(x + 30, -15, 3.5, 7, 0, 0, 7); g.stroke();
}
function tree(g, x, s, col) {
  g.fillStyle = '#6b4a2e'; g.fillRect(x - 7 * s, -90 * s, 14 * s, 90 * s);
  g.fillStyle = col;
  for (const [dx, dy, r] of [[0, -130, 52], [-40, -105, 38], [40, -105, 40], [0, -170, 38]]) { g.beginPath(); g.arc(x + dx * s, dy * s, r * s, 0, 7); g.fill(); }
}
function bush(g, x, s = 1, col = '#4f8f3e') {
  g.fillStyle = col;
  for (const [dx, dy, r] of [[-34, -26, 30], [0, -44, 40], [36, -26, 32], [0, -18, 34]]) { g.beginPath(); g.arc(x + dx * s, dy * s, r * s, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(x - 8 * s, -58 * s, 16 * s, 0, 7); g.fill();
}
function rock(g, x, y, s = 1, col = '#8c8a86') {
  g.fillStyle = col; g.beginPath(); g.ellipse(x, y - 10 * s, 26 * s, 16 * s, 0, Math.PI, 0); g.lineTo(x + 26 * s, y); g.lineTo(x - 26 * s, y); g.fill();
}
function cave(g, x) {
  g.fillStyle = '#8a7d6c'; g.beginPath(); g.moveTo(x - 260, 0);
  g.quadraticCurveTo(x - 250, -330, x - 60, -300); g.quadraticCurveTo(x + 90, -270, x + 120, 0); g.fill();
  g.fillStyle = '#9a8e7c'; g.beginPath(); g.ellipse(x - 120, -250, 90, 30, -0.2, 0, 7); g.fill();
  g.fillStyle = '#2b2420'; g.beginPath(); g.moveTo(x - 150, 0); g.quadraticCurveTo(x - 150, -170, x - 60, -170); g.quadraticCurveTo(x + 20, -170, x + 20, 0); g.fill();
}
function field(g, tod) {
  const p = TOD[tod];
  groundPlane(g, tod);
  tree(g, -330, 1.2, p.trees); tree(g, 300, 1.0, p.trees); tree(g, 520, 1.3, p.trees); tree(g, -600, 1.1, p.trees);
  rock(g, -180, 0, 1.2); rock(g, 250, 0, 0.8);
}
function camp(g, tod) {
  const p = TOD[tod];
  groundPlane(g, tod);
  tree(g, 330, 1.25, p.trees); tree(g, 560, 1.0, p.trees);
  cave(g, -330);
  rock(g, 300, 0, 0.9);
}

// ---- props ------------------------------------------------------------------------------------------------
function logs(g, x) {
  g.fillStyle = '#7d7a74'; for (const d of [-36, -18, 18, 36]) { g.beginPath(); g.ellipse(x + d, -3, 11, 7, 0, 0, 7); g.fill(); }
  g.strokeStyle = '#5b3b22'; g.lineWidth = 11; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x - 30, -2); g.lineTo(x + 26, -14); g.moveTo(x + 30, -2); g.lineTo(x - 26, -14); g.stroke();
}
function flames(g, x, t, k) {
  if (k <= 0.02) return;
  for (const [col, h, w, ph] of [['#e4462b', 70, 30, 0], ['#f7a13a', 50, 21, 1.7], ['#ffe27a', 28, 12, 3.1]]) {
    const hh = h * k * (1 + 0.13 * Math.sin(t * 13 + ph) + 0.07 * Math.sin(t * 29 + ph * 2)), ww = w * Math.min(1, 0.4 + k * 0.6);
    const lean = Math.sin(t * 7 + ph) * 5 * k;
    g.fillStyle = col; g.beginPath(); g.moveTo(x - ww, -10);
    g.quadraticCurveTo(x - ww * 0.9, -10 - hh * 0.6, x + lean, -10 - hh);
    g.quadraticCurveTo(x + ww * 0.9, -10 - hh * 0.6, x + ww, -10); g.closePath(); g.fill();
  }
  g.fillStyle = '#ffcf6a';
  for (let i = 0; i < 5; i++) { const u = (t * 0.7 + i / 5) % 1; g.globalAlpha = 1 - u; g.beginPath(); g.arc(x + Math.sin(i * 3 + t * 2) * 14, -30 - u * 90 * k, 2.2, 0, 7); g.fill(); }
  g.globalAlpha = 1;
}
function glow(g, x, y, r, col, a) {
  const [sx, sy] = toScreen(x, y), R = r * CAM.z;
  const q = g.createRadialGradient(sx, sy, 0, sx, sy, R);
  q.addColorStop(0, `rgba(${col},${a})`); q.addColorStop(1, `rgba(${col},0)`);
  g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = q; g.fillRect(sx - R, sy - R, R * 2, R * 2); g.restore();
}
function night(g, a) { if (a > 0) { g.fillStyle = `rgba(6,10,34,${a})`; g.fillRect(0, 0, W, H); } }
function stars(g, t, a = 1) {
  const r = rng(21);
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H * 0.45, tw = 0.6 + 0.4 * Math.sin(t * 2 + i);
    g.fillStyle = `rgba(255,255,240,${a * tw * (0.4 + r() * 0.6)})`; g.fillRect(x, y, 2.4, 2.4);
  }
}
function moon(g, x, y, r = 46) {
  g.fillStyle = 'rgba(240,240,210,0.15)'; g.beginPath(); g.arc(x, y, r * 1.9, 0, 7); g.fill();
  g.fillStyle = '#f4f1dc'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.07)'; for (const [dx, dy, rr] of [[-12, -8, 9], [14, 10, 7], [6, -18, 5]]) { g.beginPath(); g.arc(x + dx, y + dy, rr, 0, 7); g.fill(); }
}
function fish(g, x, y, s = 1, rot = 0, half = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  if (half !== 2) { g.fillStyle = '#e59a52'; g.beginPath(); g.moveTo(-24, 0); g.lineTo(-36, -10); g.lineTo(-36, 10); g.closePath(); g.fill(); }
  g.fillStyle = '#f0a860'; g.beginPath();
  if (half === 1) g.ellipse(-6, 0, 18, 10, 0, Math.PI * 0.5, Math.PI * 1.5);
  else if (half === 2) g.ellipse(6, 0, 18, 10, 0, -Math.PI * 0.5, Math.PI * 0.5);
  else g.ellipse(0, 0, 24, 11, 0, 0, 7);
  g.fill();
  g.fillStyle = '#f7d6a8'; if (!half) { g.beginPath(); g.ellipse(2, 4, 16, 4, 0, 0, 7); g.fill(); }
  if (half !== 1) { g.fillStyle = '#1d1a18'; g.beginPath(); g.arc(14, -3, 2.4, 0, 7); g.fill(); }
  if (half) { g.fillStyle = '#f6e3d0'; g.fillRect(half === 1 ? -7 : 5, -8, 3, 16); }
  g.restore();
}
function meat(g, x, y, s = 1, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.strokeStyle = '#f3ecdc'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(8, 0); g.lineTo(26, 0); g.stroke();
  g.fillStyle = '#f3ecdc'; for (const d of [-4, 4]) { g.beginPath(); g.arc(29, d, 4.5, 0, 7); g.fill(); }
  g.fillStyle = '#a4472b'; g.beginPath(); g.ellipse(-4, 0, 17, 13, 0, 0, 7); g.fill();
  g.fillStyle = '#c86a45'; g.beginPath(); g.ellipse(-8, -4, 8, 5, -0.3, 0, 7); g.fill();
  g.restore();
}
function bone(g, x, y, s = 1, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.strokeStyle = '#f3ecdc'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.stroke();
  g.fillStyle = '#f3ecdc'; for (const [dx, dy] of [[-14, -4], [-14, 4], [14, -4], [14, 4]]) { g.beginPath(); g.arc(dx, dy, 4.5, 0, 7); g.fill(); }
  g.restore();
}
function heart(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#ff5d7a'; g.strokeStyle = '#7a1f33'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 12); g.bezierCurveTo(-26, -6, -14, -26, 0, -12); g.bezierCurveTo(14, -26, 26, -6, 0, 12); g.fill(); g.stroke();
  g.restore();
}
function zzz(g, x, y, t, n = 3, size = 26) {
  g.font = `900 ${size}px ${FONT}`; g.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const u = (t * 0.45 + i / n) % 1;
    g.fillStyle = `rgba(255,255,255,${Math.sin(u * Math.PI)})`;
    g.fillText('z', x + u * 40 + Math.sin(u * 6) * 8, y - u * 90);
  }
}
// Motion streak: a speedy smear from a to b.
function streak(g, x0, y0, x1, y1, k, col = 'rgba(140,130,120,0.8)') {
  if (k <= 0 || k >= 1) return;
  g.strokeStyle = col; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) { g.lineWidth = 10 - i * 2; g.globalAlpha = (1 - k) * (1 - i * 0.2); const d = i * 8 - 12; g.beginPath(); g.moveTo(lerp(x0, x1, k * 0.2), y0 + d); g.lineTo(lerp(x0, x1, k), y1 + d); g.stroke(); }
  g.globalAlpha = 1;
}
function dust(g, x, y, k, s = 1) {
  if (k <= 0 || k >= 1) return;
  g.fillStyle = `rgba(210,190,150,${0.8 * (1 - k)})`;
  for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI, r = 20 + k * 60 * s; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.4, (12 + k * 12) * s, 0, 7); g.fill(); }
}

// ---- the wolf pup --------------------------------------------------------------------------------------
// Faces +x. pose: stand | run | sit | curl | crouch. mouth: closed | open | teeth | tongue | chew.
const FUR = '#8e8478', FUR_D = '#6c645a', CREAM = '#ece4d6';
function pup(g, x, y, o = {}) {
  const s = o.s || 1.3, dir = o.dir || 1, t = o.t || 0, pose = o.pose || 'stand', ph = o.ph || 0;
  g.save(); g.translate(x + (o.tremble ? Math.sin(t * 70) * 1.8 : 0), y); g.scale(dir * s, s);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.beginPath(); g.ellipse(4, 0, 30, 5, 0, 0, 7); g.fill();
  if (pose === 'curl') {
    g.fillStyle = FUR; g.beginPath(); g.ellipse(-2, -17, 26, 18, 0, 0, 7); g.fill();
    g.strokeStyle = FUR_D; g.lineWidth = 10; g.beginPath(); g.moveTo(-26, -10); g.quadraticCurveTo(-10, 2, 20, -2); g.stroke();
    g.fillStyle = CREAM; g.beginPath(); g.arc(22, -2, 5, 0, 7); g.fill();
    const up = o.headUp || 0;
    g.fillStyle = FUR_D; g.beginPath(); g.ellipse(22, -3, 12, 4, 0, 0, 7); g.fill();
    g.save(); g.translate(lerp(24, 26, up), lerp(-16, -36, up));
    head(g, { ...o, eyes: up > 0.5 ? (o.eyes || 'wide') : 'closed', ears: 'up' }, t);
    g.restore(); g.restore(); return;
  }
  const run = pose === 'run', sit = pose === 'sit', low = pose === 'crouch' ? 7 : 0;
  const bob = run ? -Math.abs(Math.sin(ph)) * 7 : 0;
  g.translate(0, bob);
  // Tail: angle from +x (canvas), up-and-back when happy, tucked when scared.
  const wag = o.wag ? Math.sin(t * o.wag) * 0.5 : 0;
  const ta = (o.tuck ? 2.5 : run ? -2.9 : sit ? -2.5 : -2.2) + wag;
  const tb = sit ? [-18, -10] : [-21, -26 + low];
  const tip = [tb[0] + Math.cos(ta) * 26, tb[1] + Math.sin(ta) * 26];
  g.strokeStyle = FUR_D; g.lineWidth = 11; g.beginPath(); g.moveTo(tb[0], tb[1]); g.quadraticCurveTo(tb[0] + Math.cos(ta + 0.4) * 16, tb[1] + Math.sin(ta + 0.4) * 16, tip[0], tip[1]); g.stroke();
  g.fillStyle = CREAM; g.beginPath(); g.arc(tip[0], tip[1], 5, 0, 7); g.fill();
  // Legs: far pair darker.
  const leg = (hx, hy, a, col) => { g.strokeStyle = col; g.lineWidth = 7.5; const fx = hx + Math.sin(a) * (0 - hy - 3), fy = -3; g.beginPath(); g.moveTo(hx, hy); g.lineTo(fx, fy); g.stroke(); g.fillStyle = col; g.beginPath(); g.ellipse(fx + 3, -2.5, 5.5, 3.5, 0, 0, 7); g.fill(); };
  if (sit) {
    leg(11, -24, 0.05, FUR_D); leg(17, -24, 0.05, FUR);
    g.fillStyle = FUR_D; g.beginPath(); g.ellipse(-4, -3, 9, 4, 0, 0, 7); g.fill();
    g.fillStyle = FUR; g.save(); g.translate(-4, -26); g.rotate(-0.75); g.beginPath(); g.ellipse(0, 0, 20, 13, 0, 0, 7); g.fill(); g.restore();
    g.beginPath(); g.ellipse(-10, -12, 13, 11, 0, 0, 7); g.fill();
    g.fillStyle = CREAM; g.beginPath(); g.ellipse(9, -30, 7, 11, -0.3, 0, 7); g.fill();
    g.save(); g.translate(12, -50); head(g, o, t); g.restore();
  } else {
    const sw = run ? Math.sin(ph) * 0.75 : (o.walk ? Math.sin(ph) * 0.35 : 0);
    leg(-14, -18 + low, sw, FUR_D); leg(12, -18 + low, -sw, FUR_D);
    g.fillStyle = FUR; g.beginPath(); g.ellipse(0, -26 + low, 24, 13, run ? 0.05 : 0, 0, 7); g.fill();
    g.fillStyle = CREAM; g.beginPath(); g.ellipse(14, -21 + low, 9, 7, 0, 0, 7); g.fill();
    leg(-9, -18 + low, -sw, FUR); leg(17, -18 + low, sw, FUR);
    g.save(); g.translate(26, -40 + low * 1.6 + (o.lunge || 0)); if (o.headDown) g.rotate(o.headDown); head(g, o, t); g.restore();
  }
  g.restore();
}
function head(g, o, t) {
  g.save(); g.rotate(o.tilt || 0);
  const ears = o.ears || (o.tuck ? 'back' : 'up');
  const earTw = o.twitch ? Math.sin(t * 40) * 0.25 : 0;
  g.fillStyle = FUR_D;
  if (ears === 'up') { g.beginPath(); g.moveTo(-9, -8); g.lineTo(-7, -27); g.lineTo(2, -11); g.fill(); }
  g.fillStyle = FUR; g.beginPath(); g.arc(0, 0, 15.5, 0, 7); g.fill();
  g.beginPath(); g.ellipse(-8, 7, 9, 8, 0, 0, 7); g.fill();
  g.fillStyle = '#b8ae9f'; g.beginPath(); g.ellipse(13, 5, 12, 7.5, 0.05, 0, 7); g.fill();
  const m = o.mouth || 'closed';
  if (m === 'open' || m === 'teeth') {
    g.fillStyle = '#5a1a1a'; g.beginPath(); g.ellipse(15, 11, 8, m === 'open' ? 6 : 4, 0.1, 0, 7); g.fill();
    if (m === 'open') { g.fillStyle = '#e8828a'; g.beginPath(); g.ellipse(15, 14, 5, 3, 0, 0, 7); g.fill(); }
    else { g.fillStyle = '#fff'; for (const tx of [10, 15, 20]) { g.beginPath(); g.moveTo(tx - 2, 8); g.lineTo(tx, 12); g.lineTo(tx + 2, 8); g.fill(); } }
  } else if (m === 'tongue') {
    g.fillStyle = '#e8828a'; g.beginPath(); g.ellipse(22, 14, 5, 8, -0.4, 0, 7); g.fill();
  } else {
    const chew = m === 'chew' ? Math.abs(Math.sin(t * 16)) * 2 : 0;
    g.strokeStyle = '#3a2f28'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(9, 11 + chew); g.quadraticCurveTo(14, 13 + chew, 19, 10); g.stroke();
  }
  g.fillStyle = '#1d1a18'; g.beginPath(); g.ellipse(24, 2, 4.5, 3.8, 0, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(23, 0.5, 1.3, 0, 7); g.fill();
  g.fillStyle = FUR;
  if (ears === 'up') { g.save(); g.translate(3, -10); g.rotate(earTw); g.beginPath(); g.moveTo(-5, 1); g.lineTo(2, -18); g.lineTo(9, 1); g.fill(); g.fillStyle = '#d9a6a0'; g.beginPath(); g.moveTo(-1, -1); g.lineTo(2, -11); g.lineTo(5, -1); g.fill(); g.restore(); }
  else if (ears === 'back') { g.beginPath(); g.moveTo(-2, -12); g.lineTo(-20, -18); g.lineTo(2, -5); g.fill(); }
  else { g.beginPath(); g.ellipse(-2, -8, 10, 5, 0.5, 0, 7); g.fill(); }
  const e = o.eyes || 'open';
  g.strokeStyle = '#1d1a18'; g.lineWidth = 2.2;
  if (e === 'closed') { g.beginPath(); g.arc(6, -3, 4, 0.2, Math.PI - 0.2); g.stroke(); }
  else if (e === 'happy') { g.beginPath(); g.arc(6, -1, 4.5, Math.PI + 0.3, Math.PI * 2 - 0.3); g.stroke(); }
  else {
    const big = e === 'wide' ? 7 : 6;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(6, -4, big, 0, 7); g.fill();
    g.fillStyle = '#1d1a18'; g.beginPath(); g.arc(8, -4, e === 'wide' ? 2.6 : 3.8, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(9.3, -5.6, 1.4, 0, 7); g.fill();
    if (o.brave) { g.lineWidth = 3; g.beginPath(); g.moveTo(0, -12); g.lineTo(12, -9); g.stroke(); }
  }
  if (o.carry === 'fish') fish(g, 27, 14, 0.8, 0.15);
  else if (o.carry === 'half') fish(g, 27, 14, 0.8, 0.15, 2);
  else if (o.carry === 'meat') meat(g, 30, 14, 0.75, 0.2);
  else if (o.carry === 'bone') bone(g, 26, 13, 0.8, 0.1);
  g.restore();
}

// ---- the cave lion --------------------------------------------------------------------------------------
// Faces +x; returns the eye position (world) so the eyes can glow above the dark.
function lion(g, x, y, o = {}) {
  const s = o.s || 1, dir = o.dir || 1, t = o.t || 0, cr = o.crouch || 0, ph = o.ph || 0;
  g.save(); g.translate(x, y); g.scale(dir * s, s); g.lineCap = 'round';
  const by = -82 + cr * 18;
  const legs = (col, off) => {
    g.strokeStyle = col; g.lineWidth = 19;
    for (const [hx, k] of [[-62, 0], [56, 1]]) { const a = Math.sin(ph + k * Math.PI + off) * (o.run ? 0.6 : 0.25); g.beginPath(); g.moveTo(hx, by + 16); g.lineTo(hx + Math.sin(a) * 30 - cr * 12, by + 50 - cr * 8); g.lineTo(hx + Math.sin(a) * 50, -6); g.stroke(); }
  };
  legs('#7a5a32', 1.3);
  g.strokeStyle = '#8a6a3c'; g.lineWidth = 10; g.beginPath(); g.moveTo(-92, by - 10); g.quadraticCurveTo(-150, by - 40 + Math.sin(t * 3) * 12, -170, by + 10); g.stroke();
  g.fillStyle = '#5a3f22'; g.beginPath(); g.arc(-170, by + 12, 9, 0, 7); g.fill();
  g.fillStyle = '#9d7746'; g.beginPath(); g.ellipse(0, by, 100, 40, 0, 0, 7); g.fill();
  g.fillStyle = '#b89464'; g.beginPath(); g.ellipse(10, by + 22, 70, 14, 0, 0, 7); g.fill();
  legs('#9d7746', 0);
  const hx = 100, hy = by - 18 + cr * 22 - (o.roar || 0) * 10;
  g.save(); g.translate(hx, hy); g.rotate(-(o.roar || 0) * 0.25 + (o.flinch || 0) * -0.3);
  g.fillStyle = '#8a6a3c'; for (const ex of [-18, 6]) { g.beginPath(); g.arc(ex, -30, 10, 0, 7); g.fill(); }
  g.fillStyle = '#a57f4c'; g.beginPath(); g.arc(0, 0, 36, 0, 7); g.fill();
  g.fillStyle = '#c9a877'; g.beginPath(); g.ellipse(28, 10, 24, 17, 0, 0, 7); g.fill();
  g.fillStyle = '#3a2618'; g.beginPath(); g.ellipse(48, 2, 8, 6, 0, 0, 7); g.fill();
  const mo = o.roar || 0;
  if (mo > 0.05) {
    g.fillStyle = '#4a1414'; g.beginPath(); g.ellipse(30, 24, 20, 6 + mo * 14, 0.1, 0, 7); g.fill();
    g.fillStyle = '#fff'; for (const fx of [16, 42]) { g.beginPath(); g.moveTo(fx - 4, 18); g.lineTo(fx, 18 + 10 + mo * 6); g.lineTo(fx + 4, 18); g.fill(); }
  }
  g.restore();
  g.restore();
  return [x + dir * s * (hx + 10), y + s * (hy - 10)];
}
function eyeGlow(g, wx, wy, k, dir = -1, blink = 0) {
  if (k <= 0) return;
  const [sx, sy] = toScreen(wx, wy), z = CAM.z;
  for (const d of [0, 1]) {
    const ex = sx + dir * d * 22 * z * 0.6, ey = sy;
    const q = g.createRadialGradient(ex, ey, 0, ex, ey, 28 * z * 0.6);
    q.addColorStop(0, `rgba(255,230,90,${0.7 * k})`); q.addColorStop(1, 'rgba(255,230,90,0)');
    g.fillStyle = q; g.fillRect(ex - 40 * z, ey - 40 * z, 80 * z, 80 * z);
    g.fillStyle = `rgba(255,245,170,${k})`; g.beginPath(); g.ellipse(ex, ey, 7 * z * 0.6, 5 * z * 0.6 * (1 - blink), 0, 0, 7); g.fill();
    g.fillStyle = `rgba(20,10,0,${k})`; g.fillRect(ex - 1.2 * z * 0.6, ey - 4 * z * 0.6 * (1 - blink), 2.4 * z * 0.6, 8 * z * 0.6 * (1 - blink));
  }
}

// ---- Oog ------------------------------------------------------------------------------------------------
// rot tips the whole figure about its feet: +PI/2 face down (for dir 1: head to +x), -PI/2 on his back.
function oog(g, x, y, pose, dir = 1, rot = 0, lift = 0) {
  if (!rot) return Hm.human(g, x, y, OOG, pose, dir);
  g.save(); g.translate(x, y - lift); g.rotate(rot * dir); Hm.human(g, 0, 0, OOG, pose, dir); g.restore();
  return null;
}
const SIT = (o = {}) => ({ ...P.sit(), eyes: 'open', mouth: 'smile', ...o });
const LIE = (o = {}) => ({ ll: [0.12, 0], rl: [-0.05, 0], la: [0.5, 1.9], ra: [0.7, 1.8], eyes: 'closed', mouth: 'smile', ...o });

// ---- text ---------------------------------------------------------------------------------------------------
function bubble(g, text, wx, wy, k, { big = false, side = 1 } = {}) {
  if (k <= 0) return;
  const [sx, sy] = toScreen(wx, wy);
  const size = big ? 54 : 40;
  g.font = `900 ${size}px ${FONT}`;
  const tw = g.measureText(text).width, bw = tw + 50, bh = size + 36;
  const pop = k < 1 ? 0.6 + 0.4 * ease(k) + Math.sin(k * Math.PI) * 0.12 : 1;
  let cx = clamp(sx + side * 70, bw / 2 + 24, W - bw / 2 - 24), cy = Math.max(bh / 2 + 150, sy - 120);
  g.save(); g.translate(cx, cy); g.scale(pop, pop);
  g.fillStyle = '#fffdf5'; g.strokeStyle = '#1d1a18'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(-bw / 2, -bh / 2, bw, bh, 26); g.fill(); g.stroke();
  // Tail toward the speaker.
  const tx = clamp((sx - cx) / pop, -bw / 2 + 30, bw / 2 - 30);
  g.beginPath(); g.moveTo(tx - 16, bh / 2 - 3); g.lineTo((sx - cx) / pop, (sy - cy) / pop - 16); g.lineTo(tx + 16, bh / 2 - 3); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(tx - 16, bh / 2); g.lineTo((sx - cx) / pop, (sy - cy) / pop - 16); g.lineTo(tx + 16, bh / 2); g.stroke();
  g.fillStyle = '#1d1a18'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 2);
  g.restore(); g.textBaseline = 'alphabetic';
}
// A line's bubble, timed from the measured narration.
function say(g, id, t, wx, wy, opt) {
  const l = VO[id]; if (!l) return;
  const a = l.t0 - 0.08, b = l.t0 + l.dur + 0.6;
  if (t < a || t > b) return;
  bubble(g, l.text, wx, wy, clamp((t - a) / 0.18, 0, 1) * (t > b - 0.12 ? (b - t) / 0.12 : 1), opt);
}
function caption(g, text, y, k, size = 40, col = '#ffffff') {
  if (k <= 0) return;
  g.font = `900 ${size}px ${FONT}`; g.textAlign = 'center';
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const x = cur ? `${cur} ${w}` : w; if (g.measureText(x).width > 650 && cur) { lines.push(cur); cur = w; } else cur = x; }
  lines.push(cur);
  g.save(); g.globalAlpha = k; g.lineJoin = 'round';
  lines.forEach((l, i) => { const yy = y + i * size * 1.22; g.lineWidth = size * 0.2; g.strokeStyle = '#1a1410'; g.strokeText(l, W / 2, yy); g.fillStyle = col; g.fillText(l, W / 2, yy); });
  g.restore();
}
const pop = (g, text, wx, wy, t, t0, size = 60, col = '#ffd24a', dur = 0.9, rot = -0.08) => {
  const u = t - t0; if (u < 0 || u > dur) return;
  const [sx, sy] = toScreen(wx, wy);
  const hw = size * 0.42 * text.length;
  Hm.word(g, text, clamp(sx, Math.min(W / 2, hw + 20), Math.max(W / 2, W - hw - 20)), sy, size, col, clamp(u / 0.25, 0, 1) * (u > dur - 0.15 ? (dur - u) / 0.15 : 1), rot);
};
function titleCard(g, k, y = 250) {
  if (k <= 0) return;
  Hm.word(g, 'THE FIRST PET', W / 2, y, 70, '#ffd24a', k, -0.04);
}

// ---- scenes -------------------------------------------------------------------------------------------------
const S = {
  hook(g, t) {
    setCam(t, lerp(10, 0, seg(t, 0, 3.2)), lerp(3.0, 3.25, seg(t, 0, 1.1)), 990);
    backdrop(g, 'day', t);
    let hand;
    world(g, () => {
      camp(g, 'day'); logs(g, 90); flames(g, 90, t, 0.8); seat(g, -40);
      if (t > B.snatch + 0.3) pup(g, lerp(-80, -330, seg(t, B.snatch + 0.3, 2.6)), 0, { pose: 'run', ph: t * 22, dir: -1, t, carry: 'fish', ears: 'back' });
      const up = seg(t, B.raise, B.snatch - 0.05);
      const bite = t > B.chomp && t < B.chomp + 0.25;
      const angry = t > 1.25;
      const pose = SIT({ ra: [lerp(1.1, 1.45, up), lerp(0.5, 1.2, up)], la: [0.6, 1.2], mouth: bite ? 'chomp' : up > 0.6 && t < B.chomp ? 'grin' : angry ? 'frown' : 'smile', eyes: bite ? 'closed' : angry ? (t > 1.9 ? 'angry' : 'wide') : 'happy', head: up * -0.15 });
      const r = oog(g, -40, 0, pose, t > 1.9 ? -1 : 1);
      hand = r.handF;
      // The stick, and the fish on it until the snatch.
      const dx = t > 1.9 ? -1 : 1, tip = [hand[0] + dx * 34, hand[1] - 34];
      g.strokeStyle = '#6b4a2e'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(hand[0] - dx * 6, hand[1] + 6); g.lineTo(tip[0], tip[1]); g.stroke();
      if (t < B.snatch) fish(g, tip[0] + dx * 4, tip[1] - 6, 0.9, -0.5 * dx);
      // The snatch: a grey blur out of nowhere, and the pup legging it with the fish.
      const k = (t - B.snatch) / 0.22;
      streak(g, 120, -150, -200, -40, k);
    });
    foreground(g, 'day');
    pop(g, 'CHOMP!', hand[0] + 30, hand[1] - 70, t, B.chomp, 58, '#ffffff', 0.7);
    say(g, 'hey', t, -30, -200, { big: true, side: 1 });
    titleCard(g, fade(t, B.title, 0.3) * (1 - fade(t, 3.05, 0.15)), 200);
  },
  chase(g, t) {
    const pxAt = (t) => t < B.turn ? lerp(-330, 150, (t - 3.2) / (B.turn - 3.2)) : t < 5.5 ? lerp(150, -170, (t - B.turn) / (5.5 - B.turn)) : -170;
    const oxAt = (t) => t < 4.55 ? lerp(-420, 40, (t - 3.45) / 1.1) : 40;
    setCam(t, t < 5.5 ? clamp((Math.max(pxAt(t), -300) + clamp(oxAt(t), -300, 60)) / 2 + 20, -150, 60) : lerp(-10, -50, seg(t, 5.5, 6.2)), 1.85, 1000);
    backdrop(g, 'day', t);
    let oh = [0, 0];
    world(g, () => {
      field(g, 'day');
      // The pup: right with the fish, back under Oog's legs, a cheeky look, off again.
      let px, pdir = 1, ppose = 'run', po = {};
      if (t < B.turn) px = lerp(-330, 150, (t - 3.2) / (B.turn - 3.2));
      else if (t < 5.5) { px = lerp(150, -170, (t - B.turn) / (5.5 - B.turn)); pdir = -1; }
      else if (t < B.trot) { px = -170; pdir = 1; ppose = 'stand'; po = { wag: 18, eyes: t > 6.2 ? 'happy' : 'open', tilt: Math.sin(t * 3) * 0.1 }; }
      else { px = lerp(-170, -420, (t - B.trot) / 0.8); pdir = -1; }
      // Oog: runs after, skids, grabs, spins and dives face-first.
      if (t < 3.45) {}
      else if (t < 4.55) { const x = lerp(-420, 40, (t - 3.45) / 1.1); oh = [x + 20, -200]; oog(g, x, 0, P.run(t * 13), 1); }
      else if (t < B.under + 0.1) { oh = [60, -200]; oog(g, 40, 0, { rot: -0.25, la: [1.6, -0.2], ra: [1.8, -0.2], ll: [0.7, 0], rl: [0.3, 0], eyes: 'wide', mouth: 'o' }, 1); }
      else if (t < B.plant) {
        const k = (t - B.under - 0.1) / (B.plant - B.under - 0.1);
        oog(g, lerp(40, 70, k), 0, { la: [2.8, 0], ra: [2.9, 0], ll: [-0.4, 0], rl: [-0.8, -0.4], mouth: 'o', eyes: 'wide' }, -1, lerp(0.3, Math.PI / 2, ease(k)), Math.sin(k * Math.PI) * 50 + 18 * k);
      } else {
        const lift = t > B.lift ? 0.25 * seg(t, B.lift, B.lift + 0.3) : 0;
        oog(g, 70, 0, { la: [2.9, 0], ra: [2.9, 0], ll: [-0.1, 0], rl: [-0.2, 0], mouth: t > B.lift ? 'frown' : 'o', eyes: t > B.lift ? 'angry' : 'x' }, -1, Math.PI / 2 - lift, 18);
      }
      pup(g, px, 0, { pose: ppose, ph: t * 22, dir: pdir, t, carry: 'fish', ears: ppose === 'run' ? 'back' : 'up', ...po });
      if (t > B.plant && t < B.lift + 0.2) Hm.stars(g, -150, -40, t, 3, 30);
      dust(g, -120, 0, (t - B.plant) / 0.6, 1.4);
    });
    foreground(g, 'day');
    say(g, 'back', t, oh[0], oh[1], { side: -1 });
    pop(g, 'THUD!', -60, -110, t, B.plant, 70, '#ffb04a', 1.0);
  },
  planA(g, t) {
    setCam(t, lerp(60, 75, seg(t, 8, 15.4)), lerp(1.95, 2.05, seg(t, 8, 15.4)), 1000);
    backdrop(g, 'day', t);
    let oh = [180, -190];
    world(g, () => {
      field(g, 'day');
      // The trap: a basket propped on a stick over the meat, a string to Oog's bush.
      const pulled = t > B.pull, fall = seg(t, B.pull + 0.05, B.slam);
      const lifted = t > B.peek ? seg(t, B.peek, B.peek + 0.3) : 0;
      const bx = -100, ang = -0.42 * (1 - fall);
      if (t < B.pull) meat(g, -40, -12, 1);
      // Basket (lifted by Oog after the slam).
      g.save(); g.translate(bx + lifted * 20, -lifted * 150); g.rotate(ang - lifted * 0.2);
      g.fillStyle = '#a8793f'; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(10, -70, 55, -70); g.quadraticCurveTo(100, -70, 110, 0); g.closePath(); g.fill();
      g.strokeStyle = '#7e5629'; g.lineWidth = 3; for (const yy of [-16, -34, -52]) { g.beginPath(); g.moveTo(6, yy); g.lineTo(104, yy); g.stroke(); }
      g.restore();
      // The stick and the string.
      const sp = pulled ? seg(t, B.pull, B.pull + 0.2) : 0;
      const stickX = lerp(4, 150, sp);
      g.strokeStyle = '#6b4a2e'; g.lineWidth = 5; g.lineCap = 'round';
      if (sp < 1) { g.beginPath(); g.moveTo(stickX, -2); g.lineTo(stickX + lerp(4, 30, sp), -46 + sp * 30); g.stroke(); }
      if (t < B.run) { g.strokeStyle = '#e8dcc0'; g.lineWidth = 2; g.beginPath(); g.moveTo(stickX, -4); g.quadraticCurveTo(80, pulled ? -8 : 4, 170, -60); g.stroke(); }
      // The pup: trots in, sniffs, vanishes, and is somehow sitting beside the bush with the meat.
      if (t > B.pupIn && t < B.pull) {
        const k = seg(t, B.pupIn, B.sniff);
        pup(g, lerp(-280, -70, k), 0, { pose: 'stand', walk: k < 1, ph: t * 14, t, headDown: t > B.sniff ? 0.45 + Math.sin(t * 20) * 0.05 : 0, tilt: 0, ears: 'up' });
      }
      streak(g, -60, -30, 110, -30, (t - B.pull) / 0.15);
      const pupX = t < B.lunge ? 110 : lerp(110, 520, seg(t, B.lunge + 0.05, B.lunge + 0.4));
      if (t > B.pull + 0.1) {
        const gulp = t > B.gulp;
        pup(g, pupX, 0, t < B.lunge ? { pose: 'sit', t, dir: -1, carry: gulp ? null : 'meat', mouth: gulp ? 'closed' : 'chew', eyes: t > B.gulp + 0.25 ? 'happy' : 'open', wag: gulp ? 16 : 6 } : { pose: 'run', ph: t * 24, t, dir: 1, ears: 'back', mouth: 'open' });
      }
      // Oog: hides, pulls, runs to the basket, lifts it, turns slowly... lunges.
      if (t < B.run) {
        const pull = pulled ? { rot: -0.35, ra: [1.1, 0.3], la: [0.9, 0.3] } : { ra: [1.3, 1.4], la: [1.2, 1.5] };
        oog(g, 200, 0, { ...P.crouch(), ...pull, eyes: 'angry', mouth: pulled ? 'grit' : 'grin', head: 0.1 }, -1);
        oh = [170, -150];
        bush(g, 170, 1.15);
      } else {
        bush(g, 170, 1.15);
        if (t < B.peek) { const x = lerp(200, -10, seg(t, B.run, B.peek - 0.1)); oog(g, x, 0, P.run(t * 13), -1); }
        else if (t < B.lunge) {
          const turned = t > B.look;
          oh = [turned ? 10 : -30, -200];
          oog(g, -10, 0, { la: [2.5 - lifted * 0.2, 0.3], ra: [2.6 - lifted * 0.2, 0.3], eyes: turned ? 'wide' : 'wide', mouth: turned ? 'o' : 'flat', head: turned ? 0.1 : 0 }, turned ? 1 : -1);
        } else oog(g, lerp(-10, 200, seg(t, B.lunge, B.lunge + 0.45)), 0, { ...P.run(t * 14), eyes: 'angry', mouth: 'grit' }, 1);
      }
      if (t > B.slam) dust(g, -45, 0, (t - B.slam) / 0.5, 1.2);
    });
    foreground(g, 'day');
    caption(g, 'PLAN A', 210, fade(t, B.capA, 0.2) * (1 - fade(t, 9.6, 0.3)), 92, '#ffd24a');
    say(g, 'heh', t, oh[0], oh[1], { side: -1 });
    pop(g, 'SLAM!', -40, -120, t, B.slam, 66, '#ffb04a', 0.8);
    say(g, 'huh', t, oh[0], oh[1], { side: 1 });
    pop(g, 'yip!', 120, -110, t, B.gulp + 0.25, 40, '#ffffff', 0.6, 0.1);
  },
  planB(g, t) {
    setCam(t, lerp(0, 25, seg(t, 18.8, 20.5)), lerp(1.75, 1.9, seg(t, B.land, 22.4)), 1000);
    backdrop(g, 'day', t);
    let oh = [-60, -200];
    world(g, () => {
      field(g, 'day');
      const PX = 30;
      const dig = seg(t, B.dig0, B.dig1), cover = seg(t, B.dig1, B.leaves);
      // The dirt pile he throws behind him, and the hole.
      g.fillStyle = '#7a5433'; g.beginPath(); g.ellipse(-150, 0, 55 * dig, 38 * dig, 0, Math.PI, 0); g.fill();
      if (dig > 0) { g.fillStyle = '#3a2616'; g.beginPath(); g.ellipse(PX, 6, 62 * Math.min(1, dig * 1.4), 15 * Math.min(1, dig * 1.4), 0, 0, 7); g.fill(); }
      const fell = t > B.fall;
      if (cover > 0 && !fell) {
        g.fillStyle = '#6d8f3a'; g.globalAlpha = cover; g.beginPath(); g.ellipse(PX, 4, 64, 16, 0, 0, 7); g.fill();
        g.fillStyle = '#8aa84a'; for (let i = 0; i < 9; i++) { const r = rng(i + 5); g.beginPath(); g.ellipse(PX - 50 + r() * 100, r() * 10 - 2, 12, 5, r() * 3, 0, 7); g.fill(); }
        g.globalAlpha = 1;
      }
      if (t > B.meat && !fell) meat(g, PX, -10, 1);
      // Flying dirt while he digs.
      if (dig > 0 && dig < 1) for (let i = 0; i < 6; i++) { const u = ((t - B.dig0) * 2.2 + i / 6) % 1; g.fillStyle = '#7a5433'; g.beginPath(); g.arc(PX - 40 - u * 120, -30 - Math.sin(u * Math.PI) * 120, 7, 0, 7); g.fill(); }
      // Oog.
      if (t < B.dig1) oog(g, -40, 0, { rot: 1.0, drop: 12, la: [1.4 + Math.sin(t * 16) * 0.6, 0.3], ra: [1.4 - Math.sin(t * 16) * 0.6, 0.3], ll: [0.6, -0.6], rl: [0.2, -0.3], mouth: 'grit', eyes: 'angry' }, 1);
      else if (t < B.meat + 0.1) oog(g, -40, 0, { rot: 0.5, la: [1.5, 0.2], ra: [1.6 + Math.sin(t * 12) * 0.3, 0.1], mouth: 'grin', eyes: 'happy' }, 1);
      else if (t < B.charge) { oh = [-60, -205]; oog(g, -40, 0, { la: [-0.5, 2.2], ra: [-0.5, 2.2], mouth: t > B.see ? 'o' : 'grin', eyes: t > B.see ? 'wide' : 'happy', head: t > B.see ? 0.05 : -0.1 }, 1); }
      else if (t < B.fall) { const x = lerp(-40, PX - 10, seg(t, B.charge, B.fall)); oh = [x, -205]; oog(g, x, 0, { ...P.run(t * 14), eyes: 'angry', mouth: 'grit' }, 1); }
      else if (t < B.land + 0.3) {
        // Down the hole: clip everything below the hole's middle.
        const k = seg(t, B.fall, B.land);
        oh = [PX, -180 + k * 200];
        g.save(); g.beginPath(); g.rect(-2000, -2000, 4000, 2006); g.clip();
        oog(g, PX - 10, k * 260, P.slide(), 1); g.restore();
      }
      // Leaves burst up when he falls through.
      if (fell) for (let i = 0; i < 10; i++) { const r = rng(40 + i), u = (t - B.fall) / 1.4; if (u < 1) { g.fillStyle = '#7da244'; g.save(); g.translate(PX + (r() - 0.5) * 140 * u, -u * 160 * r() + u * u * 120); g.rotate(u * 8 + i); g.beginPath(); g.ellipse(0, 0, 11, 5, 0, 0, 7); g.fill(); g.restore(); } }
      // His arm comes up out of the hole, shaking the meat. Then it's gone too.
      if (t > B.arm) {
        const k = seg(t, B.arm, B.arm + 0.25), shakeA = Math.sin(t * 22) * 5, hx = PX + 6 + shakeA, hy = 6 - 70 * k;
        g.save(); g.beginPath(); g.rect(-2000, -2000, 4000, 2008); g.clip();
        g.strokeStyle = OOG.skin; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(PX + 2, 30); g.lineTo(hx, hy); g.stroke();
        g.fillStyle = OOG.skin; g.beginPath(); g.arc(hx, hy - 4, 9, 0, 7); g.fill();
        if (t < B.steal) meat(g, hx + 2, hy - 18, 1, -1.2);
        g.restore();
      }
      // The pup: turns up across the way, strolls over, takes the meat, peers in.
      if (t > B.pupB) {
        const x = t < B.land ? 185 : lerp(185, PX + 72, seg(t, B.land, B.steal - 0.05));
        const walking = t > B.land && t < B.steal - 0.05;
        pup(g, x, 0, t < B.land ? { pose: 'sit', t, dir: -1, tilt: 0.2 } : { pose: 'stand', walk: walking, ph: t * 14, t, dir: -1, carry: t > B.steal ? 'meat' : null, headDown: t > B.yip ? 0.35 : 0, tilt: t > B.yip ? 0.35 * Math.sin((t - B.yip) * 4) : 0, wag: t > B.steal ? 16 : 0 });
      }
    });
    foreground(g, 'day');
    caption(g, 'PLAN B', 210, fade(t, B.capB, 0.2) * (1 - fade(t, 16.9, 0.3)), 92, '#ffd24a');
    say(g, 'perfect', t, oh[0], oh[1], { side: 1 });
    say(g, 'whoa', t, oh[0], oh[1] - 20, { side: -1, big: true });
    pop(g, 'THUD!', 30, -60, t, B.land, 72, '#ffb04a', 0.9);
    pop(g, 'yip!', 110, -110, t, B.yip, 40, '#ffffff', 0.7, 0.1);
  },
  dusk(g, t) {
    setCam(t, 55, lerp(2.05, 2.2, seg(t, 22.4, 26.6)), 1000);
    backdrop(g, 'dusk', t);
    let oh = [0, -170];
    world(g, () => {
      camp(g, 'dusk'); logs(g, -60); flames(g, -60, t, 0.8);
      // Oog sulks with his back to the pup; the bone goes over his shoulder.
      const glanced = t > B.glance && t < B.lie - 0.1;
      seat(g, 60);
      {
        const toss = seg(t, B.toss - 0.15, B.toss + 0.1) * (1 - seg(t, B.toss + 0.35, B.toss + 0.7));
        const gnaw = t < B.toss - 0.2;
        const pose = SIT({
          rot: glanced ? 0 : 0.3, head: glanced ? 0 : 0.25,
          la: [1.0, 1.5], ra: gnaw ? [1.2, 1.7 + Math.sin(t * 9) * 0.1] : [lerp(1.2, -2.4, toss), lerp(1.5, 0.2, toss)],
          mouth: glanced ? (t > B.smile && t < B.smile + 0.5 ? 'smile' : 'flat') : gnaw ? (Math.sin(t * 9) > 0 ? 'chomp' : 'frown') : 'frown',
          eyes: glanced ? 'open' : t > B.lie ? 'closed' : 'angry',
        });
        const r = oog(g, 60, 0, pose, glanced ? 1 : -1);
        oh = [r.head[0], r.head[1] - 20];
        if (gnaw) bone(g, r.handF[0], r.handF[1] - 6, 1.1, 0.4);
      }
      // The bone's arc, and the pup that catches it.
      const fly = (t - B.toss) / (B.catch - B.toss);
      if (fly > 0 && fly < 1) bone(g, lerp(40, 190, fly), -150 - Math.sin(fly * Math.PI) * 90 + fly * 90, 1.1, fly * 12);
      const caught = t > B.catch;
      const jump = caught ? Math.max(0, Math.sin(clamp((t - B.catch + 0.15) / 0.4, 0, 1) * Math.PI)) * 22 : 0;
      pup(g, 200, -jump, { pose: 'sit', t, dir: -1, carry: caught ? 'bone' : null, wag: caught ? (glanced ? 22 : 14) : 0, eyes: caught && glanced ? 'happy' : 'open', ears: caught ? 'up' : 'back', tilt: caught ? 0 : 0.15 });
    });
    foreground(g, 'dusk');
    say(g, 'hmm', t, oh[0], oh[1], { side: -1 });
    night(g, 0.85 * seg(t, 26.1, 26.6));
  },
  night(g, t) {
    setCam(t, -30 + 50 * seg(t, B.creep, B.loom) - 50 * seg(t, B.wake, B.torch + 0.4), lerp(1.55, 1.65, seg(t, 26.6, B.woof)), 1000);
    backdrop(g, 'night', t);
    const FX = 10;
    let eye = null, eyeK = 0, fireK = t < B.torch ? 0.28 : lerp(0.28, 0.9, seg(t, B.torch, B.torch + 0.3));
    let torchTip = null;
    world(g, () => {
      camp(g, 'night'); logs(g, FX);
      // Oog: asleep on his back; wakes, sits up, grabs a burning stick.
      const sitUp = seg(t, B.wake, B.wake + 0.3), stand = t > B.torch;
      if (!stand) {
        const woke = t > B.wake;
        oog(g, -45, 0, sitUp < 0.5 ? LIE({ eyes: woke ? 'wide' : 'closed', mouth: woke ? 'o' : 'flat' }) : SIT({ eyes: 'wide', mouth: 'o', la: [0.4, 0.3], ra: [0.4, 0.3] }), 1, -Math.PI / 2 * (1 - sitUp), 0);
      } else {
        const wave = t > 32.45 ? Math.sin((t - 32.45) * 11) * 0.45 : 0, a = 2.3 + wave;
        const x = lerp(-45, -100, seg(t, B.torch + 0.1, 32.6));
        const r = oog(g, x, 0, { ra: [a, 0.15], la: [0.6, 0.6], eyes: 'angry', mouth: 'grit' }, 1);
        const [hx, hy] = r.handF;
        torchTip = [hx + Math.sin(a + 0.15) * 56, hy + Math.cos(a + 0.15) * 56];
        g.strokeStyle = '#5b3b22'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx - Math.sin(a) * 10, hy - Math.cos(a) * 10); g.lineTo(torchTip[0], torchTip[1]); g.stroke();
      }
      // The pup: wakes first, and stands between Oog and the dark.
      const stood = t > B.rise;
      if (!stood) pup(g, 75, 0, { pose: 'curl', t, headUp: seg(t, B.ear + 0.2, B.ear + 0.5), twitch: t > B.ear && t < B.ear + 0.3, dir: 1, eyes: 'wide' });
      else {
        const px = lerp(75, 95, seg(t, B.guard, B.guard + 0.6));
        const scared = t < B.woof;
        const barking = [B.woof, ...B.barks].some((b) => t > b - 0.02 && t < b + 0.22);
        pup(g, px, 0, { pose: scared && t > B.whimper ? 'crouch' : 'stand', walk: t > B.guard && t < B.guard + 0.6, ph: t * 12, t, dir: 1, tremble: scared, tuck: scared, ears: scared ? 'back' : 'up', mouth: barking ? 'open' : scared ? 'closed' : 'teeth', eyes: 'open', brave: !scared, lunge: barking ? -3 : 0 });
      }
      // The lion edges in out of the dark, looms, flinches, runs.
      if (t > B.creep) {
        const fleeing = t > B.flee;
        const x = fleeing ? lerp(275, 760, seg(t, B.flee, B.flee + 0.8)) : lerp(320, 275, seg(t, B.creep, B.loom));
        eye = lion(g, x, 0, { dir: fleeing ? 1 : -1, t, ph: t * (fleeing ? 12 : 3), run: fleeing, crouch: fleeing ? 0 : 0.6, roar: !fleeing && t > B.loom && t < B.flinch ? seg(t, B.loom, B.loom + 0.3) * (1 - seg(t, B.woof, B.woof + 0.2) * 0.6) : 0, flinch: t > B.flinch && !fleeing ? 1 : 0 });
        eyeK = fleeing ? 0 : 1;
      }
    });
    night(g, t < B.torch ? 0.6 : lerp(0.6, 0.42, seg(t, B.torch, B.torch + 0.3)));
    world(g, () => {
      flames(g, FX, t, fireK);
      if (torchTip) { g.save(); g.translate(0, torchTip[1] + 10); flames(g, torchTip[0], t * 1.3, 0.6); g.restore(); }
    });
    glow(g, FX, -30, 240, '255,150,60', 0.22 + fireK * 0.25);
    if (torchTip) glow(g, torchTip[0], torchTip[1], 300, '255,170,70', 0.32);
    stars(g, t); moon(g, 580, 190, 42);
    foreground(g, 'night');
    if (t > B.eyes && t < B.creep) eyeGlow(g, 210, -86, fade(t, B.eyes, 0.4), -1, Math.abs(t - 27.95) < 0.08 ? 1 : 0);
    else if (eye && eyeK) eyeGlow(g, eye[0], eye[1], 1, -1, 0);
    if (t < B.wake) { const [sx, sy] = toScreen(-215, -60); zzz(g, sx, sy, t, 3, 30); }
    pop(g, 'WOOF!', 130, -150, t, B.woof, 86, '#ffffff', 1.0, -0.1);
    B.barks.forEach((b, i) => pop(g, 'WOOF!', 130 + (i % 2) * 30, -160 - i * 18, t, b, 56, '#ffd24a', 0.35, i % 2 ? 0.1 : -0.1));
    if (t > 34.2) night(g, 0.9 * seg(t, 34.25, 34.6));
  },
  morning(g, t) {
    setCam(t, 5, lerp(2.3, 2.45, seg(t, 34.6, 40.6)), 1000);
    backdrop(g, 'morning', t);
    let oh = [-40, -170], heartAt = null;
    world(g, () => {
      camp(g, 'morning'); logs(g, 175); flames(g, 175, t, 0.35); seat(g, -60);
      // Oog shares his fish; the pup takes half, gets a pat, and licks his face.
      const broken = t > B.break, give = seg(t, B.give, B.give + 0.3), took = t > B.take;
      const pat = t > B.pat && t < B.lick;
      const licked = t > B.lick && t < B.lick + 0.9;
      const lean = pat ? 0.3 : 0;
      const pose = SIT({
        rot: lean,
        la: broken ? [1.0, 1.1] : [1.2, 1.3],
        ra: pat ? [1.55, 0.25 + Math.sin(t * 14) * 0.15] : took ? [0.9, 1.3] : [lerp(1.3, 1.55, give), lerp(1.3, 0.1, give)],
        eyes: licked ? 'happy' : t > B.pat ? 'happy' : 'open', mouth: licked ? 'grin' : 'smile', head: licked ? -0.25 : 0,
      });
      const r = oog(g, -60, 0, pose, 1);
      oh = [r.head[0], r.head[1] - 20];
      const [hx, hy] = r.handF, [bx, by] = r.handB;
      if (!broken) fish(g, (hx + bx) / 2 + 8, (hy + by) / 2 - 8, 1.1, -0.2);
      else {
        fish(g, bx + 4, by - 6, 1.1, -0.2, 1);
        if (!took) fish(g, hx + 10, hy - 6, 1.1, -0.2, 2);
      }
      const jumpK = licked ? Math.sin(clamp((t - B.lick) / 0.8, 0, 1) * Math.PI) : 0;
      pup(g, lerp(75, 5, jumpK), -jumpK * 80, { pose: 'sit', t, dir: -1, carry: took && t < B.pat ? 'half' : null, mouth: licked ? 'tongue' : t > B.pat - 0.2 && t < B.pat ? 'chew' : 'closed', eyes: t > B.pat ? 'happy' : 'open', wag: took ? 22 : 8, tilt: pat ? -0.25 : 0 });
      heartAt = [r.head[0] + 30, r.head[1] - 70];
    });
    foreground(g, 'morning');
    say(g, 'saved', t, oh[0], oh[1], { side: 1 });
    say(g, 'good', t, oh[0], oh[1], { side: 1 });
    if (t > B.heart) { const u = t - B.heart; const [sx, sy] = toScreen(heartAt[0], heartAt[1]); heart(g, sx, sy - u * 60, 2.4 * Math.min(1, u / 0.25 + 0.05) * (1 + Math.sin(u * 10) * 0.05)); }
    night(g, 0.9 * (1 - seg(t, 34.6, 35.0)));
  },
  end(g, t) {
    setCam(t, -110, lerp(2.0, 1.85, seg(t, 40.6, 46)), 1010);
    backdrop(g, 'night', t);
    world(g, () => {
      camp(g, 'night'); logs(g, 45);
      oog(g, -30, 0, LIE({ eyes: 'closed', mouth: 'smile' }), 1, -Math.PI / 2, 0);
      pup(g, -125, -30, { pose: 'curl', t, dir: 1 });
    });
    night(g, 0.4);
    world(g, () => flames(g, 45, t, 0.55));
    glow(g, 45, -30, 280, '255,150,60', 0.45);
    stars(g, t); moon(g, 570, 150, 46);
    foreground(g, 'night');
    { const [sx, sy] = toScreen(-225, -60); zzz(g, sx, sy, t, 3, 30); const [px, py] = toScreen(-80, -80); zzz(g, px, py, t + 0.7, 2, 20); }
    caption(g, 'More than 15,000 years ago, wolves became the first animals people ever tamed.', 300, fade(t, B.cap1, 0.5), 42);
    caption(g, 'Today we call them dogs.', 520, fade(t, B.cap2, 0.5), 48, '#ffd24a');
    titleCard(g, fade(t, B.endTitle, 0.3), 700);
    const f = seg(t, DURATION - 0.8, DURATION);
    if (f > 0) { g.fillStyle = `rgba(0,0,0,${f})`; g.fillRect(0, 0, W, H); }
  },
};

const ORDER = B.scenes.map(([id]) => id), START = B.scenes.map(([, t]) => t);
function frame(t) {
  let i = 0; while (i + 1 < ORDER.length && t >= START[i + 1]) i++;
  g.save(); S[ORDER[i]](g, t); g.restore();
  g.textAlign = 'left'; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const f = 1 - clamp(t / 0.25, 0, 1);
  if (f > 0) { g.fillStyle = `rgba(0,0,0,${f})`; g.fillRect(0, 0, W, H); }
}
window.DURATION = DURATION;
window.FPS = FPS;
window.renderFrame = (i) => frame(i / FPS);
window.ready = true;
if (!new URLSearchParams(location.search).has('render')) {
  const t0 = performance.now();
  const loop = () => { frame(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
