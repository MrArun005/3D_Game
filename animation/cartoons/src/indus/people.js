// Characters: a clothed, outlined cartoon rig with 3/4 faces, plus the monkey,
// the zebu bull and its cart. Figures face +x; dir = -1 mirrors them.
// Pose angles: 0 = limb hanging straight down, positive = swung forward.
//   arms la/ra: [shoulder, elbow]  legs ll/rl: [hip, knee]  (knee < 0 bends back)
//   lean: torso tilt forward, head: head tilt, drop: hips lowered, bob: whole body up
//   eyes: open|wide|happy|closed|angry|sad|look  mouth: smile|grin|open|o|shout|frown|flat|teeth
import { TAU, clamp, lerp, mix, shade, rgba, softShadow, rng } from './core.js';

const OL = '#2d1a10';

export const SIYA = {
  kid: true, R: 27, neck: 5, torso: 44, thigh: 31, shin: 31, foot: 15, ua: 25, fa: 23, limb: 11,
  skin: '#bd7a4d', hair: '#1a110c', top: '#efe3c8', topTrim: '#c0452c', skirt: '#c0452c', trim: '#e7ad3c',
  braid: true, ribbon: '#e03a2a', bangles: 6, necklace: '#c83a2a', blush: true, eye: '#3a220f',
};
export const BABA = {
  R: 23, neck: 8, torso: 64, thigh: 46, shin: 45, foot: 19, ua: 35, fa: 33, limb: 13,
  skin: '#a5673f', hair: '#1c130d', top: null, skirt: '#efe7d6', trim: '#b53a2a', shawl: '#b53a2a', shawlDots: '#f4ead2',
  bun: true, beard: '#1c130d', band: '#e9d8a8', armband: '#d9a441', eye: '#2e1b0c',
};
export const MERCHANT = {
  R: 24, neck: 8, torso: 66, thigh: 46, shin: 45, foot: 19, ua: 35, fa: 33, limb: 14, belly: 1,
  skin: '#9c613b', hair: '#241810', top: null, skirt: '#d9a13a', trim: '#7a3a1a', shawl: '#2f5f7a', shawlDots: '#e9d59a',
  bun: true, beard: '#2a1c12', mustache: true, band: '#d9a441', armband: '#d9a441', eye: '#2e1b0c',
};
export function crowdLook(seed) {
  const r = rng(seed), kid = r() < 0.2, woman = r() < 0.5;
  const cloth = ['#efe7d6', '#c0452c', '#d9a13a', '#8a4a6e', '#3f6f5a', '#e6d2a8', '#a0522d'];
  const base = kid ? SIYA : BABA;
  return {
    ...base, braid: woman || kid, bun: !woman && !kid, beard: !woman && !kid && r() < 0.6 ? '#1c130d' : null, mustache: false,
    skin: mix('#8f5634', '#c68556', r()), skirt: cloth[Math.floor(r() * cloth.length)], trim: cloth[Math.floor(r() * cloth.length)],
    top: woman ? cloth[Math.floor(r() * cloth.length)] : null, shawl: !woman && r() < 0.3 ? '#b53a2a' : null, shawlDots: '#f4ead2',
    bangles: woman ? 4 : 0, necklace: woman ? '#c83a2a' : null, band: !woman && r() < 0.4 ? '#e9d8a8' : null, ribbon: '#e7ad3c', blush: false, belly: 0,
  };
}

const limbPath = (g, pts, w, col) => {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = OL; g.lineWidth = w + 5; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke();
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke();
};
const blob = (g, fill, lw = 3) => { g.fillStyle = fill; g.fill(); g.strokeStyle = OL; g.lineWidth = lw; g.stroke(); };
function chain(o, [a, b], l1, l2) {
  const e = [o[0] + Math.sin(a) * l1, o[1] + Math.cos(a) * l1];
  const h = [e[0] + Math.sin(a + b) * l2, e[1] + Math.cos(a + b) * l2];
  return [o, e, h];
}

// ---- the rig -------------------------------------------------------------------------------------------------
export function person(g, x, y, L, pose = {}, dir = 1, s = 1, t = 0) {
  const P = pose;
  g.save(); g.translate(x, y - (P.bob || 0) * s); g.scale(dir * s, s);
  softShadow(g, 0, 2 + (P.bob || 0), 34 + L.thigh * 0.6, 7, 0.3 * clamp(1 - (P.bob || 0) / 120, 0.2, 1));
  const legLen = L.thigh + L.shin;
  const hip = [0, -legLen + (P.drop || 0)];
  const lean = P.lean || 0;
  const sh = [hip[0] + Math.sin(lean) * L.torso, hip[1] - Math.cos(lean) * L.torso];
  const skinD = shade(L.skin, -0.2);
  const ll = chain(hip, P.ll || [-0.08, 0.05], L.thigh, L.shin), rl = chain(hip, P.rl || [0.1, 0.05], L.thigh, L.shin);
  const la = chain([sh[0] - 3, sh[1] + 5], P.la || [-0.15, -0.25], L.ua, L.fa), ra = chain([sh[0] + 3, sh[1] + 5], P.ra || [0.15, -0.25], L.ua, L.fa);
  const foot = (leg, col) => {
    const [, k, a] = leg, ang = Math.atan2(a[1] - k[1], a[0] - k[0]) - Math.PI / 2;
    g.save(); g.translate(a[0], a[1]); g.rotate(clamp(ang * 0.5, -0.8, 0.8));
    g.beginPath(); g.ellipse(L.foot * 0.35, 1, L.foot * 0.62, L.limb * 0.36, 0, 0, TAU); blob(g, col, 2.5); g.restore();
  };
  const hand = (arm, col, big = 1) => { const [, , h] = arm; g.beginPath(); g.arc(h[0], h[1], L.limb * 0.52 * big, 0, TAU); blob(g, col, 2.5); };
  // Back limbs, a shade darker.
  limbPath(g, ll, L.limb * 1.05, skinD); foot(ll, skinD);
  limbPath(g, la, L.limb * 0.85, skinD); hand(la, skinD);
  if (L.bangles) { for (let i = 0; i < L.bangles; i++) { const k = 0.35 + i * 0.09, bx = lerp(la[1][0], la[2][0], k), by = lerp(la[1][1], la[2][1], k); g.strokeStyle = '#f5efe2'; g.lineWidth = 3.2; g.beginPath(); g.ellipse(bx, by, L.limb * 0.62, 2.4, Math.atan2(la[2][1] - la[1][1], la[2][0] - la[1][0]) + Math.PI / 2, 0, TAU); g.stroke(); } }
  // Braid behind the head swings with the body.
  const hr = (P.head || 0) + lean * 0.5;
  const hc = [sh[0] + Math.sin(lean) * (L.neck + L.R) + 3, sh[1] - L.neck - L.R * 0.92];
  if (L.braid) {
    const swing = (P.swing ?? 0) + Math.sin(t * 7 + (P.ph || 0)) * (P.run ? 0.35 : 0.08);
    let bx = hc[0] - L.R * 0.7, by = hc[1] + L.R * 0.2, a = 0.5 + swing + (P.run ? 0.7 : 0);
    for (let i = 0; i < 6; i++) {
      const seg = L.R * 0.34;
      g.beginPath(); g.ellipse(bx, by, seg * 0.62, seg * 0.78, a, 0, TAU); blob(g, L.hair, 2.2);
      bx -= Math.sin(a) * seg * 1.05; by += Math.cos(a) * seg * 1.05; a += 0.12 + swing * 0.15;
    }
    g.fillStyle = L.ribbon; g.beginPath(); g.moveTo(bx, by - 3); g.lineTo(bx - 9, by + 14); g.lineTo(bx + 6, by + 12); g.closePath(); blob(g, L.ribbon, 2);
  }
  // Lower garment: a wrap from the waist to the knees, hem following the legs.
  const waistY = hip[1] - 6, k1 = ll[1], k2 = rl[1];
  const hemB = [Math.min(k1[0], k2[0]) - L.limb * 0.9, Math.max(k1[1], k2[1]) * 0.5 + hip[1] * 0.5 + (L.kid ? 12 : 14)];
  const hemF = [Math.max(k1[0], k2[0]) + L.limb * 0.9, Math.max(k1[1], k2[1]) * 0.5 + hip[1] * 0.5 + (L.kid ? 12 : 14)];
  const wF = L.kid ? 15 : 19, wB = L.kid ? 14 : 18;
  g.beginPath(); g.moveTo(hip[0] - wB, waistY);
  g.quadraticCurveTo(hemB[0] - 2, (waistY + hemB[1]) / 2, hemB[0], hemB[1]);
  g.quadraticCurveTo((hemB[0] + hemF[0]) / 2, Math.max(hemB[1], hemF[1]) + 6, hemF[0], hemF[1]);
  g.quadraticCurveTo(hemF[0] + 2, (waistY + hemF[1]) / 2, hip[0] + wF, waistY); g.closePath();
  blob(g, L.skirt, 3);
  g.save(); g.clip();
  g.strokeStyle = L.trim; g.lineWidth = 7; g.beginPath(); g.moveTo(hemB[0] - 4, hemB[1] - 3); g.quadraticCurveTo((hemB[0] + hemF[0]) / 2, Math.max(hemB[1], hemF[1]) + 3, hemF[0] + 4, hemF[1] - 3); g.stroke();
  g.strokeStyle = rgba(OL, 0.25); g.lineWidth = 2;
  for (const k of [0.35, 0.65]) { g.beginPath(); g.moveTo(lerp(hip[0] - wB, hip[0] + wF, k), waistY + 4); g.quadraticCurveTo(lerp(hemB[0], hemF[0], k) - 4, (waistY + hemB[1]) / 2, lerp(hemB[0], hemF[0], k), hemB[1]); g.stroke(); }
  g.fillStyle = 'rgba(40,20,10,0.12)'; g.fillRect(hip[0] - 40, waistY, 30, 80);
  g.restore();
  // Torso.
  g.save(); g.translate(hip[0], hip[1]); g.rotate(lean);
  const tw = L.kid ? 17 : 21, bw = L.kid ? 15 : 19 + (L.belly || 0) * 8;
  g.beginPath(); g.moveTo(-bw, -4); g.quadraticCurveTo(-bw - 2, -L.torso * 0.6, -tw * 0.9, -L.torso + 6);
  g.quadraticCurveTo(0, -L.torso - 6, tw, -L.torso + 6); g.quadraticCurveTo(bw + 6 + (L.belly || 0) * 10, -L.torso * 0.45, bw, -4); g.closePath();
  blob(g, L.top || L.skin, 3);
  if (L.top) { g.strokeStyle = L.topTrim || shade(L.top, -0.3); g.lineWidth = 3; g.beginPath(); g.arc(4, -L.torso + 4, 8, 0.2, Math.PI - 0.2); g.stroke(); }
  else { g.strokeStyle = rgba(OL, 0.3); g.lineWidth = 2; g.beginPath(); g.arc(tw * 0.3, -L.torso * 0.62, 6, 0.3, 1.8); g.stroke(); }
  // Shading on the back half of the torso.
  g.save(); g.clip(); g.fillStyle = 'rgba(40,20,10,0.16)'; g.fillRect(-bw - 10, -L.torso - 10, bw * 0.9, L.torso + 20); g.restore();
  if (L.shawl) {
    // The trefoil shawl, over the back shoulder and under the front arm.
    g.beginPath(); g.moveTo(-tw - 2, -L.torso + 2); g.lineTo(-tw + 16, -L.torso - 2); g.lineTo(bw + 6, -L.torso * 0.25); g.lineTo(bw - 2, -4); g.lineTo(bw - 16, -4); g.closePath();
    blob(g, L.shawl, 3);
    g.save(); g.clip();
    for (let i = 0; i < 16; i++) {
      const px = -tw + (i % 4) * 13 + (Math.floor(i / 4) % 2) * 6, py = -L.torso + 6 + Math.floor(i / 4) * 16;
      g.strokeStyle = L.shawlDots; g.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) { const a = k * TAU / 3 - Math.PI / 2; g.beginPath(); g.arc(px + Math.cos(a) * 3.2, py + Math.sin(a) * 3.2, 3, 0, TAU); g.stroke(); }
    }
    g.restore();
  }
  if (L.necklace) { for (let i = 0; i < 7; i++) { const a = 0.35 + i * 0.4; g.fillStyle = L.necklace; g.beginPath(); g.arc(4 + Math.cos(a) * 10, -L.torso + 4 + Math.sin(a) * 7, 2.6, 0, TAU); g.fill(); } }
  g.restore();
  // Front leg.
  limbPath(g, rl, L.limb * 1.05, L.skin); foot(rl, L.skin);
  // Head.
  head(g, hc, hr, L, P, t);
  // Front arm, with an armband.
  limbPath(g, ra, L.limb * 0.88, L.skin);
  if (L.armband) { const [o, e] = ra, bx = lerp(o[0], e[0], 0.35), by = lerp(o[1], e[1], 0.35); g.strokeStyle = L.armband; g.lineWidth = 4; g.beginPath(); g.ellipse(bx, by, L.limb * 0.6, 3, Math.atan2(e[1] - o[1], e[0] - o[0]) + Math.PI / 2, 0, TAU); g.stroke(); }
  hand(ra, L.skin);
  g.restore();
  const Wp = ([px, py]) => [x + px * s * dir, y + (py - (P.bob || 0)) * s];
  return { handF: Wp(ra[2]), handB: Wp(la[2]), head: Wp(hc), hip: Wp(hip), top: Wp([hc[0], hc[1] - L.R]) };
}

function head(g, hc, rot, L, P, t) {
  const R = L.R;
  g.save(); g.translate(hc[0], hc[1]); g.rotate(rot);
  // Hair behind: a bun for the men.
  if (L.bun) { g.beginPath(); g.arc(-R * 0.85, -R * 0.2, R * 0.42, 0, TAU); blob(g, L.hair, 2.5); }
  // Neck stub.
  g.fillStyle = L.skin; g.fillRect(-R * 0.3, R * 0.6, R * 0.55, R * 0.6);
  // Head: round cranium, a soft jaw toward the front.
  g.beginPath(); g.moveTo(-R, 0); g.arc(0, 0, R, Math.PI, Math.PI * 1.95);
  g.quadraticCurveTo(R * 1.12, R * 0.35, R * 0.62, R * 0.86); g.quadraticCurveTo(R * 0.1, R * 1.12, -R * 0.45, R * 0.85); g.quadraticCurveTo(-R * 1.02, R * 0.5, -R, 0); g.closePath();
  blob(g, L.skin, 3);
  // Ear.
  g.beginPath(); g.ellipse(-R * 0.3, R * 0.12, R * 0.17, R * 0.24, 0, 0, TAU); blob(g, shade(L.skin, -0.08), 2);
  // Hair cap.
  g.beginPath(); g.moveTo(-R * 1.03, R * 0.25); g.arc(0, -R * 0.02, R * 1.05, Math.PI * 0.95, Math.PI * 1.9);
  g.quadraticCurveTo(R * 0.7, -R * 0.55, R * 0.25, -R * 0.62); g.quadraticCurveTo(-R * 0.05, -R * 0.45, -R * 0.18, -R * 0.1); g.quadraticCurveTo(-R * 0.55, R * 0.05, -R * 1.03, R * 0.25); g.closePath();
  blob(g, L.hair, 2.5);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(-R * 0.35, -R * 0.62, R * 0.35, R * 0.1, -0.3, 0, TAU); g.fill();
  if (L.band) { g.strokeStyle = L.band; g.lineWidth = R * 0.16; g.beginPath(); g.arc(0, -R * 0.02, R * 0.98, Math.PI * 1.08, Math.PI * 1.88); g.stroke(); g.beginPath(); g.arc(R * 0.55, -R * 0.78, R * 0.12, 0, TAU); blob(g, '#e7c35a', 1.5); }
  // Beard (the priest-king style: a trimmed beard, upper lip shaved).
  if (L.beard) {
    g.beginPath(); g.moveTo(-R * 0.35, R * 0.45); g.quadraticCurveTo(-R * 0.2, R * 1.25, R * 0.35, R * 1.12); g.quadraticCurveTo(R * 0.85, R * 0.95, R * 0.95, R * 0.45); g.quadraticCurveTo(R * 0.55, R * 0.8, R * 0.1, R * 0.62); g.closePath();
    blob(g, L.beard, 2);
    if (L.mustache) { g.beginPath(); g.ellipse(R * 0.62, R * 0.42, R * 0.22, R * 0.07, -0.2, 0, TAU); blob(g, L.beard, 1.5); }
  }
  // Face (3/4 view): two eyes, the far one smaller.
  const e = P.eyes || 'open', blink = P.blink || (Math.sin(t * 1.9 + (L.R * 7)) > 0.985 && e === 'open');
  const look = P.look || [0.3, 0];
  const eye = (ex, ey, sc) => {
    const ew = R * 0.19 * sc, eh = R * 0.25 * sc;
    if (blink || e === 'closed') { g.strokeStyle = OL; g.lineWidth = 2.6; g.beginPath(); g.arc(ex, ey, ew, 0.2, Math.PI - 0.2); g.stroke(); return; }
    if (e === 'happy') { g.strokeStyle = OL; g.lineWidth = 3; g.beginPath(); g.arc(ex, ey + eh * 0.3, ew, Math.PI + 0.25, -0.25); g.stroke(); return; }
    const wide = e === 'wide' ? 1.25 : 1;
    g.fillStyle = '#fffaf0'; g.strokeStyle = OL; g.lineWidth = 2;
    g.beginPath(); g.ellipse(ex, ey, ew * wide, eh * wide, 0, 0, TAU); g.fill(); g.stroke();
    const ix = ex + look[0] * ew * 0.45, iy = ey + look[1] * eh * 0.4;
    g.fillStyle = L.eye || '#3a220f'; g.beginPath(); g.arc(ix, iy, ew * (e === 'wide' ? 0.55 : 0.72), 0, TAU); g.fill();
    g.fillStyle = '#0e0806'; g.beginPath(); g.arc(ix, iy, ew * 0.36, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ix + ew * 0.25, iy - ew * 0.3, ew * 0.22, 0, TAU); g.fill();
    // Upper lid line.
    g.strokeStyle = OL; g.lineWidth = 3.2; g.beginPath(); g.ellipse(ex, ey, ew * wide, eh * wide, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    if (e === 'angry' || e === 'sad') { g.fillStyle = L.skin; g.beginPath(); g.rect(ex - ew * 1.4, ey - eh * 1.6, ew * 2.8, eh * (e === 'angry' ? 0.95 : 0.8)); g.fill(); }
  };
  const nearX = R * 0.58, farX = R * 0.08, eyY = R * 0.05;
  eye(farX, eyY, 0.86); eye(nearX, eyY, 1);
  // Brows.
  const br = P.brow ?? (e === 'angry' ? -1 : e === 'sad' ? 1 : e === 'wide' ? 0.6 : 0);
  g.strokeStyle = L.hair; g.lineWidth = R * 0.1; g.lineCap = 'round';
  for (const [bx, sc] of [[farX, 0.86], [nearX, 1]]) {
    const by = eyY - R * 0.36 - (e === 'wide' ? R * 0.1 : 0);
    g.beginPath(); g.moveTo(bx - R * 0.16 * sc, by + br * R * 0.07 * (bx === nearX ? -1 : 1)); g.lineTo(bx + R * 0.16 * sc, by - br * R * 0.07 * (bx === nearX ? -1 : 1) + (br < 0 ? R * 0.08 : 0)); g.stroke();
  }
  // Nose, cheek, mouth.
  g.strokeStyle = OL; g.lineWidth = 2.4; g.beginPath(); g.moveTo(R * 0.86, R * 0.12); g.quadraticCurveTo(R * 1.02, R * 0.34, R * 0.8, R * 0.38); g.stroke();
  if (L.blush) { g.fillStyle = 'rgba(230,90,80,0.28)'; g.beginPath(); g.ellipse(R * 0.62, R * 0.42, R * 0.17, R * 0.1, 0, 0, TAU); g.fill(); }
  const m = P.mouth || 'smile', mx = R * 0.5, my = R * 0.66;
  g.strokeStyle = OL; g.lineWidth = 2.6; g.fillStyle = '#5a1c16';
  if (m === 'smile') { g.beginPath(); g.arc(mx, my - R * 0.1, R * 0.2, 0.3, Math.PI - 0.5); g.stroke(); }
  else if (m === 'grin' || m === 'open' || m === 'shout') {
    const h = m === 'shout' ? 0.34 : m === 'open' ? 0.24 : 0.16;
    g.beginPath(); g.moveTo(mx - R * 0.22, my - R * 0.05); g.quadraticCurveTo(mx, my + R * h * 1.4, mx + R * 0.24, my - R * 0.07); g.closePath(); g.fill(); g.stroke();
    if (m === 'grin') { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(mx - R * 0.18, my - R * 0.04); g.lineTo(mx + R * 0.2, my - R * 0.06); g.lineTo(mx + R * 0.14, my + R * 0.04); g.lineTo(mx - R * 0.12, my + R * 0.05); g.fill(); }
    else { g.fillStyle = '#e0706a'; g.beginPath(); g.ellipse(mx, my + R * h * 0.75, R * 0.1, R * 0.05, 0, 0, TAU); g.fill(); }
  } else if (m === 'o') { g.beginPath(); g.ellipse(mx + R * 0.03, my, R * 0.09, R * 0.12, 0, 0, TAU); g.fill(); g.stroke(); }
  else if (m === 'frown') { g.beginPath(); g.arc(mx, my + R * 0.16, R * 0.17, Math.PI + 0.5, -0.5); g.stroke(); }
  else if (m === 'teeth') { g.fillStyle = '#fff'; g.beginPath(); g.rect(mx - R * 0.2, my - R * 0.08, R * 0.4, R * 0.14); g.fill(); g.stroke(); }
  else { g.beginPath(); g.moveTo(mx - R * 0.16, my); g.lineTo(mx + R * 0.16, my - R * 0.02); g.stroke(); }
  g.restore();
}

// ---- poses ---------------------------------------------------------------------------------------------------------
export const P = {
  stand: (o = {}) => ({ la: [-0.1, 0.25], ra: [0.12, 0.3], ...o }),
  walk: (ph, o = {}) => { const s = Math.sin(ph); return { la: [-s * 0.45, 0.35], ra: [s * 0.45, 0.35], ll: [s * 0.42, -Math.max(0, s) * 0.7], rl: [-s * 0.42, -Math.max(0, -s) * 0.7], bob: Math.abs(Math.cos(ph)) * 3, ph, ...o }; },
  run: (ph, o = {}) => {
    const s = Math.sin(ph), c = Math.cos(ph);
    return { lean: 0.28, la: [-s * 0.95, 1.5], ra: [s * 0.95, 1.5], ll: [s * 0.95, -Math.max(0, s) * 1.5 - 0.25], rl: [-s * 0.95, -Math.max(0, -s) * 1.5 - 0.25], bob: Math.abs(c) * 10, run: true, ph, mouth: 'open', ...o };
  },
  leap: (k, o = {}) => ({ lean: 0.35, la: [2.4, -0.3], ra: [1.4, -0.6], ll: [1.2, -1.6], rl: [-0.7, -0.9], mouth: 'open', eyes: 'wide', run: true, ...o }),
  crouch: (o = {}) => ({ drop: 26, lean: 0.55, ll: [1.1, -1.9], rl: [1.3, -2.1], la: [0.9, -0.4], ra: [1.0, -0.3], ...o }),
  sitCarve: (ph, o = {}) => ({ drop: 42, lean: 0.25, ll: [1.45, -1.55], rl: [1.5, -1.5], la: [1.1, -1.1], ra: [1.05 + Math.sin(ph) * 0.08, -1.25], head: 0.25, eyes: 'look', look: [0.4, 0.8], ...o }),
  holdUp: (o = {}) => ({ ra: [2.05, 0.35], la: [-0.2, 0.3], head: -0.25, look: [0.6, -0.9], ...o }),
  reach: (o = {}) => ({ lean: 0.2, ra: [1.6, 0.1], la: [0.8, -0.2], ...o }),
  point: (o = {}) => ({ ra: [1.75, 0.05], la: [-0.1, 0.25], ...o }),
  shock: (o = {}) => ({ la: [-2.3, 0.4], ra: [1.9, 0.6], eyes: 'wide', mouth: 'shout', ...o }),
  wave: (ph, o = {}) => ({ ra: [2.1 + Math.sin(ph) * 0.3, 0.6], la: [-0.1, 0.25], mouth: 'open', ...o }),
  offer: (o = {}) => ({ ra: [1.35, 0.25], la: [-0.1, 0.25], ...o }),
  peer: (o = {}) => ({ drop: 20, lean: 1.0, head: 0.4, la: [1.4, -0.2], ra: [1.5, -0.2], ll: [0.5, -0.9], rl: [0.7, -1.1], ...o }),
  cheer: (ph, o = {}) => ({ la: [-2.5 + Math.sin(ph) * 0.2, 0.2], ra: [2.3 - Math.sin(ph) * 0.2, 0.3], bob: Math.abs(Math.sin(ph)) * 14, eyes: 'happy', mouth: 'grin', ...o }),
  swim: (ph, o = {}) => ({ lean: 1.3, la: [2.5 + Math.sin(ph) * 0.6, 0], ra: [2.5 - Math.sin(ph) * 0.6, 0], ll: [-0.2 + Math.sin(ph) * 0.3, 0], rl: [-0.2 - Math.sin(ph) * 0.3, 0], mouth: 'o', ...o }),
  slide: (o = {}) => ({ lean: -0.25, la: [2.0, -0.3], ra: [1.2, -0.5], ll: [0.9, -0.1], rl: [0.2, -0.2], eyes: 'wide', mouth: 'o', ...o }),
  climb: (ph, o = {}) => { const s = Math.sin(ph); return { lean: 0.1, la: [2.6 + s * 0.3, -0.2], ra: [2.6 - s * 0.3, -0.2], ll: [0.9 + s * 0.5, -1.5], rl: [0.9 - s * 0.5, -1.5], ...o }; },
};

// ---- the monkey (a rhesus macaque) ------------------------------------------------------------------------------
// pose: sit | run | leap | hang ; carry: a function drawing what's in its hand.
export function monkey(g, x, y, o = {}) {
  const s = o.s || 1, dir = o.dir || 1, t = o.t || 0, pose = o.pose || 'sit', ph = o.ph || 0;
  g.save(); g.translate(x, y); g.scale(dir * s, s); g.lineCap = 'round'; g.lineJoin = 'round';
  const FUR = '#8a6a4a', FUR2 = '#6e523a', FACE = '#e8a08a';
  if (pose !== 'leap' && pose !== 'hang') softShadow(g, 0, 2, 40, 6, 0.25);
  const run = pose === 'run', leap = pose === 'leap';
  const bob = run ? -Math.abs(Math.sin(ph)) * 10 : 0;
  g.translate(0, bob);
  // Tail.
  const tw = Math.sin(t * 3 + ph) * 0.3;
  g.strokeStyle = OL; g.lineWidth = 9; g.beginPath(); g.moveTo(-26, -34); g.bezierCurveTo(-60, -40 + tw * 20, -80, -80 - tw * 30, -60, -100); g.stroke();
  g.strokeStyle = FUR2; g.lineWidth = 5; g.beginPath(); g.moveTo(-26, -34); g.bezierCurveTo(-60, -40 + tw * 20, -80, -80 - tw * 30, -60, -100); g.stroke();
  const leg = (hx, hy, a, b, col, len = 22) => limbPath(g, chain([hx, hy], [a, b], len, len), 8, col);
  const sw = run ? Math.sin(ph) * 0.8 : 0;
  if (pose === 'sit') { leg(-10, -24, 1.3, -2.2, FUR2); leg(14, -40, 0.4, -0.6, FUR2, 20); }
  else if (leap) { leg(-16, -34, -1.3, 0.2, FUR2); leg(18, -40, 1.9, 0.2, FUR2, 20); }
  else { leg(-16, -28, sw, -0.5, FUR2); leg(18, -36, -sw, 0.3, FUR2, 20); }
  // Body.
  g.beginPath();
  if (pose === 'sit') g.ellipse(0, -40, 24, 30, -0.25, 0, TAU); else g.ellipse(0, -40, 34, 20, leap ? -0.15 : 0.05, 0, TAU);
  blob(g, FUR, 3);
  g.fillStyle = 'rgba(255,220,180,0.25)'; g.beginPath(); g.ellipse(6, -34, 14, 12, 0, 0, TAU); g.fill();
  if (pose === 'sit') { leg(4, -24, 1.4, -2.2, FUR); leg(14, -50, o.reach ? 2.4 : 0.9, o.reach ? 0.1 : -1.4, FUR, 20); }
  else if (leap) { leg(-12, -34, -1.1, 0.1, FUR); leg(22, -44, 2.1, 0.1, FUR, 20); }
  else { leg(-12, -28, -sw, -0.5, FUR); leg(22, -36, sw, 0.3, FUR, 20); }
  // Head.
  const hx = pose === 'sit' ? 14 : 36, hy = pose === 'sit' ? -78 : -58;
  g.save(); g.translate(hx, hy); g.rotate(o.tilt || 0);
  for (const ex of [-12, 10]) { g.beginPath(); g.arc(ex - 4, -4, 7, 0, TAU); blob(g, FACE, 2); }
  g.beginPath(); g.arc(0, 0, 19, 0, TAU); blob(g, FUR, 3);
  g.beginPath(); g.ellipse(6, 4, 13, 11, 0, 0, TAU); blob(g, FACE, 2);
  g.fillStyle = '#fffaf0'; for (const ex of [1, 11]) { g.beginPath(); g.arc(ex, 0, 3.6, 0, TAU); g.fill(); }
  g.fillStyle = '#1a0f08'; for (const ex of [2, 12]) { g.beginPath(); g.arc(ex, 0.5, 2.2, 0, TAU); g.fill(); }
  g.strokeStyle = OL; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-3, -6); g.lineTo(6, -5); g.moveTo(9, -5); g.lineTo(16, -7); g.stroke();
  const mo = o.mouth || 'closed';
  if (mo === 'open') { g.fillStyle = '#5a1c16'; g.beginPath(); g.ellipse(9, 10, 5, 4.5, 0, 0, TAU); g.fill(); }
  else if (mo === 'tongue') { g.fillStyle = '#e0706a'; g.beginPath(); g.ellipse(11, 12, 3.5, 5, 0.2, 0, TAU); g.fill(); g.strokeStyle = OL; g.lineWidth = 1.5; g.stroke(); }
  else { g.beginPath(); g.arc(8, 7, 4, 0.3, Math.PI - 0.3); g.stroke(); }
  g.restore();
  if (o.carry) { const cx = pose === 'sit' ? (o.reach ? 30 : 26) : 50, cy = pose === 'sit' ? (o.reach ? -96 : -66) : -26; o.carry(g, cx, cy); }
  g.restore();
}

// ---- the zebu bull and cart ------------------------------------------------------------------------------------------
export function zebu(g, x, y, o = {}) {
  const s = o.s || 1, dir = o.dir || 1, ph = o.ph || 0;
  g.save(); g.translate(x, y); g.scale(dir * s, s); g.lineCap = 'round';
  softShadow(g, 0, 2, 90, 10, 0.3);
  const BODY = '#e6dccb', DARK = '#b8ac98';
  for (const [hx, k] of [[-56, 0], [48, 1]]) { const a = Math.sin(ph + k * Math.PI + 1) * 0.35; limbPath(g, chain([hx, -58], [a, -a * 0.3], 32, 30), 12, DARK); }
  g.beginPath(); g.ellipse(-4, -80, 78, 36, 0, 0, TAU); blob(g, BODY, 3);
  g.beginPath(); g.moveTo(34, -108); g.quadraticCurveTo(44, -142, 66, -112); g.closePath(); blob(g, BODY, 3);               // the hump
  g.beginPath(); g.moveTo(60, -64); g.quadraticCurveTo(76, -30, 92, -62); g.closePath(); blob(g, DARK, 2.5);                 // dewlap
  for (const [hx, k] of [[-44, 1], [58, 0]]) { const a = Math.sin(ph + k * Math.PI) * 0.35; limbPath(g, chain([hx, -58], [a, -a * 0.3], 32, 30), 12, BODY); }
  g.strokeStyle = OL; g.lineWidth = 6; g.beginPath(); g.moveTo(-80, -92); g.quadraticCurveTo(-100, -70, -94, -40); g.stroke();
  g.save(); g.translate(92, -92); g.rotate(0.35 + Math.sin(ph * 2) * 0.04);
  g.beginPath(); g.moveTo(-8, -14); g.quadraticCurveTo(-26, -40, -12, -58); g.quadraticCurveTo(-18, -36, 0, -18); blob(g, '#8a7a60', 2);   // horns curving up
  g.beginPath(); g.moveTo(8, -16); g.quadraticCurveTo(10, -44, 26, -56); g.quadraticCurveTo(18, -34, 16, -14); blob(g, '#8a7a60', 2);
  g.beginPath(); g.ellipse(-16, -6, 16, 7, -0.5, 0, TAU); blob(g, BODY, 2);                                                   // ear
  g.beginPath(); g.moveTo(-14, -16); g.quadraticCurveTo(10, -26, 22, -6); g.quadraticCurveTo(36, 20, 34, 38); g.quadraticCurveTo(24, 52, 8, 44); g.quadraticCurveTo(-12, 22, -14, -16); blob(g, BODY, 3);
  g.beginPath(); g.ellipse(24, 40, 13, 10, -0.3, 0, TAU); blob(g, '#c9a89a', 2.5);                                            // muzzle
  g.fillStyle = '#3a2418'; g.beginPath(); g.ellipse(28, 40, 2.5, 2, 0, 0, TAU); g.fill();
  g.fillStyle = '#1a0f08'; g.beginPath(); g.arc(8, 2, 3.4, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(9, 1, 1.1, 0, TAU); g.fill();
  g.restore();
  g.restore();
}
// A two-wheeled cart with solid wooden wheels (like the Indus clay toy carts).
export function cart(g, x, y, o = {}) {
  const s = o.s || 1, dir = o.dir || 1, roll = o.roll || 0;
  g.save(); g.translate(x, y); g.scale(dir * s, s);
  g.strokeStyle = OL; g.lineWidth = 6; g.beginPath(); g.moveTo(40, -58); g.lineTo(150, -70); g.stroke();
  g.beginPath(); g.moveTo(-90, -60); g.lineTo(50, -60); g.lineTo(50, -110); g.lineTo(-90, -110); g.closePath(); blob(g, '#9a6a3e', 3);
  g.strokeStyle = 'rgba(40,20,10,0.35)'; g.lineWidth = 2; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(-90 + i * 28, -60); g.lineTo(-90 + i * 28, -110); g.stroke(); }
  if (o.load !== false) for (const [bx, by] of [[-60, -120], [-20, -122], [18, -118], [-40, -150]]) { g.beginPath(); g.roundRect(bx - 22, by - 16, 44, 32, 9); blob(g, '#efe6d2', 2.5); }
  g.save(); g.translate(-20, -40); g.rotate(roll);
  g.beginPath(); g.arc(0, 0, 40, 0, TAU); blob(g, '#7a5232', 3.5);
  g.strokeStyle = 'rgba(40,20,10,0.5)'; g.lineWidth = 2.5; for (const k of [-14, 0, 14]) { g.beginPath(); g.moveTo(k, -38); g.lineTo(k, 38); g.stroke(); }
  g.beginPath(); g.arc(0, 0, 8, 0, TAU); blob(g, '#4a2e1a', 2);
  g.restore();
  g.restore();
}
