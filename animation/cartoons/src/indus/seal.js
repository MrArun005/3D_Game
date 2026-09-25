// The unicorn seal. On a real seal the picture is cut into the stone reversed,
// so the stamp in clay reads the right way round: here the seal's unicorn faces
// left and the impression's faces right. Strokes are in a 100 x 100 box.
import { TAU, clamp, rgba, rng, shade, glow } from './core.js';

const UNICORN = [
  [[20, 40], [35, 37], [55, 38], [68, 36]],                      // back
  [[68, 36], [74, 28], [78, 21]],                                // neck
  [[78, 21], [86, 22], [92, 28], [90, 32], [82, 31], [76, 35]],  // head and muzzle
  [[80, 20], [88, 11], [97, 6]],                                 // the single horn
  [[77, 20], [74, 13], [80, 17]],                                // ear
  [[76, 35], [74, 44], [70, 52]],                                // chest
  [[70, 52], [50, 54], [32, 53]],                                // belly
  [[20, 40], [17, 49], [24, 55]],                                // rump
  [[67, 52], [68, 63], [69, 75]], [[61, 53], [60, 64], [62, 75]], // front legs
  [[31, 54], [28, 64], [30, 75]], [[25, 53], [21, 63], [23, 75]], // back legs
  [[20, 40], [12, 46], [10, 57]], [[7, 56], [10, 62], [14, 57]], // tail and tuft
  [[69, 40], [76, 38]], [[68, 45], [75, 43]],                    // folds at the neck
  [[45, 38], [43, 53]], [[52, 38], [50, 53]],                    // the harness bands
  [[79, 45], [80, 51], [88, 51], [89, 45]], [[84, 51], [84, 75]], [[79, 75], [89, 75]], // the "standard" before it
];
const SIGNS = [
  [[[9, 6], [9, 15], [16, 15], [16, 6]], [[8, 8], [6, 10]], [[17, 8], [19, 10]]],   // jar
  [[[23, 6], [23, 16]], [[27, 6], [27, 16]]],                                        // two strokes
  [[[31, 11], [35, 7], [41, 11], [35, 15], [31, 11]], [[41, 11], [44, 8]], [[41, 11], [44, 14]]], // fish
  [[[50, 8], [50, 14]], [[47, 10], [53, 10]], [[50, 14], [47, 17]], [[50, 14], [53, 17]], [[49, 5], [51, 5], [51, 7], [49, 7], [49, 5]]], // man
  [[[57, 7], [64, 7]], [[58, 7], [58, 12]], [[60.5, 7], [60.5, 12]], [[63, 7], [63, 12]]],  // comb
];
const len = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const TOTAL = UNICORN.reduce((s, p) => s + len(p), 0);

// Draw the strokes, the first `reveal` fraction of their total length only.
function strokes(g, list, reveal, total) {
  let left = reveal * total;
  for (const pts of list) {
    if (left <= 0) break;
    const L = len(pts);
    g.setLineDash(left >= L ? [] : [left, 1e4]);
    g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke();
    left -= L;
  }
  g.setLineDash([]);
}

// mode 'seal': cut into cream steatite (sunken). 'impression': raised in clay.
export function sealFace(g, x, y, size, o = {}) {
  const mode = o.mode || 'seal', reveal = o.reveal ?? 1, signGlow = o.signGlow || [];
  const k = size / 100, stone = mode === 'seal';
  g.save(); g.translate(x - size / 2, y - size / 2);
  // The block.
  const base = stone ? '#e8dfca' : '#b9875a';
  if (stone) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.roundRect(size * 0.03, size * 0.05, size, size, size * 0.08); g.fill(); }
  const q = g.createLinearGradient(0, 0, size, size); q.addColorStop(0, shade(base, 0.12)); q.addColorStop(1, shade(base, -0.12));
  g.fillStyle = q; g.beginPath(); g.roundRect(0, 0, size, size, size * (stone ? 0.07 : 0.2)); g.fill();
  if (stone) { g.strokeStyle = shade(base, -0.3); g.lineWidth = size * 0.012; g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = size * 0.01; g.beginPath(); g.roundRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92, size * 0.05); g.stroke(); }
  // Surface texture.
  const r = rng(stone ? 3 : 8);
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '90,60,30' : '255,245,225'},${0.05 + r() * 0.08})`; g.beginPath(); g.arc(size * (0.05 + r() * 0.9), size * (0.05 + r() * 0.9), size * (0.002 + r() * 0.01), 0, TAU); g.fill(); }
  if (!stone) { g.strokeStyle = 'rgba(80,45,20,0.35)'; g.lineWidth = size * 0.008; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(size * (0.1 + i * 0.3), size * 0.98); g.quadraticCurveTo(size * (0.2 + i * 0.3), size * 0.8, size * (0.15 + i * 0.32), size * 0.7); g.stroke(); } }
  // The picture, mirrored on the stone.
  g.save();
  if (stone) { g.translate(size, 0); g.scale(-1, 1); }
  g.translate(size * 0.05, size * 0.12); g.scale(k * 0.9, k * 0.9);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const passes = stone
    ? [[4.6, 'rgba(60,40,20,0.85)', 0, 0], [3.2, 'rgba(140,110,80,0.9)', 0, 0], [1.6, 'rgba(255,250,235,0.6)', 0.9, 1.1]]
    : [[5, 'rgba(70,40,15,0.45)', 1.1, 1.3], [3.6, shade(base, 0.08), 0, 0], [1.4, 'rgba(255,225,180,0.7)', -0.6, -0.7]];
  // The body as a solid carved (or raised) area, under the outlines.
  const BODY = [[20, 40], [35, 37], [55, 38], [68, 36], [74, 28], [78, 21], [86, 22], [92, 28], [90, 32], [82, 31], [76, 35], [74, 44], [70, 52], [50, 54], [32, 53], [24, 55], [17, 49]];
  if (reveal > 0.35) {
    g.save(); g.globalAlpha = clamp((reveal - 0.35) / 0.4, 0, 1);
    g.beginPath(); g.moveTo(...BODY[0]); for (const p of BODY.slice(1)) g.lineTo(...p); g.closePath();
    g.fillStyle = stone ? 'rgba(120,90,60,0.35)' : 'rgba(255,220,170,0.28)'; g.fill();
    g.restore();
  }
  for (const [w, col, dx, dy] of passes) {
    g.save(); g.translate(dx, dy); g.strokeStyle = col; g.lineWidth = w;
    strokes(g, UNICORN, reveal, TOTAL);
    SIGNS.forEach((sg) => strokes(g, sg, clamp(reveal * 1.4 - 0.4, 0, 1), sg.reduce((s, p) => s + len(p), 0)));
    g.restore();
  }
  // Glowing signs (the mystery at the end).
  SIGNS.forEach((sg, i) => {
    const a = signGlow[i] || 0; if (a <= 0) return;
    g.save(); g.globalCompositeOperation = 'lighter'; g.shadowColor = '#ffc860'; g.shadowBlur = 22;
    g.strokeStyle = rgba('#ffd27a', a); g.lineWidth = 4.2; strokes(g, sg, 1, 1e9);
    g.strokeStyle = rgba('#fff6d8', a); g.lineWidth = 1.8; strokes(g, sg, 1, 1e9); g.restore();
  });
  g.restore();
  g.restore();
}
// A tiny seal held in a hand or a monkey's paw.
export function sealSmall(g, x, y, s = 1, rot = 0, sparkle = 0) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = '#2d1a10'; g.beginPath(); g.roundRect(-11 * s, -11 * s, 22 * s, 22 * s, 3 * s); g.fill();
  g.fillStyle = '#e8dfca'; g.beginPath(); g.roundRect(-9.5 * s, -9.5 * s, 19 * s, 19 * s, 2.5 * s); g.fill();
  g.strokeStyle = 'rgba(90,60,30,0.8)'; g.lineWidth = 1.4 * s; g.beginPath(); g.moveTo(-5 * s, 2 * s); g.lineTo(4 * s, 1 * s); g.lineTo(5 * s, -5 * s); g.moveTo(-4 * s, 2 * s); g.lineTo(-4 * s, 6 * s); g.moveTo(3 * s, 2 * s); g.lineTo(3 * s, 6 * s); g.stroke();
  g.restore();
  if (sparkle > 0) {
    glow(g, x, y, 40 * s, '#fff2c0', 0.6 * sparkle);
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(255,245,210,${sparkle})`; g.lineWidth = 2;
    const L = 22 * s * sparkle; g.beginPath(); g.moveTo(x - L, y); g.lineTo(x + L, y); g.moveTo(x, y - L); g.lineTo(x, y + L); g.stroke(); g.restore();
  }
}
