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

/**
 * Per-pixel dither, to break 8-bit banding in a smooth gradient.
 *
 * A vertical gradient over 512 px steps roughly every two pixels, and those
 * steps stretched across a 9000 m dome are Mach bands -- the eye reads the
 * interference between them and the sphere's own tessellation as a faint
 * moire. Half an LSB of noise per pixel removes it outright and is invisible
 * as noise. Seeded like everything else here, so the sky is identical on
 * every load.
 */
export function ditherCanvas(g, w, h, amp = 1.5) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rp() - 0.5) * 2 * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;      // Uint8ClampedArray clamps for us
  }
  g.putImageData(img, 0, 0);
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
  /* Hotter core, softer skirt. Tuned for the old direct-to-canvas rig, the
     0.62 peak barely registered once the frame went through the post stack:
     at night the street under a lamp read as tarmac with a faint stain. */
  gr.addColorStop(0, 'rgba(255,205,140,0.98)');
  gr.addColorStop(0.22, 'rgba(255,184,104,0.46)');
  gr.addColorStop(0.55, 'rgba(255,160,70,0.12)');
  gr.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return toTex(c);
}

/** Vertical sky gradient. v=0 is the bottom pole, so the horizon sits at 0.5. */
/* Two skies. Day is not "night, brighter": the horizon haze has to be lighter
   AND less saturated than the zenith, or distant geometry never separates from
   the sky and the whole city reads as a flat cut-out. */
/* The pale horizon is deliberate and stays: without aerial perspective the
   distant geometry never separates from the sky and the city reads as a flat
   cut-out. What was wrong was its WIDTH. The white ran 0.482..0.53, which is
   about 8 degrees of elevation, and from a street you are looking straight
   into that band -- every daytime frame read overcast-white even though the
   zenith was already a good deep blue nobody in a city ever looks at. Now the
   haze is a ~3.5 degree band sitting on the horizon line itself, with real
   blue by v 0.55 (about 9 degrees up), so aerial perspective still works
   where distant buildings actually meet the sky. */
const SKY_DAY = [
  [0.00, '#7f95ad'], [0.40, '#a8bccd'], [0.492, '#cfdae4'], [0.50, '#e7e5dd'],
  [0.512, '#c4d7ec'], [0.55, '#93b7de'], [0.66, '#6b9bd1'], [0.82, '#3f78bf'],
  [1.00, '#1f4f98'],
];


/**
 * A day sky with a sun in it and weather above the horizon.
 *
 * The old day sky was a 64px-wide vertical gradient: no sun, no cloud, no
 * variation around the compass, and every daytime frame read as milky because
 * the brightest thing in the sky was the same everywhere. This is 1024 wide so
 * features have a position: a hot disc with a glare halo at the light's
 * direction, a seeded band of cumulus with lit tops toward the sun, and a
 * zenith deep enough that the horizon haze reads as haze rather than as the
 * whole sky being pale.
 */
function texDaySky(sunDir) {
  const W = 1024, H = 512;
  const c = cv(W, H), g = c.getContext('2d');
  // canvas y = 0 is the top of the texture = v = 1 = zenith
  const gr = g.createLinearGradient(0, H, 0, 0);
  for (const [at, col] of SKY_DAY) gr.addColorStop(at, col);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  /* Break the ramp before anything is painted on top of it. The noiseWash
     further down only ever covered the top half, so the horizon -- the half
     you actually see from a street -- had no dither at all. Seeded on its own
     stream so the cloud placement below is byte-identical to before. */
  seed(17);
  ditherCanvas(g, W, H, 1.6);

  // where the sun sits on the dome
  let su = 0.62, sv = 0.78;
  if (sunDir) {
    const L = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
    const x = sunDir.x / L, y = sunDir.y / L, z = sunDir.z / L;
    sv = 1 - Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
    su = (Math.atan2(z, -x) / (2 * Math.PI) + 1) % 1;
  }
  const sx = su * W, sy = (1 - sv) * H;

  // glare: a broad warm halo the eye reads as brightness
  /* Cumulus FIRST, sun on top: the first pass painted the sun and then
     buried it under cloud. Eleven sparse clusters, not twenty-six dense ones
     -- the first pass fused into an unbroken overcast strip sitting on the
     horizon haze, which is what turned the sky white in every daytime frame.
     The band starts well above the horizon (v 0.58) so the clouds sit in blue,
     and no cluster is seeded within 100px (~35deg) of the sun. Seeded, so the same sky
     comes back on every load. */
  seed(31);
  const bandTop = H * 0.24, bandBot = H * 0.40;     // v 0.60..0.76
  let placed = 0, tries = 0;
  while (placed < 11 && tries++ < 200) {
    const cx = rp() * W, cy = bandTop + rp() * (bandBot - bandTop);
    if (Math.hypot(((cx - sx + W * 1.5) % W) - W / 2, cy - sy) < 100) continue;
    placed++;
    const size = 26 + rp() * 42;
    const puffs = 3 + Math.floor(rp() * 4);
    const towardSun = Math.sign(((sx - cx + W * 1.5) % W) - W / 2) || 1;
    for (let i = 0; i < puffs; i++) {
      const px = cx + rr(-1, 1) * size * 0.9, py = cy + rr(-0.35, 0.2) * size;
      const r = size * rr(0.35, 0.6);
      // a light grey underside, then a lit top over it
      const shade = g.createRadialGradient(px, py + r * 0.3, 0, px, py + r * 0.3, r * 0.9);
      shade.addColorStop(0, 'rgba(196,206,218,0.5)'); shade.addColorStop(1, 'rgba(196,206,218,0)');
      g.fillStyle = shade; g.beginPath(); g.ellipse(px, py + r * 0.3, r * 1.05, r * 0.55, 0, 0, 7); g.fill();
      const lit = g.createRadialGradient(px + towardSun * r * 0.25, py - r * 0.2, 0, px, py - r * 0.1, r * 0.9);
      lit.addColorStop(0, 'rgba(255,255,255,0.86)'); lit.addColorStop(0.55, 'rgba(250,252,255,0.42)'); lit.addColorStop(1, 'rgba(250,252,255,0)');
      g.fillStyle = lit; g.beginPath(); g.ellipse(px, py - r * 0.1, r, r * 0.68, 0, 0, 7); g.fill();
    }
  }
  // thin high haze so the zenith is not a flat fill
  noiseWash(g, W, Math.floor(H * 0.5), 900, 0.05, '235,242,250');
  // dusk: a warm wash rising from the horizon under a cooler zenith
  if (sunDir && sunDir.y < 100) {
    const warm = g.createLinearGradient(0, H * 0.5, 0, H * 0.2);
    warm.addColorStop(0, 'rgba(255,150,80,0.55)'); warm.addColorStop(0.5, 'rgba(255,170,110,0.25)'); warm.addColorStop(1, 'rgba(120,110,160,0)');
    g.fillStyle = warm; g.fillRect(0, H * 0.2, W, H * 0.3);
  }

  /* Glare and disc. The canvas is equirectangular, so a circle drawn here
     projects onto the dome squeezed by cos(elevation) horizontally -- at the
     sun's 48deg it came out as a tall oval. Both are drawn under an x-scale
     of 1/cos(el) so they project round. */
  const el = Math.asin(Math.min(1, Math.max(-1, sunDir.y / Math.hypot(sunDir.x, sunDir.y, sunDir.z))));
  const stretch = 1 / Math.max(0.3, Math.cos(el));
  g.save(); g.translate(sx, sy); g.scale(stretch, 1);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, 130);   // 130px = ~45deg of glare; 210 filled a whole frame
  halo.addColorStop(0, 'rgba(255,246,225,0.9)');
  halo.addColorStop(0.14, 'rgba(255,240,210,0.55)');
  halo.addColorStop(0.45, 'rgba(255,235,200,0.14)');
  halo.addColorStop(1, 'rgba(255,235,200,0)');
  g.fillStyle = halo; g.fillRect(-W, -H, 2 * W, 2 * H);
  // the disc itself: hard-edged, and big enough to be a sun rather than a star
  const disc = g.createRadialGradient(0, 0, 0, 0, 0, 18);
  disc.addColorStop(0, '#ffffff'); disc.addColorStop(0.78, '#fffaf0'); disc.addColorStop(1, 'rgba(255,250,240,0)');
  g.fillStyle = disc; g.beginPath(); g.arc(0, 0, 18, 0, 7); g.fill();
  g.restore();
  return toTex(c);
}

/**
 * `sunDir` (unit vector, world space) puts a sun disc on the day sky exactly
 * where the day light is, so the highlight on a bonnet and the glare in the
 * sky agree. The dome is a three SphereGeometry seen from inside: for a
 * direction (x, y, z), v = 1 - acos(y)/PI and u = atan2(z, -x)/2PI.
 */
export function texSky(day = false, sunDir = null) {
  if (day) return texDaySky(sunDir);
  const c = cv(64, 512), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 512, 0, 0);
  gr.addColorStop(0.0, '#090b11');
  gr.addColorStop(0.4, '#161c28');
  // city glow: the sodium band sits wider and warmer above the skyline (Phase 5)
  gr.addColorStop(0.47, '#4a3846');
  gr.addColorStop(0.495, '#8a5a44');
  gr.addColorStop(0.505, '#b8784c');
  gr.addColorStop(0.53, '#6e5560');
  gr.addColorStop(0.6, '#33405c');
  gr.addColorStop(0.78, '#1d2942');
  gr.addColorStop(1.0, '#0d1424');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 512);
  return toTex(c);
}

/**
 * Dry vs wet carriageway look. The frame loop used to write a "half-wet"
 * roughness / env / bump even when `wet` was 0, so a dry noon road kept the
 * night gloss and the asphalt grain specular-highlighted as cobbles.
 *
 * Dry: matte, almost-flat bump, env barely there.
 * Wet: roughness 0.14, env 3.7, bump faded so water fills the grain.
 */
export function wetTarmacLook(wet, night = 0) {
  const w = Math.max(0, Math.min(1, +wet || 0));
  const n = Math.max(0, Math.min(1, +night || 0));
  return {
    // night-dry ~0.44 so coloured point lights spec on the road; wet 0.14
    roughness: (0.82 - 0.38 * n) * (1 - w) + 0.14 * w,
    envMapIntensity: 0.25 + 3.45 * w,
    normalScale: 0.28 - 0.13 * w,
  };
}

/**
 * A normal map derived from a canvas's own luminance.
 *
 * The procedural surfaces here are painted as albedo only, so under a single
 * sun they have no micro-relief to catch light: tarmac at noon reads as a
 * sheet of grey plastic no matter how much aggregate is drawn into it. Sobel
 * over the luminance treats the paint as a height field, which is exactly what
 * it is -- dark specks are voids between stones, bright specks are the stones.
 *
 * `strength` is in height units per unit luminance; 1.0 is a strong relief.
 */
export function normalFromCanvas(canvas, strength = 1) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cv(w, h);
  const g = out.getContext('2d');
  const img = g.createImageData(w, h);
  const lum = (x, y) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return (src[i] * 0.2126 + src[i + 1] * 0.7152 + src[i + 2] * 0.0722) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel, so a single bright speck does not become a spike
      const dx = (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const dy = (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // a normal map is DATA, not colour: it must not go through the sRGB decode
  return toTex(out, false);
}
