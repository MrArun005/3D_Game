// The city and the land: 2.5D baked-brick houses (front, lit side and roof), the
// citadel mound with the Great Bath, trees, reeds, the river and its boats.
import { W, H, TAU, clamp, lerp, rng, mix, shade, rgba, cached, pattern, brickTile, mudTile, glow, softShadow, cam } from './core.js';

// Oblique projection: depth runs up and to the right.
const OB = [0.62, -0.42];

// ---- a house -------------------------------------------------------------------------------------------------
// (x, y) is the front-left foot. sun: +1 lights the right side, -1 puts it in shade (sun behind/left).
export function house(g, x, y, w, h, o = {}) {
  const d = o.depth ?? Math.min(w * 0.5, 60), dx = d * OB[0], dy = d * OB[1];
  const sun = o.sun ?? 1, bs = o.brick ?? 0.3, r = rng(o.seed ?? 1);
  const plastered = o.plaster ?? r() < 0.35;
  const face = plastered ? pattern(g, mudTile(o.mud || '#c79b6c', 5), bs * 1.6, x, y) : pattern(g, brickTile(o.tint || '#b4643f', '#c8a27a', (o.seed ?? 1) % 4 + 1), bs, x, y);
  // Side face.
  g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + dx, y + dy); g.lineTo(x + w + dx, y - h + dy); g.lineTo(x + w, y - h); g.closePath();
  g.fillStyle = face; g.fill();
  g.fillStyle = sun > 0 ? 'rgba(255,170,90,0.28)' : 'rgba(40,20,40,0.45)'; g.fill();
  // Front face.
  g.fillStyle = face; g.fillRect(x, y - h, w, h);
  g.fillStyle = sun > 0 ? 'rgba(60,25,30,0.18)' : 'rgba(255,160,90,0.12)'; g.fillRect(x, y - h, w, h);
  // Ambient occlusion at the foot, a lip of light at the top.
  const ao = g.createLinearGradient(0, y - h * 0.35, 0, y); ao.addColorStop(0, 'rgba(40,20,10,0)'); ao.addColorStop(1, 'rgba(40,20,10,0.35)');
  g.fillStyle = ao; g.fillRect(x, y - h * 0.35, w, h * 0.35);
  // Roof (plastered mud) with a parapet.
  g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w, y - h); g.lineTo(x + w + dx, y - h + dy); g.lineTo(x + dx, y - h + dy); g.closePath();
  g.fillStyle = o.roof || '#d9bc8f'; g.fill();
  g.fillStyle = sun > 0 ? 'rgba(255,200,130,0.18)' : 'rgba(60,30,40,0.18)'; g.fill();
  g.fillStyle = shade(o.roof || '#d9bc8f', -0.12); g.fillRect(x - 1, y - h - 4, w + 2, 5);
  g.strokeStyle = 'rgba(50,25,15,0.55)'; g.lineWidth = 1.2;
  g.strokeRect(x, y - h, w, h);
  if (o.detail === false) return;
  // Openings: a doorway with a wooden door, small high windows with a lattice.
  if (o.door ?? r() < 0.55) {
    const dw = Math.min(w * 0.22, 26 * (h / 80)), dh = Math.min(h * 0.58, dw * 2), dx0 = x + w * (0.15 + r() * 0.5);
    g.fillStyle = '#3a2216'; g.fillRect(dx0, y - dh, dw, dh);
    g.fillStyle = '#7a4a2a'; g.fillRect(dx0 + dw * 0.12, y - dh + dh * 0.08, dw * 0.76, dh * 0.92);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(dx0 + dw * 0.48, y - dh + dh * 0.08, dw * 0.04, dh * 0.92);
    g.fillStyle = shade(o.roof || '#d9bc8f', -0.05); g.fillRect(dx0 - 3, y - dh - 5, dw + 6, 5);
  }
  const nw = w > 90 ? 2 : 1;
  for (let i = 0; i < nw; i++) if (r() < 0.8) {
    const ww = Math.min(14, w * 0.12) * (h / 80), wx = x + w * (0.2 + i * 0.5 + r() * 0.15), wy = y - h * 0.82;
    g.fillStyle = '#2a1a12'; g.fillRect(wx, wy, ww, ww * 0.9);
    g.strokeStyle = '#8a5a34'; g.lineWidth = Math.max(1, ww * 0.12);
    g.beginPath(); for (let k = 1; k < 3; k++) { g.moveTo(wx + ww * k / 3, wy); g.lineTo(wx + ww * k / 3, wy + ww * 0.9); g.moveTo(wx, wy + ww * 0.9 * k / 3); g.lineTo(wx + ww, wy + ww * 0.9 * k / 3); } g.stroke();
  }
  // Roof life: an upper room, pots, a line of drying cloth.
  const rx = x + dx * 0.5, ry = y - h + dy * 0.5;
  if (o.upper ?? r() < 0.3) house(g, x + w * 0.45, y - h + dy * 0.25, w * 0.4, h * 0.45, { ...o, depth: d * 0.5, seed: (o.seed ?? 1) + 7, upper: false, door: true, detail: true, plaster: plastered });
  else if (r() < 0.5) {
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) { const px = rx + w * 0.1 + r() * w * 0.6, s = h / 90; g.fillStyle = shade('#a8552f', r() * 0.2 - 0.1); g.beginPath(); g.ellipse(px, ry, 6 * s, 7 * s, 0, 0, TAU); g.fill(); g.fillStyle = '#6e3a20'; g.fillRect(px - 3 * s, ry - 8 * s, 6 * s, 3 * s); }
  }
  if (o.cloth ?? r() < 0.35) {
    const cy = ry - h * 0.28, x0 = rx + w * 0.05, x1 = rx + w * 0.8;
    g.strokeStyle = '#5a3a22'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, cy); g.quadraticCurveTo((x0 + x1) / 2, cy + 6, x1, cy); g.stroke();
    const cols = ['#c0392b', '#e6b33d', '#f2ead8', '#3a6fa0', '#8e3b6e'];
    for (let k = 0; k < 3; k++) { const cx = lerp(x0, x1, 0.2 + k * 0.28), cw = (x1 - x0) * 0.2; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.moveTo(cx, cy + 2); g.lineTo(cx + cw, cy + 2); g.lineTo(cx + cw * 0.95, cy + h * 0.25); g.lineTo(cx + cw * 0.05, cy + h * 0.26); g.fill(); }
  }
}

// ---- trees and plants ----------------------------------------------------------------------------------------------
export function palm(g, x, y, h, t = 0, o = {}) {
  const lean = (o.lean ?? 0.12) + Math.sin(t * 0.9 + x * 0.01) * 0.015, s = h / 300;
  const tx = x + Math.sin(lean) * h, ty = y - Math.cos(lean) * h;
  for (let i = 0; i < 16; i++) {
    const k0 = i / 16, k1 = (i + 1) / 16;
    const bend = (k) => [x + Math.sin(lean * (0.4 + 0.6 * k)) * h * k, y - h * k];
    const [ax, ay] = bend(k0), [bx, by] = bend(k1), w = lerp(15, 9, k0) * s;
    g.fillStyle = i % 2 ? (o.trunk || '#7a5634') : shade(o.trunk || '#7a5634', -0.12);
    g.beginPath(); g.moveTo(ax - w, ay); g.lineTo(bx - w * 0.95, by); g.lineTo(bx + w * 0.95, by); g.lineTo(ax + w, ay); g.fill();
  }
  const leaf = o.leaf || '#3e7a38', leaf2 = shade(leaf, 0.18);
  for (let i = 0; i < 11; i++) {
    const a = -Math.PI / 2 + (i - 5) * 0.34 + Math.sin(t * 1.3 + i * 1.7 + x) * 0.03, L = (120 + (i % 3) * 18) * s;
    const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.5 + L * 0.42 * Math.abs(Math.cos(a));
    const mx = tx + Math.cos(a) * L * 0.55, my = ty + Math.sin(a) * L * 0.55 - 18 * s;
    g.strokeStyle = i % 2 ? leaf : leaf2; g.lineWidth = 4 * s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
    g.lineWidth = 2.2 * s;
    for (let j = 2; j < 11; j++) {
      const k = j / 11, px = (1 - k) ** 2 * tx + 2 * (1 - k) * k * mx + k * k * ex, py = (1 - k) ** 2 * ty + 2 * (1 - k) * k * my + k * k * ey;
      const ll = 26 * s * Math.sin(k * Math.PI) + 6 * s;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a + 1.1) * ll, py + ll * 0.8); g.moveTo(px, py); g.lineTo(px + Math.cos(a - 1.1) * ll, py + ll * 0.8); g.stroke();
    }
  }
  g.fillStyle = '#8a4a1e'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(tx - 8 * s + i * 4 * s, ty + 10 * s + (i % 2) * 5 * s, 4.5 * s, 0, TAU); g.fill(); }
}
// A round-canopied tree (neem / pipal).
export function tree(g, x, y, h, o = {}) {
  const s = h / 260, r = rng(o.seed ?? 3), leaf = o.leaf || '#4d7f3a';
  g.fillStyle = o.trunk || '#6a4a30';
  g.beginPath(); g.moveTo(x - 12 * s, y); g.quadraticCurveTo(x - 6 * s, y - h * 0.4, x - 16 * s, y - h * 0.62); g.lineTo(x + 14 * s, y - h * 0.62); g.quadraticCurveTo(x + 6 * s, y - h * 0.4, x + 12 * s, y); g.fill();
  const blobs = [];
  for (let i = 0; i < 16; i++) blobs.push([x + (r() - 0.5) * 190 * s, y - h * 0.68 + (r() - 0.6) * 120 * s, (40 + r() * 36) * s]);
  for (const [bx, by, br] of blobs) { g.fillStyle = shade(leaf, -0.22); g.beginPath(); g.arc(bx + 6 * s, by + 8 * s, br, 0, TAU); g.fill(); }
  for (const [bx, by, br] of blobs) {
    const q = g.createRadialGradient(bx + br * 0.35 * (o.sun ?? 1), by - br * 0.4, br * 0.1, bx, by, br);
    q.addColorStop(0, shade(leaf, 0.28)); q.addColorStop(1, leaf);
    g.fillStyle = q; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
  }
}
export function reeds(g, x, y, w, h, t, o = {}) {
  const r = rng(o.seed ?? 11), n = o.n ?? Math.floor(w / 7);
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const bx = x + r() * w, hh = h * (0.5 + r() * 0.6), sway = Math.sin(t * 1.4 + bx * 0.02 + r() * 3) * 8 * (hh / h);
    g.strokeStyle = mix(o.col || '#6f8a3a', o.col2 || '#c9b25a', r()); g.lineWidth = (o.lw ?? 3) * (0.6 + r() * 0.6);
    g.beginPath(); g.moveTo(bx, y); g.quadraticCurveTo(bx + sway * 0.3, y - hh * 0.5, bx + sway, y - hh); g.stroke();
    if (r() < 0.35) { g.fillStyle = '#8a6a3a'; g.beginPath(); g.ellipse(bx + sway, y - hh - 8, 3, 10, sway * 0.02, 0, TAU); g.fill(); }
  }
}

// ---- the city, seen from the river at dawn (cached) ------------------------------------------------------------
// A 3400 x 900 picture: horizon fields, the citadel mound with the Great Bath and granary on the left,
// the grid of the lower town on the right. Ground line at y = 820.
export const CITY_W = 3400, CITY_H = 900, CITY_GROUND = 820;
export function cityPanorama(sun = 1, key = 'dawn') {
  return cached(`city-${key}`, CITY_W, CITY_H, (g) => {
    const r = rng(17);
    // Far fields and tree lines.
    g.fillStyle = '#b39a6a'; g.fillRect(0, 700, CITY_W, 200);
    for (let i = 0; i < 40; i++) { g.fillStyle = mix('#c9b060', '#8fa35a', r()); g.fillRect(r() * CITY_W, 700 + r() * 60, 120 + r() * 300, 8 + r() * 10); }
    for (let x = 0; x < CITY_W; x += 26) { const hh = 18 + r() * 26; g.fillStyle = rgba('#5d7a4a', 0.8); g.beginPath(); g.arc(x, 705 - hh * 0.3, hh * 0.6, 0, TAU); g.fill(); }
    // Citadel mound: battered brick retaining walls, a platform on top.
    const mx0 = 160, mx1 = 1420, top = 560;
    g.beginPath(); g.moveTo(mx0 - 60, CITY_GROUND); g.lineTo(mx0 + 30, top); g.lineTo(mx1 - 30, top); g.lineTo(mx1 + 60, CITY_GROUND); g.closePath();
    g.fillStyle = pattern(g, brickTile('#a95c3b', '#c19a72', 2), 0.42, 0, 0); g.fill();
    const mg = g.createLinearGradient(0, top, 0, CITY_GROUND); mg.addColorStop(0, 'rgba(255,180,110,0.15)'); mg.addColorStop(1, 'rgba(50,20,10,0.35)');
    g.fillStyle = mg; g.fill();
    g.fillStyle = '#cfae80'; g.fillRect(mx0 + 30, top - 6, mx1 - mx0 - 60, 8);
    // Bastions at the corners.
    for (const bx of [mx0 + 10, mx1 - 110]) house(g, bx, top + 4, 100, 120, { sun, depth: 50, brick: 0.4, seed: 3, door: false, cloth: false, upper: false, plaster: false });
    // The Great Bath building: a long low hall with a colonnade of openings.
    const bx0 = 400, bw = 420;
    house(g, bx0, top, bw, 70, { sun, depth: 90, brick: 0.4, seed: 5, door: false, cloth: false, upper: false, plaster: false, detail: false });
    for (let i = 0; i < 9; i++) { g.fillStyle = '#3a2016'; g.fillRect(bx0 + 22 + i * 44, top - 52, 20, 40); }
    // The granary: a raised brick base with a timber hall on it.
    house(g, 930, top, 300, 60, { sun, depth: 80, brick: 0.4, seed: 6, door: false, cloth: false, upper: false, plaster: false, detail: false });
    g.fillStyle = '#7a5334'; g.fillRect(950, top - 150, 260, 90);
    g.fillStyle = '#5a3a24'; for (let i = 0; i < 9; i++) g.fillRect(954 + i * 31, top - 150, 6, 90);
    g.beginPath(); g.moveTo(935, top - 150); g.lineTo(1080, top - 205); g.lineTo(1225, top - 150); g.closePath(); g.fillStyle = '#9a7a4e'; g.fill();
    // A few houses and trees on the mound.
    for (let i = 0; i < 6; i++) house(g, 180 + i * 38 + (i > 2 ? 900 : 0), top - 2, 34, 50, { sun, depth: 22, brick: 0.3, seed: 40 + i });
    tree(g, 880, top, 150, { seed: 8, sun }); palm(g, 1300, top, 220, 0, { lean: 0.1 }); palm(g, 360, top, 190, 0, { lean: -0.12 });
    // The lower town: rows receding, blocks separated by straight streets.
    for (let row = 5; row >= 0; row--) {
      const gy = CITY_GROUND - row * 34, s = 1 - row * 0.07;
      let x = 1440 + row * 20;
      while (x < CITY_W - 40) {
        const blockEnd = x + 260 + r() * 180;
        while (x < blockEnd && x < CITY_W - 40) {
          const w = (48 + r() * 60) * s, h = (60 + r() * 55) * s;
          house(g, x, gy, w, h, { sun, depth: 30 * s, brick: 0.26 * s, seed: Math.floor(r() * 1e6), plaster: r() < 0.3 });
          x += w + 1;
        }
        if (r() < 0.35 && row < 5) { tree(g, x + 18, gy - 4, (110 + r() * 60) * s, { seed: Math.floor(r() * 99), sun }); }
        x += 34 * s;                                      // a street
      }
    }
    // Palms at the edge of the town.
    for (let i = 0; i < 7; i++) palm(g, 1480 + r() * 1800, CITY_GROUND + 4, 170 + r() * 90, 0, { lean: (r() - 0.5) * 0.3 });
    // Warm dawn light across everything, deepening toward the ground.
    const q = g.createLinearGradient(0, 400, 0, CITY_GROUND); q.addColorStop(0, 'rgba(255,190,120,0.08)'); q.addColorStop(1, 'rgba(80,40,30,0.22)');
    g.fillStyle = q; g.fillRect(0, 400, CITY_W, CITY_GROUND - 400);
  });
}
export function smoke(g, x, y, t, h = 220, a = 0.25, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < 12; i++) {
    const u = ((t * 0.12 + i / 12 + r() * 0.05) % 1), px = x + u * 60 + Math.sin(u * 6 + seed) * 12, py = y - u * h, rr = 8 + u * 38;
    g.fillStyle = `rgba(230,215,200,${a * (1 - u) * Math.min(1, u * 6)})`; g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill();
  }
}

// ---- the river ------------------------------------------------------------------------------------------------------------
// Water from y0 down to y1 (screen space), coloured from the sky, with a sun path and ripples.
export function river(g, y0, y1, t, { top = '#f0b27a', bottom = '#2f5a6a', sunX = 1400, sunCol = '#ffe0a0', glint = 1 } = {}) {
  const q = g.createLinearGradient(0, y0, 0, y1); q.addColorStop(0, top); q.addColorStop(1, bottom);
  g.fillStyle = q; g.fillRect(0, y0, W, y1 - y0);
  const r = rng(5);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 260; i++) {
    const k = r(), y = y0 + (k ** 1.6) * (y1 - y0), spread = 40 + (y - y0) * 0.9;
    const x = sunX + (r() - 0.5) * spread * 2 + Math.sin(t * 1.5 + i) * 6;
    const len = 8 + (y - y0) * 0.12 + r() * 20, on = Math.sin(t * (3 + r() * 4) + i * 7) > 0.2;
    if (on) { g.fillStyle = rgba(sunCol, glint * (0.25 + r() * 0.5) * (1 - k * 0.5)); g.fillRect(x - len / 2, y, len, 1.5 + k * 2.5); }
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const y = y0 + 8 + (i / 26) ** 1.5 * (y1 - y0), x = ((i * 397 + t * (20 + i)) % (W + 400)) - 200, len = 60 + i * 8;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y - 2, x + len, y); g.stroke();
  }
}
// Reflect a cached picture in the water: flipped, wavy, darkened.
export function reflect(g, img, dx, dy, dw, dh, waterTop, t, a = 0.4) {
  const strips = 36, sh = dh / strips;
  g.save(); g.globalAlpha = a;
  for (let i = 0; i < strips; i++) {
    const off = Math.sin(t * 1.6 + i * 0.7) * (2 + i * 0.25);
    const sy = img.height - (i + 1) * (img.height / strips);
    g.drawImage(img, 0, sy, img.width, img.height / strips, dx + off, waterTop + i * sh * 0.55, dw, sh * 0.55 + 2.5);
  }
  g.restore();
  void dy;
}

// ---- boats ------------------------------------------------------------------------------------------------------------------
// A river boat like the one on an Indus seal: a long hull with high ends, a reed cabin, a mast and sail.
export function boat(g, x, y, s, t, o = {}) {
  const dir = o.dir ?? 1, sail = o.sail ?? 1, bob = Math.sin(t * 1.6 + x * 0.01) * 3 * s, roll = Math.sin(t * 1.2 + x) * 0.015;
  g.save(); g.translate(x, y + bob); g.rotate(roll); g.scale(dir * s, s);
  g.lineJoin = 'round'; g.lineCap = 'round';
  // Mast and sail behind the cabin.
  if (sail > 0) {
    g.strokeStyle = '#4a2e1a'; g.lineWidth = 5; g.beginPath(); g.moveTo(10, -30); g.lineTo(10, -250); g.stroke();
    const fill = Math.sin(t * 0.9) * 8 * sail;
    g.fillStyle = o.sailCol || '#eadbb8'; g.strokeStyle = '#6a4a2a'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-60, -236); g.lineTo(80, -236); g.quadraticCurveTo(100 + fill, -150, 84, -70); g.lineTo(-64, -70); g.quadraticCurveTo(-44 + fill, -150, -60, -236); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(120,80,40,0.35)'; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-60 + i * 35, -236); g.quadraticCurveTo(-45 + i * 35 + fill, -150, -62 + i * 36, -70); g.stroke(); }
    g.strokeStyle = '#4a2e1a'; g.lineWidth = 4; g.beginPath(); g.moveTo(-70, -238); g.lineTo(90, -238); g.moveTo(-70, -68); g.lineTo(92, -68); g.stroke();
    g.strokeStyle = 'rgba(60,40,20,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(10, -250); g.lineTo(-190, -18); g.moveTo(10, -250); g.lineTo(190, -22); g.stroke();
  }
  // Cabin of reed matting.
  g.fillStyle = '#c9a15e'; g.strokeStyle = '#5a3a1e'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(-90, -24); g.quadraticCurveTo(-90, -90, -30, -92); g.quadraticCurveTo(30, -90, 30, -24); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(90,60,30,0.5)'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-84 + i * 20, -26); g.quadraticCurveTo(-80 + i * 20, -70, -60 + i * 16, -88); g.stroke(); }
  // Cargo: bales of cotton, pots.
  if (o.cargo !== false) {
    for (const [bx, by, bw] of [[60, -26, 50], [110, -24, 44], [84, -56, 44]]) { g.fillStyle = '#efe6d2'; g.strokeStyle = '#6a5a44'; g.lineWidth = 2.5; g.beginPath(); g.roundRect(bx - bw / 2, by - 30, bw, 32, 8); g.fill(); g.stroke(); g.strokeStyle = '#8a6a3a'; g.beginPath(); g.moveTo(bx, by - 30); g.lineTo(bx, by + 2); g.moveTo(bx - bw / 2, by - 14); g.lineTo(bx + bw / 2, by - 14); g.stroke(); }
    g.fillStyle = '#a8552f'; g.beginPath(); g.ellipse(-120, -36, 16, 18, 0, 0, TAU); g.fill(); g.fillStyle = '#6e3a20'; g.fillRect(-127, -58, 14, 6);
  }
  // Hull: long, with a high curled prow and stern.
  const hull = () => { g.beginPath(); g.moveTo(-230, -70); g.quadraticCurveTo(-200, -30, -160, -20); g.lineTo(170, -20); g.quadraticCurveTo(220, -30, 250, -85); g.quadraticCurveTo(262, -100, 250, -104); g.quadraticCurveTo(222, -50, 150, 18); g.lineTo(-150, 18); g.quadraticCurveTo(-210, -10, -236, -68); g.quadraticCurveTo(-244, -80, -230, -70); g.closePath(); };
  hull();
  const hq = g.createLinearGradient(0, -40, 0, 20); hq.addColorStop(0, o.hull || '#8a5a34'); hq.addColorStop(1, shade(o.hull || '#8a5a34', -0.35));
  g.fillStyle = hq; g.fill(); g.strokeStyle = '#3a2212'; g.lineWidth = 3.5; g.stroke();
  g.strokeStyle = 'rgba(40,20,10,0.4)'; g.lineWidth = 2; for (const yy of [-8, 4]) { g.beginPath(); g.moveTo(-190, yy - 6); g.quadraticCurveTo(0, yy + 6, 200, yy - 12); g.stroke(); }
  g.fillStyle = '#c9a15e'; g.fillRect(-160, -24, 330, 6);
  // Steering oar at the stern.
  g.strokeStyle = '#5a3a1e'; g.lineWidth = 5; g.beginPath(); g.moveTo(-200, -60); g.lineTo(-270, 40); g.stroke();
  g.fillStyle = '#5a3a1e'; g.beginPath(); g.ellipse(-272, 44, 8, 22, 0.6, 0, TAU); g.fill();
  g.restore();
}

// ---- street level ---------------------------------------------------------------------------------------------------
// Packed-earth ground from y down, with cart ruts.
export function ground(g, x0, x1, y, depth = 600, base = '#c9a57a') {
  g.fillStyle = pattern(g, mudTile(base, 7), 1, 0, 0); g.fillRect(x0, y, x1 - x0, depth);
  const q = g.createLinearGradient(0, y, 0, y + depth); q.addColorStop(0, 'rgba(60,30,10,0.18)'); q.addColorStop(0.15, 'rgba(60,30,10,0)'); q.addColorStop(1, 'rgba(60,30,10,0.22)');
  g.fillStyle = q; g.fillRect(x0, y, x1 - x0, depth);
  g.strokeStyle = 'rgba(90,60,35,0.35)'; g.lineWidth = 3;
  for (const dy of [70, 110]) { g.beginPath(); g.moveTo(x0, y + dy); g.lineTo(x1, y + dy + 4); g.stroke(); }
}
// A covered brick drain running along the street at y (its top surface), with open inspection holes.
export function drain(g, x0, x1, y, o = {}) {
  const holes = o.holes || [], w = o.w ?? 46;
  g.fillStyle = pattern(g, brickTile('#a95c3b', '#bf9870', 3), 0.5, 0, y); g.fillRect(x0, y - 6, x1 - x0, 12);
  g.fillStyle = 'rgba(40,20,10,0.25)'; g.fillRect(x0, y + 4, x1 - x0, 3);
  // Cover bricks laid across.
  for (let x = Math.floor(x0 / 34) * 34; x < x1; x += 34) {
    if (holes.some((h) => x + 34 > h - w / 2 && x < h + w / 2)) continue;
    g.fillStyle = shade('#b8704a', ((x * 7919) % 13) / 60 - 0.1); g.beginPath(); g.roundRect(x + 1, y - 10, 32, 10, 2); g.fill();
    g.fillStyle = 'rgba(255,220,180,0.2)'; g.fillRect(x + 2, y - 10, 30, 2.5);
  }
  for (const h of holes) {
    g.fillStyle = '#1e120c'; g.beginPath(); g.roundRect(h - w / 2, y - 9, w, 12, 3); g.fill();
    if (o.water) { g.fillStyle = 'rgba(90,120,120,0.6)'; g.fillRect(h - w / 2 + 4, y - 2, w - 8, 3); }
    if (o.lid !== false) { g.fillStyle = '#9a5a3a'; g.beginPath(); g.roundRect(h + w / 2 + 2, y - 30, 12, 30, 3); g.fill(); g.strokeStyle = '#2d1a10'; g.lineWidth = 2; g.stroke(); }
  }
}
export function well(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = pattern(g, brickTile('#a95c3b', '#bf9870', 2), 0.45); g.beginPath(); g.ellipse(0, -30, 70, 22, 0, 0, Math.PI); g.lineTo(-70, -30); g.lineTo(-70, 0); g.ellipse(0, 0, 70, 22, 0, Math.PI, 0, true); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(0, -30, 70, 22, 0, 0, TAU); g.fillStyle = '#c9a07a'; g.fill(); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.stroke();
  g.beginPath(); g.ellipse(0, -30, 54, 15, 0, 0, TAU); g.fillStyle = '#140c08'; g.fill();
  g.fillStyle = 'rgba(120,160,170,0.35)'; g.beginPath(); g.ellipse(4, -26, 30, 6, 0, 0, TAU); g.fill();
  g.restore();
}
export function ladder(g, x, y, h, s = 1) {
  g.strokeStyle = '#6a4424'; g.lineWidth = 7 * s; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14 * s, y - h); g.moveTo(x + 40 * s, y); g.lineTo(x + 54 * s, y - h); g.stroke();
  g.lineWidth = 5 * s; for (let k = 0.1; k < 1; k += 0.14) { g.beginPath(); g.moveTo(x + 14 * s * k, y - h * k); g.lineTo(x + 40 * s + 14 * s * k, y - h * k); g.stroke(); }
}
export function pot(g, x, y, s = 1, col = '#a8552f', paint = true) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.moveTo(-12, -60); g.lineTo(12, -60); g.quadraticCurveTo(10, -50, 26, -40); g.quadraticCurveTo(40, -18, 18, 0); g.lineTo(-18, 0); g.quadraticCurveTo(-40, -18, -26, -40); g.quadraticCurveTo(-10, -50, -12, -60); g.closePath();
  const q = g.createLinearGradient(-30, 0, 30, 0); q.addColorStop(0, shade(col, 0.15)); q.addColorStop(1, shade(col, -0.3));
  g.fillStyle = q; g.fill(); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.stroke();
  if (paint) { g.strokeStyle = '#2a1510'; g.lineWidth = 3; g.beginPath(); g.moveTo(-30, -30); g.lineTo(30, -30); g.stroke(); g.lineWidth = 2; for (let i = -3; i <= 3; i++) { g.beginPath(); g.arc(i * 8, -22, 3, 0, Math.PI); g.stroke(); } }
  g.restore();
}
// A market stall: poles, a striped cloth awning with a scalloped edge, a table.
export function stall(g, x, y, w, col = '#c0452c', col2 = '#efe3c8', t = 0) {
  g.strokeStyle = '#5a3a1e'; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 220); g.moveTo(x + w, y); g.lineTo(x + w, y - 220); g.stroke();
  const sway = Math.sin(t * 1.5 + x) * 4;
  g.beginPath(); g.moveTo(x - 20, y - 250); g.lineTo(x + w + 20, y - 250); g.lineTo(x + w + 30, y - 190 + sway);
  const n = Math.round(w / 40);
  for (let i = n; i >= 0; i--) { const px = x - 30 + (w + 60) * (i / n); g.quadraticCurveTo(px + (w + 60) / n / 2, y - 172 + sway, px, y - 190 + sway); }
  g.closePath(); g.fillStyle = col; g.fill(); g.save(); g.clip();
  g.fillStyle = col2; for (let i = 0; i < n + 1; i += 2) g.fillRect(x - 30 + (w + 60) * (i / n), y - 260, (w + 60) / n, 100);
  g.fillStyle = 'rgba(40,20,10,0.18)'; g.fillRect(x - 40, y - 205, w + 80, 40);
  g.restore(); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#8a5a34'; g.fillRect(x - 10, y - 90, w + 20, 16); g.strokeRect(x - 10, y - 90, w + 20, 16);
  g.fillStyle = '#6a4424'; g.fillRect(x + 6, y - 74, 10, 74); g.fillRect(x + w - 16, y - 74, 10, 74);
}
export function beadBasket(g, x, y, s = 1, tip = 0, full = 1) {
  g.save(); g.translate(x, y); g.rotate(tip); g.scale(s, s);
  if (full > 0) { const r = rng(4); for (let i = 0; i < 40 * full; i++) { const bx = (r() - 0.5) * 70, by = -34 - r() * 16 * full; bead(g, bx, by, 5.2); } }
  g.beginPath(); g.moveTo(-44, -34); g.lineTo(44, -34); g.lineTo(34, 0); g.lineTo(-34, 0); g.closePath();
  g.fillStyle = '#b88a4a'; g.fill(); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(80,50,20,0.5)'; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-44 + i * 2.5, -34 + i * 8.5); g.lineTo(44 - i * 2.5, -34 + i * 8.5); g.stroke(); }
  g.restore();
}
export function bead(g, x, y, r = 5, col = '#c8452a') {
  g.fillStyle = col; g.beginPath(); g.ellipse(x, y, r * 1.2, r, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,220,190,0.75)'; g.beginPath(); g.arc(x - r * 0.4, y - r * 0.35, r * 0.35, 0, TAU); g.fill();
  g.fillStyle = 'rgba(40,10,5,0.5)'; g.beginPath(); g.arc(x + r * 0.5, y, r * 0.18, 0, TAU); g.fill();
}

// ---- the Great Bath ------------------------------------------------------------------------------------------------------
// Side view: a colonnade behind, the pool (water band) sunk below the pavement, steps at each end.
export function greatBath(g, x0, x1, y, t, o = {}) {
  const depth = o.depth ?? 150, waterY = y + 40;
  // Colonnade: brick piers with dark openings, a flat roof line.
  g.fillStyle = pattern(g, brickTile('#a95c3b', '#c19a72', 4), 0.55, 0, 0); g.fillRect(x0 - 200, y - 330, x1 - x0 + 400, 330);
  g.fillStyle = 'rgba(255,190,120,0.1)'; g.fillRect(x0 - 200, y - 330, x1 - x0 + 400, 330);
  for (let x = x0 - 160; x < x1 + 160; x += 150) { g.fillStyle = '#2a170e'; g.fillRect(x + 30, y - 260, 80, 260); g.fillStyle = 'rgba(255,200,140,0.08)'; g.fillRect(x + 30, y - 260, 10, 260); }
  g.fillStyle = '#d4b184'; g.fillRect(x0 - 220, y - 350, x1 - x0 + 440, 26); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.strokeRect(x0 - 220, y - 350, x1 - x0 + 440, 26);
  // Far pavement edge.
  g.fillStyle = '#c9a07a'; g.fillRect(x0 - 200, y - 8, x1 - x0 + 400, 12);
  // The pool: inner wall (brick, dark), water, near edge.
  g.fillStyle = pattern(g, brickTile('#8a4a2e', '#a57e5a', 5), 0.5, 0, 0); g.fillRect(x0, y, x1 - x0, depth);
  const wq = g.createLinearGradient(0, waterY, 0, y + depth); wq.addColorStop(0, '#5c9aa0'); wq.addColorStop(1, '#2c5a66');
  g.fillStyle = wq; g.fillRect(x0, waterY, x1 - x0, y + depth - waterY);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
  for (let i = 0; i < 16; i++) { const yy = waterY + 8 + (i % 4) * 22, xx = x0 + ((i * 173 + t * 30) % (x1 - x0)); g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + 30, yy - 3, xx + 60, yy); g.stroke(); }
  // Steps down at both ends.
  const n = Math.floor(depth / 30);
  for (const [sx, d] of [[x0, 1], [x1, -1]]) for (let i = 0; i < n; i++) {
    const w = 40 + (n - i) * 14, xx = d > 0 ? sx : sx - w;
    g.fillStyle = shade('#c9a07a', -i * 0.035); g.fillRect(xx, y + i * 30, w, 30); g.strokeStyle = 'rgba(45,26,16,0.5)'; g.lineWidth = 2; g.strokeRect(xx, y + i * 30, w, 30);
  }
}
export function bathEdge(g, x0, x1, y, depth) {
  // The near pavement, drawn over swimmers so they sit in the pool.
  g.fillStyle = pattern(g, brickTile('#b4643f', '#c8a27a', 1), 0.55, 0, 0); g.fillRect(x0 - 400, y + depth, x1 - x0 + 800, 600);
  g.fillStyle = '#d9b98c'; g.fillRect(x0 - 400, y + depth - 6, x1 - x0 + 800, 14); g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.strokeRect(x0 - 400, y + depth - 6, x1 - x0 + 800, 14);
}
export function splash(g, x, y, k, s = 1) {
  if (k <= 0 || k >= 1) return;
  const r = rng(12);
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.2, v = (200 + r() * 260) * s, px = x + Math.cos(a) * v * k, py = y + Math.sin(a) * v * k + 600 * k * k * s;
    g.fillStyle = `rgba(210,235,240,${0.9 * (1 - k)})`; g.beginPath(); g.arc(px, py, (5 + r() * 7) * s * (1 - k * 0.5), 0, TAU); g.fill();
  }
  g.strokeStyle = `rgba(230,245,250,${1 - k})`; g.lineWidth = 4 * s; g.beginPath(); g.ellipse(x, y + 10, 60 * s + k * 160 * s, 12 * s + k * 20 * s, 0, 0, TAU); g.stroke();
}

// ---- the river quay ----------------------------------------------------------------------------------------------------------
export function jetty(g, x0, x1, y, t) {
  for (let x = x0; x < x1; x += 90) { g.fillStyle = '#4a2e1a'; g.fillRect(x, y, 14, 140); }
  for (let x = x0; x < x1; x += 30) { g.fillStyle = shade('#8a5a34', ((x * 31) % 7) / 40 - 0.08); g.fillRect(x, y - 14, 29, 16); }
  g.strokeStyle = '#2d1a10'; g.lineWidth = 3; g.strokeRect(x0, y - 14, x1 - x0, 16);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y + 2, x1 - x0, 8);
  void t;
}
// Rolling dunes of sand for the epilogue, rising with k.
export function dunes(g, y, k, t, col = '#d9b27a') {
  for (let layer = 0; layer < 3; layer++) {
    const yy = y + (1 - k) * 500 + layer * 70, amp = 60 - layer * 12;
    g.fillStyle = shade(col, -layer * 0.08 + 0.05); g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, yy - Math.sin(x / (260 + layer * 60) + layer * 2 + t * 0.05) * amp - Math.sin(x / 90 + layer) * 8);
    g.lineTo(W, H); g.closePath(); g.fill();
  }
}

// The panorama with its ends faded out, for shots where it sits in one part of the frame.
export function cityFaded(sun, key, fadeL = 0, fadeR = 700) {
  return cached(`cityf-${key}-${fadeL}-${fadeR}`, CITY_W, CITY_H, (g) => {
    g.drawImage(cityPanorama(sun, key), 0, 0);
    g.globalCompositeOperation = 'destination-out';
    if (fadeR) { const q = g.createLinearGradient(CITY_W - fadeR, 0, CITY_W, 0); q.addColorStop(0, 'rgba(0,0,0,0)'); q.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = q; g.fillRect(CITY_W - fadeR, 0, fadeR, CITY_H); }
    if (fadeL) { const q = g.createLinearGradient(0, 0, fadeL, 0); q.addColorStop(0, 'rgba(0,0,0,1)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(0, 0, fadeL, CITY_H); }
  });
}
