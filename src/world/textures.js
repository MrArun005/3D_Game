import * as THREE from 'three';
import { seed, rp, rr, ri } from '../core/rng.js';
import { ROAD_HALF, PARKING, LANE } from './metrics.js';

let anisotropy = 4;
export const setAnisotropy = (n) => { anisotropy = n; };
/** The value toTex() is handing out, for loaders that bypass the canvas path. */
export const anisotropyOf = () => anisotropy;

export function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Shift a hex colour toward white (k>0) or black (k<0), as a css string. */
export function shade(hex, k) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Scattered soft blobs — the base of every grimy surface here. */
export function noiseWash(g, w, h, n, alpha, tint) {
  for (let i = 0; i < n; i++) {
    const x = rp() * w, y = rp() * h, r = rr(w * 0.01, w * 0.09);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${tint},${rr(alpha * 0.4, alpha)})`);
    gr.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
}

/** Asphalt with the lane markings baked in. kind: 'road' (straight) | 'inter'. */
export function texAsphalt(kind) {
  seed(kind === 'road' ? 11 : 12);
  const S = 1024, c = cv(S, S), g = c.getContext('2d');
  const W = ROAD_HALF * 2;
  const px = S / W;

  g.fillStyle = '#25272b'; g.fillRect(0, 0, S, S);
  noiseWash(g, S, S, 900, 0.1, '14,15,18');
  noiseWash(g, S, S, 500, 0.07, '76,80,88');
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(${ri(110, 155)},${ri(110, 155)},${ri(115, 160)},${rr(0.04, 0.12)})`;
    g.fillRect(rp() * S, rp() * S, rr(1, 3), rr(1, 3));
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(18,19,22,${rr(0.2, 0.45)})`;
    g.beginPath();
    g.ellipse(rp() * S, rp() * S, rr(20, 90), rr(10, 50), rp() * 3, 0, 7);
    g.fill();
  }
  g.strokeStyle = 'rgba(14,15,18,0.55)'; g.lineWidth = 2.5;
  for (let i = 0; i < 8; i++) {
    const y = rp() * S;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + rr(-40, 40), S * 0.7, y + rr(-40, 40), S, y + rr(-30, 30));
    g.stroke();
  }

  const paint = 'rgba(206,208,202,0.78)';
  const line = (xm, wm, dash) => {
    g.fillStyle = paint;
    const x = xm * px, w2 = wm * px;
    if (!dash) { g.fillRect(x - w2 / 2, 0, w2, S); return; }
    const segment = 3.0 * px, gap = 4.5 * px;
    for (let y = 0; y < S; y += segment + gap) g.fillRect(x - w2 / 2, y, w2, segment);
  };

  if (kind === 'plain') {
    /* no paint at all: Halstead Bay's roads are 14m to 44m wide and its
       markings are geometry, so a baked-in lane layout would be wrong on
       every road but the one it was drawn for. */
  } else if (kind === 'road') {
    line(PARKING + 0.06, 0.12, false);
    line(W - PARKING - 0.06, 0.12, false);
    line(PARKING + LANE, 0.12, true);
    line(W - PARKING - LANE, 0.12, true);
    g.fillStyle = paint;
    g.fillRect((W / 2) * px - 0.3 * px, 0, 0.12 * px, S);
    g.fillRect((W / 2) * px + 0.18 * px, 0, 0.12 * px, S);
    g.globalAlpha = 0.32;
    for (let y = 0; y < S; y += 5.6 * px) {
      g.fillRect(0, y, PARKING * px * 0.55, 0.11 * px);
      g.fillRect(S - PARKING * px * 0.55, y, PARKING * px * 0.55, 0.11 * px);
    }
    g.globalAlpha = 1;
  } else {
    const band = 0.45 * px;
    for (const flip of [0, 1]) {
      g.save();
      if (flip) { g.translate(S, S); g.rotate(Math.PI); }
      for (let i = 0; i < 9; i++) {
        const bx = (PARKING + (i * (W - PARKING * 2)) / 9) * px;
        g.fillStyle = 'rgba(206,208,202,0.58)';
        g.fillRect(bx, 1.6 * px + band * 1.6, ((W - PARKING * 2) / 9) * px * 0.55, 3.0 * px);
      }
      g.fillStyle = 'rgba(206,208,202,0.68)';
      g.fillRect((W / 2) * px, 0.4 * px, (W / 2 - PARKING) * px, band);
      g.restore();
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(26,27,30,0.85)';
      g.beginPath(); g.arc(rr(0.2, 0.8) * S, rr(0.2, 0.8) * S, rr(8, 15), 0, 7); g.fill();
    }
  }
  return toTex(c);
}

/** Pavement slabs. */
export function texWalk() {
  seed(21);
  const S = 512, c = cv(S, S), g = c.getContext('2d');
  g.fillStyle = '#33353a'; g.fillRect(0, 0, S, S);
  const cols = 4, rows = 4, w = S / cols, h = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cols; x++) {
      g.fillStyle = shade(0x4a4d52, rr(-0.16, 0.1));
      g.fillRect(x * w + 2, r * h + 2, w - 4, h - 4);
      g.fillStyle = 'rgba(255,255,255,0.028)';
      g.fillRect(x * w + 2, r * h + 2, w - 4, 2.5);
    }
  }
  noiseWash(g, S, S, 260, 0.16, '20,21,24');
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(18,19,22,${rr(0.1, 0.3)})`;
    g.lineWidth = rr(0.5, 1.8);
    const x = rp() * S, y = rp() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-30, 30), y + rr(-30, 30)); g.stroke();
  }
  return toTex(c);
}

/** The soft sodium pool a street lamp throws, and the cone a headlight throws. */
export function texPool() {
  const S = 128, c = cv(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,196,124,0.62)');
  gr.addColorStop(0.35, 'rgba(255,172,92,0.2)');
  gr.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return toTex(c);
}

/** Vertical sky gradient. v=0 is the bottom pole, so the horizon sits at 0.5. */
/* Two skies. Day is not "night, brighter": the horizon haze has to be lighter
   AND less saturated than the zenith, or distant geometry never separates from
   the sky and the whole city reads as a flat cut-out. */
const SKY_DAY = [
  [0.00, '#8ea6bd'], [0.40, '#b9cbdc'], [0.482, '#dce7f0'], [0.50, '#e8f0f6'],
  [0.53, '#cddff0'], [0.64, '#93b6dd'], [0.80, '#5f8fcb'], [1.00, '#3d6cb0'],
];

export function texSky(day = false) {
  const c = cv(64, 512), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 512, 0, 0);
  if (day) {
    for (const [at, col] of SKY_DAY) gr.addColorStop(at, col);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 512);
    return toTex(c);
  }
  gr.addColorStop(0.0, '#090b11');
  gr.addColorStop(0.4, '#161c28');
  gr.addColorStop(0.485, '#4e3d4c');
  gr.addColorStop(0.505, '#a86f4a');
  gr.addColorStop(0.525, '#755f68');
  gr.addColorStop(0.6, '#33405c');
  gr.addColorStop(0.78, '#1d2942');
  gr.addColorStop(1.0, '#0d1424');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 512);
  return toTex(c);
}
