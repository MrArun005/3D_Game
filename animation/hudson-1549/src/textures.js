// Every texture in the film, painted on a canvas at load time.
import * as THREE from 'three';
import { rng } from './rng.js';
import { WATER, MANHATTAN, CENTRAL_PARK, LGA_FIELD, ll, toLatLon, palisadesHeight } from './geo.js';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
export function tex(c, { srgb = true, repeat = false, flipY = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = flipY;
  t.anisotropy = aniso;
  return t;
}

// ---- ground ------------------------------------------------------------------
export const GROUND = { cx: 850, cz: -550, size: 32400, px: 4096 };
export function groundTexture() {
  const { cx, cz, size, px } = GROUND;
  const [c, g] = canvas(px, px);
  const k = px / size;
  const X = (x) => (x - (cx - size / 2)) * k;
  const Z = (z) => (z - (cz - size / 2)) * k;
  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, X(p.x), Z(p.z))); g.closePath(); };
  const R = rng(11);

  // Outer boroughs and New Jersey: grey-brown winter city, mottled by blocks.
  g.fillStyle = '#6b665d'; g.fillRect(0, 0, px, px);
  for (let i = 0; i < 90000; i++) {
    const s = 2 + R() * 7, l = 34 + R() * 16;
    g.fillStyle = `hsl(${30 + R() * 20}, ${6 + R() * 8}%, ${l}%)`;
    g.fillRect(R() * px, R() * px, s, s * (0.5 + R()));
  }
  // Arterial roads, a loose grid rotated per area.
  g.strokeStyle = 'rgba(70,68,64,0.8)'; g.lineWidth = 1.2;
  for (let i = 0; i < 700; i++) {
    const x = R() * px, y = R() * px, a = (R() < 0.5 ? 0.2 : 1.77) + (R() - 0.5) * 0.3, L = 40 + R() * 200;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  // Palisades plateau: woods.
  for (let y = 0; y < px; y += 3) for (let x = 0; x < px * 0.45; x += 3) {
    const wx = x / k + cx - size / 2, wz = y / k + cz - size / 2;
    if (palisadesHeight({ x: wx, z: wz }) > 80 && R() < 0.8) {
      g.fillStyle = `hsl(${25 + R() * 15}, ${12 + R() * 8}%, ${22 + R() * 10}%)`;
      g.fillRect(x, y, 3.5, 3.5);
    }
  }
  // Manhattan: the grid, rotated 29 degrees east of north.
  g.save(); poly(MANHATTAN); g.clip();
  g.fillStyle = '#5f5b56'; g.fillRect(0, 0, px, px);
  const o = ll(40.7580, -73.9855), a29 = 29 * Math.PI / 180;
  const along = [Math.sin(a29), -Math.cos(a29)], across = [Math.cos(a29), Math.sin(a29)];
  g.lineWidth = 1.6; g.strokeStyle = '#3c3b3a';
  for (let s = -14000; s <= 14000; s += 80) {        // streets
    const p = [o.x + along[0] * s, o.z + along[1] * s];
    g.beginPath(); g.moveTo(X(p[0] - across[0] * 4000), Z(p[1] - across[1] * 4000));
    g.lineTo(X(p[0] + across[0] * 4000), Z(p[1] + across[1] * 4000)); g.stroke();
  }
  g.lineWidth = 2.6;
  for (let s = -4000; s <= 4000; s += 260) {          // avenues
    const p = [o.x + across[0] * s, o.z + across[1] * s];
    g.beginPath(); g.moveTo(X(p[0] - along[0] * 14000), Z(p[1] - along[1] * 14000));
    g.lineTo(X(p[0] + along[0] * 14000), Z(p[1] + along[1] * 14000)); g.stroke();
  }
  g.restore();
  // Central Park in January: dun grass, bare trees.
  poly(CENTRAL_PARK); g.fillStyle = '#6a684f'; g.fill();
  g.save(); poly(CENTRAL_PARK); g.clip();
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `hsl(${35 + R() * 20}, 14%, ${22 + R() * 12}%)`;
    const p = CENTRAL_PARK[0];
    g.fillRect(X(p.x) - 60 + R() * 380, Z(p.z) - 320 + R() * 380, 2.5, 2.5);
  }
  g.restore();
  // LaGuardia's airfield.
  poly(LGA_FIELD); g.fillStyle = '#7b7870'; g.fill();

  // Water: cut out. The water plane underneath shows through the alpha test.
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (const w of WATER) { poly(w); g.fill(); }
  const res = ll(40.7858, -73.9624);   // the Reservoir
  g.beginPath(); g.ellipse(X(res.x), Z(res.z), 330 * k, 230 * k, -0.5, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  const t = tex(c, { flipY: false, aniso: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---- buildings -----------------------------------------------------------------
// Masonry: 4 bays x 8 storeys per tile (12 m x 24 m). Wall is near-white so the
// per-building vertex colour tints it.
export function masonryTexture() {
  const [c, g] = canvas(256, 256);
  const R = rng(3);
  g.fillStyle = '#e8e4dc'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(90,80,70,${R() * 0.06})`; g.fillRect(R() * 256, R() * 256, 3, 3); }
  for (let fy = 0; fy < 8; fy++) for (let fx = 0; fx < 4; fx++) {
    const l = 10 + R() * 18, lit = R() < 0.06;
    g.fillStyle = lit ? `hsl(45, 30%, ${50 + R() * 15}%)` : `hsl(${205 + R() * 20}, 18%, ${l}%)`;
    g.fillRect(fx * 64 + 16, fy * 32 + 7, 32, 20);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(fx * 64 + 16, fy * 32 + 7, 32, 4);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(fx * 64 + 14, fy * 32 + 27, 36, 2);
  }
  return tex(c, { repeat: true });
}
export function glassTexture() {
  const [c, g] = canvas(256, 256);
  const R = rng(5);
  for (let fy = 0; fy < 8; fy++) {
    for (let fx = 0; fx < 8; fx++) {
      g.fillStyle = `hsl(${200 + R() * 16}, ${14 + R() * 10}%, ${34 + R() * 16}%)`;
      g.fillRect(fx * 32, fy * 32, 32, 32);
    }
    g.fillStyle = '#b9bcbe'; g.fillRect(0, fy * 32 + 27, 256, 5);     // spandrel
  }
  g.fillStyle = 'rgba(210,214,218,0.9)';
  for (let fx = 0; fx < 8; fx++) g.fillRect(fx * 32, 0, 2, 256);        // mullions
  const grd = g.createLinearGradient(0, 0, 256, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return tex(c, { repeat: true });
}

// ---- the aircraft --------------------------------------------------------------
// u runs along the fuselage (0 = tail tip, 1 = nose), v around it
// (0 = keel, 0.25 = right side, 0.5 = crown, 0.75 = left side). flipY off.
export function liveryTexture(xMin, xMax) {
  const W = 2048, H = 512;
  const [c, g] = canvas(W, H);
  const U = (x) => (x - xMin) / (xMax - xMin) * W;
  const V = (v) => v * H;
  g.fillStyle = '#eef0f2'; g.fillRect(0, 0, W, H);                   // white upper
  // Pale silver-grey lower body, navy belly, a thin cheat line.
  const band = (v0, v1, col) => { g.fillStyle = col; g.fillRect(0, V(v0), W, V(v1) - V(v0)); };
  band(0.0, 0.14, '#1f2f52'); band(0.86, 1.0, '#1f2f52');
  band(0.14, 0.205, '#aeb4ba'); band(0.795, 0.86, '#aeb4ba');
  band(0.205, 0.214, '#b1242d'); band(0.786, 0.795, '#b1242d');
  // Cabin windows: 0.5 m pitch from x = -11.5 to +12.
  for (const [vc, dir] of [[0.30, 1], [0.70, -1]]) {
    for (let x = -11.3; x < 12.2; x += 0.53) {
      if (Math.abs(x - 1.4) < 0.35 || Math.abs(x - 0.5) < 0.2) continue; // over-wing exits
      g.fillStyle = '#2a3440';
      g.beginPath(); g.ellipse(U(x), V(vc), 0.14 / (xMax - xMin) * W, 0.026 * H, 0, 0, Math.PI * 2); g.fill();
    }
    // Doors: fore and aft, plus the over-wing exits.
    g.strokeStyle = 'rgba(60,70,80,0.7)'; g.lineWidth = 2;
    for (const [x, w, h] of [[12.9, 0.82, 0.11], [-12.4, 0.8, 0.11], [1.0, 0.5, 0.05], [0.4, 0.5, 0.05]]) {
      g.strokeRect(U(x - w / 2), V(vc - h * 0.6), U(x + w / 2) - U(x - w / 2), V(h * 1.2));
    }
    void dir;
  }
  // Cockpit windows near the nose.
  g.fillStyle = '#1c232c';
  for (const [vc, s] of [[0.36, 1], [0.64, -1]]) {
    g.beginPath();
    g.moveTo(U(16.0), V(vc - 0.02 * s)); g.lineTo(U(17.2), V(vc - 0.02 * s));
    g.lineTo(U(17.4), V(vc + 0.035 * s)); g.lineTo(U(16.2), V(vc + 0.045 * s));
    g.closePath(); g.fill();
    g.fillRect(U(15.3), V(Math.min(vc, vc + 0.04 * s)), U(15.9) - U(15.3), 0.04 * H);
  }
  g.beginPath(); g.moveTo(U(17.3), V(0.47)); g.lineTo(U(17.3), V(0.53)); g.lineTo(U(17.8), V(0.52)); g.lineTo(U(17.8), V(0.48)); g.fill();
  // Registration on the aft fuselage, both sides.
  g.fillStyle = '#26324a'; g.font = `bold ${0.035 * H}px sans-serif`; g.textAlign = 'center';
  g.save(); g.translate(U(-14.5), V(0.30)); g.scale(0.7, -1); g.fillText('N106US', 0, 0); g.restore();
  g.save(); g.translate(U(-14.5), V(0.70)); g.scale(-0.7, 1); g.fillText('N106US', 0, 0); g.restore();
  // Panel lines.
  g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
  for (let x = xMin; x < xMax; x += 1.6) { g.beginPath(); g.moveTo(U(x), 0); g.lineTo(U(x), H); g.stroke(); }
  return tex(c, { flipY: false, aniso: 8 });
}
export function tailTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#1f2f52'; g.fillRect(0, 0, 256, 256);
  // Diagonal flag stripes, abstract (not an airline mark).
  for (const [off, col] of [[40, '#b1242d'], [70, '#e9ecef'], [100, '#5c6f8f']]) {
    g.fillStyle = col; g.beginPath();
    g.moveTo(0, 256 - off); g.lineTo(256, 120 - off); g.lineTo(256, 140 - off); g.lineTo(0, 276 - off); g.fill();
  }
  return tex(c);
}
export function fanTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#121416'; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  for (let i = 0; i < 24; i++) {
    g.rotate(Math.PI * 2 / 24);
    g.fillStyle = i % 2 ? '#8b9096' : '#747a81';
    g.beginPath(); g.moveTo(22, -4); g.quadraticCurveTo(80, -2, 124, 10); g.lineTo(124, 22); g.quadraticCurveTo(80, 10, 22, 6); g.fill();
  }
  // Spinner with a painted swirl so rotation reads.
  g.fillStyle = '#d9dcdf'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1b1d20'; g.lineWidth = 5;
  g.beginPath(); for (let a = 0; a < 5; a += 0.1) { const r = a * 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke();
  return tex(c);
}

// ---- water ---------------------------------------------------------------------
// A tileable height field (integer wave numbers), turned into a normal map.
export function waterNormals(seed = 7) {
  const S = 512, R = rng(seed);
  const waves = [];
  for (let i = 0; i < 28; i++) {
    const k = 3 + Math.floor(R() * (i < 8 ? 6 : 26));
    const a = R() * Math.PI * 2;
    const kx = Math.round(Math.cos(a) * k), ky = Math.round(Math.sin(a) * k);
    if (!kx && !ky) continue;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.25), R() * Math.PI * 2]);
  }
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, amp, ph] of waves) {
      const q = 2 * Math.PI * (kx * x + ky * y) / S + ph;
      const d = Math.cos(q) * amp * 2 * Math.PI / S;
      dx += d * kx; dy += d * ky;
    }
    const s = 9;
    const n = [-dx * s, -dy * s, 1], l = Math.hypot(...n);
    const i = (y * S + x) * 4;
    img.data[i] = (n[0] / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (n[1] / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (n[2] / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

// ---- runway ----------------------------------------------------------------------
// 45 m wide; one texture length covers the whole 2,134 m runway (u across, v along).
export function runwayTexture(number) {
  const W = 256, H = 8192;
  const [c, g] = canvas(W, H);
  const R = rng(number.length * 13 + 1);
  g.fillStyle = '#3d3d3e'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R() * 0.06})`; g.fillRect(R() * W, R() * H, 2, 2); }
  const mPerPx = 2134 / H, m = (x) => x / mPerPx, a = (x) => x * W / 45;
  // Rubber marks in the touchdown zones.
  for (const z0 of [m(150), H - m(750)]) for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(15,15,15,${R() * 0.25})`; g.fillRect(a(16 + R() * 13), z0 + R() * m(600), 3, 20 + R() * 60);
  }
  g.fillStyle = '#e8e8e2';
  g.fillRect(a(1), 0, a(0.9), H); g.fillRect(a(43.1), 0, a(0.9), H);   // edge lines
  for (let z = m(170); z < H - m(170); z += m(60)) g.fillRect(a(22.05), z, a(0.9), m(36)); // centreline
  for (let i = 0; i < 12; i++) {                                                  // piano keys
    const x = a(3 + i * 3.4 + (i >= 6 ? 1.6 : 0));
    g.fillRect(x, m(6), a(1.8), m(30));
    g.fillRect(x, H - m(36), a(1.8), m(30));
  }
  for (const d of [150, 300, 450]) for (const s of [-1, 1]) {                    // TDZ bars
    g.fillRect(a(22.5 + s * 6 - 1), m(d), a(2), m(22));
    g.fillRect(a(22.5 + s * 6 - 1), H - m(d) - m(22), a(2), m(22));
  }
  for (const s of [-1, 1]) g.fillRect(a(22.5 + s * 7 - 3), m(400), a(6), m(45));  // aiming point
  g.font = `bold ${m(18)}px sans-serif`; g.textAlign = 'center';
  g.save(); g.translate(a(22.5), m(60)); g.scale(a(1) / m(1) * 5, -1); g.fillText(number, 0, 0); g.restore();
  const t = tex(c, { aniso: 16 });
  t.flipY = false;
  return t;
}

// ---- sky -------------------------------------------------------------------------
// Equirect, clear mid-January afternoon: sun low in the south-west.
export const SUN_AZ = 220 * Math.PI / 180, SUN_EL = 17 * Math.PI / 180;
export const SUN_DIR = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
export function skyTexture() {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const R = rng(21);
  // Value-noise for thin cirrus.
  const G = 64, grid = new Float32Array(G * G).map(() => R());
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const at = (i, j) => grid[((j % G + G) % G) * G + ((i % G + G) % G)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy;
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const zen = [44, 92, 168], mid = [110, 156, 212], hor = [205, 214, 222], glow = [255, 236, 200], below = [128, 134, 140];
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H, el = (v - 0.5) * Math.PI;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, phi = (u - 0.5) * 2 * Math.PI;
      const d = [Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)];
      const cosS = d[0] * SUN_DIR.x + d[1] * SUN_DIR.y + d[2] * SUN_DIR.z;
      let col;
      if (el < 0) col = mix(hor, below, Math.min(1, -el * 6));
      else {
        const e = el / (Math.PI / 2);
        col = e < 0.25 ? mix(hor, mid, Math.pow(e / 0.25, 0.8)) : mix(mid, zen, (e - 0.25) / 0.75);
        // Cirrus: streaks stretched along one direction, thin near the horizon.
        const n = noise(u * 9, v * 70) * 0.6 + noise(u * 26, v * 150) * 0.4;
        const cir = Math.max(0, n - 0.6) * 2.2 * Math.min(1, e * 5) * (1 - e);
        col = mix(col, [236, 238, 240], Math.min(0.55, cir));
      }
      const gl = Math.pow(Math.max(0, cosS), 12) * 0.55 + Math.pow(Math.max(0, cosS), 400) * 0.9;
      col = mix(col, glow, Math.min(1, gl));
      if (cosS > 0.99985) col = [255, 252, 240];
      const i = (y * W + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// ---- sprites ----------------------------------------------------------------------
export function softSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, inner); r.addColorStop(0.4, inner.replace(/[\d.]+\)$/, '0.6)')); r.addColorStop(1, outer);
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return tex(c);
}
export function puffSprite(seed = 1) {
  const [c, g] = canvas(128, 128);
  const R = rng(seed);
  for (let i = 0; i < 40; i++) {
    const x = 64 + (R() - 0.5) * 60, y = 64 + (R() - 0.5) * 60, r = 12 + R() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  return tex(c);
}

export { toLatLon };
