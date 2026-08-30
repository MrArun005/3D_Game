import * as THREE from 'three';
import { seed, rp, rr, ri, pick } from '../core/rng.js';
import { cv, toTex, shade, noiseWash } from './textures.js';

export const TOWER = 'tower', MID = 'mid', LOFT = 'loft', PODIUM = 'podium', DECK = 'deck';
/** Mix is weighted toward glass towers and offices, not brick. */
export const KINDS = [TOWER, TOWER, TOWER, MID, MID, MID, LOFT, LOFT, PODIUM, DECK];

const FW = 512, FH = 1024;   // one facade tile covers `floors` storeys and repeats
const BW = 512, BH = 256;    // the street-level band
/** Height of the ground-floor band carried by every building, in metres. */
export const BASE_H = 5.4;

export const ARCH = {
  [TOWER]:  { floors: 4, lit: 0.42, wide: 8.4, storey: 3.8 },
  [MID]:    { floors: 4, lit: 0.38, wide: 10.2, storey: 3.6 },
  [LOFT]:   { floors: 3, lit: 0.48, wide: 9.2, storey: 3.2 },
  [PODIUM]: { floors: 2, lit: 0.72, wide: 12.0, storey: 4.4 },
  [DECK]:   { floors: 3, lit: 0.55, wide: 11.0, storey: 3.5 },
};

const PALETTE = {
  glass:    [0x1a2836, 0x152028, 0x1e3038],
  cladding: [0xc4c0b8, 0xb0b4b8, 0x9aa0a6],
  charcoal: [0x3a4048, 0x2a3038, 0x484e56],
  metal:    [0x6a727c, 0x5a626c, 0x787e86],
};
const OFFICE = [['#dce8f6', '#7e98b4'], ['#e8f2fc', '#8aa4bc'], ['#c8dcf0', '#6e88a4']];
const HOME = [['#f5d7a8', '#b98f52'], ['#fbe9cd', '#c2a06a'], ['#e7bd8b', '#9c6d33']];
const SHOP = [['#f4efe6', '#c8b8a0'], ['#e8f0f8', '#9ab4c8'], ['#fce8d4', '#c49a6a']];

function litGlow(e, x, y, w, h, warm, k) {
  e.save();
  e.globalCompositeOperation = 'lighter';
  const cx = x + w / 2, cy = y + h / 2, R = Math.max(w, h) * 1.45;
  const gr = e.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, R);
  gr.addColorStop(0, `rgba(210,230,255,${0.16 * k})`);
  gr.addColorStop(0.45, `rgba(180,210,240,${0.05 * k})`);
  gr.addColorStop(1, 'rgba(180,210,240,0)');
  e.fillStyle = gr;
  e.beginPath(); e.arc(cx, cy, R, 0, 7); e.fill();
  const lg = e.createLinearGradient(0, y, 0, y + h);
  lg.addColorStop(0, warm[0]); lg.addColorStop(1, warm[1]);
  e.fillStyle = lg;
  e.globalAlpha = 0.50 * k;
  e.fillRect(x, y, w, h);
  e.globalAlpha = 1;
  e.restore();
}

function interior(g, x, y, w, h, cool = true) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = cool ? 'rgba(18,24,32,0.45)' : 'rgba(24,22,18,0.42)';
  for (let i = 0, n = ri(2, 4); i < n; i++) {
    const bw = w * rr(0.10, 0.24);
    g.fillRect(x + rp() * (w - bw), y + h * rr(0.42, 0.68), bw, h * 0.5);
  }
  g.restore();
}

/** Glass curtain wall — the CBD default. */
function paintTower(g, e, spec, fh, variant) {
  const tint = PALETTE.glass[variant % PALETTE.glass.length];
  const sky = g.createLinearGradient(0, 0, FW * 0.7, FH);
  sky.addColorStop(0, shade(tint, 0.28));
  sky.addColorStop(0.4, shade(tint, -0.02));
  sky.addColorStop(1, shade(tint, 0.12));
  g.fillStyle = sky; g.fillRect(0, 0, FW, FH);

  const bays = 8, bw = FW / bays;
  const vision = 0.78;
  for (let f = 0; f < spec.floors; f++) {
    const y = f * fh;
    const occupied = rp() < spec.lit;
    const gy = y + fh * (1 - vision), gh = fh * vision - 1;
    for (let b = 0; b < bays; b++) {
      const x = b * bw + 1, w = bw - 2;
      const pane = g.createLinearGradient(x, gy, x + w, gy + gh);
      pane.addColorStop(0, shade(tint, 0.18));
      pane.addColorStop(0.55, shade(tint, -0.08));
      pane.addColorStop(1, shade(tint, 0.06));
      g.fillStyle = pane; g.fillRect(x, gy, w, gh);
      if (rp() < (occupied ? 0.72 : 0.08)) {
        interior(g, x, gy, w, gh, true);
        const cool = pick(OFFICE);
        g.globalAlpha = 0.55; g.fillStyle = cool[0]; g.fillRect(x, gy, w, gh); g.globalAlpha = 1;
        litGlow(e, x, gy, w, gh, cool, 0.9);
      }
    }
    g.fillStyle = shade(0x2a323c, -0.05);
    g.fillRect(0, y, FW, fh * (1 - vision));
    g.fillStyle = 'rgba(160,180,200,0.07)';
    g.fillRect(0, y, FW, 1);
  }
  g.fillStyle = 'rgba(12,16,22,0.85)';
  for (let b = 0; b <= bays; b++) g.fillRect(b * bw - 1, 0, 2, FH);
  g.fillStyle = 'rgba(190,210,230,0.12)';
  g.fillRect(0, 0, 2, FH);
  g.fillRect(FW - 2, 0, 2, FH);
}

/** Ribbon-window office. */
function paintMid(g, e, spec, fh, variant) {
  const clad = PALETTE.charcoal[variant % PALETTE.charcoal.length];
  g.fillStyle = shade(clad, 0); g.fillRect(0, 0, FW, FH);
  const ribbon = fh * 0.62;
  for (let f = 0; f < spec.floors; f++) {
    const y = f * fh;
    const occupied = rp() < spec.lit;
    g.fillStyle = shade(clad, rr(-0.04, 0.06));
    g.fillRect(0, y, FW, fh);
    const gy = y + fh * 0.18, gh = ribbon;
    const glass = g.createLinearGradient(0, gy, 0, gy + gh);
    glass.addColorStop(0, '#3a4a58');
    glass.addColorStop(1, '#1a222c');
    g.fillStyle = glass; g.fillRect(4, gy, FW - 8, gh);
    const cols = 6, cw = (FW - 8) / cols;
    for (let c = 0; c < cols; c++) {
      const x = 4 + c * cw + 2, w = cw - 4;
      if (rp() < (occupied ? 0.65 : 0.1)) {
        interior(g, x, gy, w, gh, true);
        const cool = pick(OFFICE);
        g.globalAlpha = 0.5; g.fillStyle = cool[0]; g.fillRect(x, gy, w, gh); g.globalAlpha = 1;
        litGlow(e, x, gy, w, gh, cool, 0.85);
      }
    }
    g.fillStyle = 'rgba(10,12,16,0.9)';
    for (let c = 0; c <= cols; c++) g.fillRect(4 + c * cw - 1, gy, 2, gh);
    g.fillStyle = shade(PALETTE.metal[variant % 3], 0.08);
    g.fillRect(0, y + fh - 3, FW, 3);
  }
}

/** Contemporary residential — punched windows, balcony slabs. */
function paintLoft(g, e, spec, fh, variant) {
  const clad = PALETTE.cladding[variant % PALETTE.cladding.length];
  g.fillStyle = shade(clad, -0.04); g.fillRect(0, 0, FW, FH);
  const cols = 4, cw = FW / cols;
  for (let f = 0; f < spec.floors; f++) {
    const y = f * fh;
    g.fillStyle = shade(clad, rr(-0.03, 0.04));
    g.fillRect(0, y, FW, fh);
    g.fillStyle = shade(clad, -0.18);
    g.fillRect(0, y + fh - 5, FW, 5);
    for (let c = 0; c < cols; c++) {
      const w = cw * 0.42, h = fh * 0.48;
      const x = c * cw + (cw - w) / 2, wy = y + fh * 0.22;
      g.fillStyle = shade(clad, -0.28);
      g.fillRect(x - 6, wy + h, w + 12, 4);
      const grd = g.createLinearGradient(x, wy, x, wy + h);
      grd.addColorStop(0, '#2a3340'); grd.addColorStop(1, '#141a22');
      g.fillStyle = grd; g.fillRect(x, wy, w, h);
      if (rp() < spec.lit) {
        const warm = pick(HOME);
        interior(g, x, wy, w, h, false);
        g.globalAlpha = 0.58; g.fillStyle = warm[0]; g.fillRect(x, wy, w, h); g.globalAlpha = 1;
        litGlow(e, x, wy, w, h, warm, 1.05);
      }
      g.strokeStyle = 'rgba(20,22,26,0.55)'; g.lineWidth = 1.5;
      g.strokeRect(x, wy, w, h);
      g.beginPath(); g.moveTo(x + w / 2, wy); g.lineTo(x + w / 2, wy + h); g.stroke();
    }
  }
}

/** Glass retail podium. */
function paintPodium(g, e, spec, fh, variant, mc) {
  const metal = PALETTE.metal[variant % PALETTE.metal.length];
  g.fillStyle = shade(metal, -0.2); g.fillRect(0, 0, FW, FH);
  for (let f = 0; f < spec.floors; f++) {
    const y = f * fh;
    const fascia = fh * 0.14, gy = y + fascia, gh = fh * 0.78;
    g.fillStyle = shade(0x1c2026, 0);
    g.fillRect(0, y, FW, fascia);
    g.fillStyle = 'rgba(200,220,240,0.08)'; g.fillRect(0, y + fascia - 2, FW, 2);
    const grd = g.createLinearGradient(0, gy, 0, gy + gh);
    grd.addColorStop(0, '#3a4652'); grd.addColorStop(1, '#161c24');
    g.fillStyle = grd; g.fillRect(4, gy, FW - 8, gh);
    const lit = rp() < spec.lit;
    if (lit) {
      const shop = pick(SHOP);
      const ig = g.createLinearGradient(0, gy, 0, gy + gh);
      ig.addColorStop(0, shop[0]); ig.addColorStop(1, shop[1]);
      g.fillStyle = ig; g.globalAlpha = 0.7;
      g.fillRect(6, gy + 2, FW - 12, gh - 4);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(16,18,22,0.45)';
      for (let i = 0; i < 5; i++) {
        const w = rr(18, 40);
        g.fillRect(16 + rp() * (FW - 40 - w), gy + gh * rr(0.38, 0.6), w, gh * 0.4);
      }
    }
    g.fillStyle = '#12161c';
    const units = 5;
    for (let u = 0; u <= units; u++) g.fillRect(4 + u * ((FW - 8) / units) - 1.5, gy, 3, gh);
    g.fillRect(4, gy, FW - 8, 3);
    g.fillRect(4, gy + gh - 3, FW - 8, 3);
    if (lit) {
      e.save();
      e.globalCompositeOperation = 'lighter';
      e.drawImage(mc, 6, gy, FW - 12, gh, 6, gy, FW - 12, gh);
      e.fillStyle = 'rgba(0,0,0,0.45)'; e.fillRect(6, gy, FW - 12, gh);
      e.restore();
    }
  }
}

/** Horizontal-band hotel / mixed-use slab. */
function paintDeck(g, e, spec, fh, variant) {
  const clad = PALETTE.charcoal[(variant + 1) % PALETTE.charcoal.length];
  g.fillStyle = shade(clad, -0.08); g.fillRect(0, 0, FW, FH);
  const cols = 7, cw = FW / cols;
  for (let f = 0; f < spec.floors; f++) {
    const y = f * fh;
    const occupied = rp() < spec.lit;
    g.fillStyle = shade(clad, rr(-0.04, 0.05));
    g.fillRect(0, y, FW, fh);
    const gy = y + fh * 0.28, gh = fh * 0.5;
    for (let c = 0; c < cols; c++) {
      const x = c * cw + 3, w = cw - 6;
      const grd = g.createLinearGradient(x, gy, x, gy + gh);
      grd.addColorStop(0, '#2c3844'); grd.addColorStop(1, '#151b22');
      g.fillStyle = grd; g.fillRect(x, gy, w, gh);
      if (rp() < (occupied ? 0.7 : 0.12)) {
        const home = rp() < 0.35;
        const lamp = home ? pick(HOME) : pick(OFFICE);
        interior(g, x, gy, w, gh, !home);
        g.globalAlpha = 0.52; g.fillStyle = lamp[0]; g.fillRect(x, gy, w, gh); g.globalAlpha = 1;
        litGlow(e, x, gy, w, gh, lamp, 0.9);
      }
    }
    g.fillStyle = shade(clad, 0.12);
    g.fillRect(0, y + fh * 0.86, FW, fh * 0.14);
  }
}

export function paintFacade(kind, variant) {
  seed(kind.length * 7919 + variant * 7717 + 3);
  const spec = ARCH[kind];
  const mc = cv(FW, FH), g = mc.getContext('2d');
  const ec = cv(FW, FH), e = ec.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, FW, FH);
  const fh = FH / spec.floors;

  if (kind === TOWER) paintTower(g, e, spec, fh, variant);
  else if (kind === MID) paintMid(g, e, spec, fh, variant);
  else if (kind === LOFT) paintLoft(g, e, spec, fh, variant);
  else if (kind === PODIUM) paintPodium(g, e, spec, fh, variant, mc);
  else paintDeck(g, e, spec, fh, variant);

  return { map: toTex(mc), emissive: toTex(ec) };
}

function facadeMaterial(t, glass) {
  return new THREE.MeshStandardMaterial({
    map: t.map,
    emissive: 0xffffff,
    emissiveMap: t.emissive,
    emissiveIntensity: glass ? 1.2 : 1.05,
    roughness: glass ? 0.28 : 0.48,
    metalness: glass ? 0.16 : 0.06,
    envMapIntensity: glass ? 0.9 : 0.45,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function buildFacadeMaterials() {
  const out = {};
  const glass = new Set([TOWER, MID, PODIUM]);
  for (const kind of [...new Set(KINDS)]) {
    out[kind] = [0, 1, 2].map((v) => facadeMaterial(paintFacade(kind, v), glass.has(kind)));
  }
  return out;
}

function paintBase(variant) {
  seed(1700 + variant * 31);
  const mc = cv(BW, BH), g = mc.getContext('2d');
  const ec = cv(BW, BH), e = ec.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, BW, BH);

  if (variant === 0) {
    g.fillStyle = '#2a3038'; g.fillRect(0, 0, BW, BH);
    const gy = BH * 0.08, gh = BH * 0.82;
    const grd = g.createLinearGradient(0, gy, 0, gy + gh);
    grd.addColorStop(0, '#3a4854'); grd.addColorStop(1, '#141a22');
    g.fillStyle = grd; g.fillRect(0, gy, BW, gh);
    g.fillStyle = 'rgba(200,220,240,0.22)';
    g.fillRect(0, gy + gh * 0.28, BW, gh * 0.42);
    g.fillStyle = 'rgba(12,14,18,0.5)';
    g.fillRect(BW * 0.32, gy + gh * 0.48, BW * 0.28, gh * 0.18);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(220,235,255,0.45)';
      g.fillRect(BW * (0.07 + i * 0.16), gy + gh * 0.12, BW * 0.05, 3);
    }
    g.fillStyle = '#1a1e24';
    for (let x = 0; x <= BW; x += BW / 6) g.fillRect(x - 3, gy, 6, gh);
    g.fillStyle = '#3a424c'; g.fillRect(0, 0, BW, gy);
    g.fillStyle = 'rgba(220,230,240,0.08)'; g.fillRect(0, gy - 2, BW, 2);
    g.fillStyle = '#1c2026'; g.fillRect(0, gy + gh, BW, BH - gy - gh);
    litGlow(e, 0, gy + gh * 0.24, BW, gh * 0.5, ['#d8e8f8', '#8aa4bc'], 0.95);

  } else if (variant === 1) {
    g.fillStyle = '#2c3036'; g.fillRect(0, 0, BW, BH);
    const band = BH * 0.18;
    g.fillStyle = '#181c22'; g.fillRect(0, 0, BW, band);
    g.fillStyle = 'rgba(210,230,250,0.45)';
    for (let u = 0; u < 3; u++) {
      g.fillRect((u * BW) / 3 + 18, band * 0.38, BW / 3 - 48, band * 0.28);
    }
    const gy = band + 3, gh = BH * 0.64;
    for (let u = 0; u < 3; u++) {
      const x = (u * BW) / 3 + 6, w = BW / 3 - 12;
      const shop = pick(SHOP);
      const lit = rp() < 0.82;
      const grd = g.createLinearGradient(0, gy, 0, gy + gh);
      if (lit) { grd.addColorStop(0, shop[0]); grd.addColorStop(1, shop[1]); }
      else { grd.addColorStop(0, '#232a33'); grd.addColorStop(1, '#12171c'); }
      g.fillStyle = grd; g.fillRect(x, gy, w, gh);
      g.fillStyle = 'rgba(16,18,22,0.45)';
      for (let i = 0; i < 3; i++) {
        const sw = rr(12, 26);
        g.fillRect(x + 8 + rp() * (w - 22), gy + gh * rr(0.36, 0.55), sw, gh * 0.4);
      }
      g.fillStyle = '#10141a';
      g.fillRect(x, gy, w, 4); g.fillRect(x, gy + gh - 4, w, 4);
      g.fillRect(x + w / 2 - 2, gy, 4, gh);
      if (lit) litGlow(e, x, gy, w, gh, shop, 1.2);
    }
    g.fillStyle = '#1a1e24'; g.fillRect(0, gy + gh, BW, BH - gy - gh);

  } else {
    g.fillStyle = '#3a3e44'; g.fillRect(0, 0, BW, BH);
    noiseWash(g, BW, BH, 80, 0.08, '24,26,30');
    g.fillStyle = '#2a2e34';
    g.fillRect(BW * 0.08, BH * 0.16, BW * 0.44, BH * 0.70);
    g.strokeStyle = 'rgba(16,18,22,0.65)'; g.lineWidth = 2;
    for (let y = BH * 0.16; y < BH * 0.86; y += 8) {
      g.beginPath(); g.moveTo(BW * 0.08, y); g.lineTo(BW * 0.52, y); g.stroke();
    }
    g.fillStyle = '#1c2026';
    g.fillRect(BW * 0.62, BH * 0.22, BW * 0.16, BH * 0.64);
    g.fillStyle = 'rgba(200,220,240,0.4)';
    g.fillRect(BW * 0.62, BH * 0.22, BW * 0.16, BH * 0.08);
    litGlow(e, BW * 0.62, BH * 0.22, BW * 0.16, BH * 0.08, ['#d8e8f8', '#8aa4bc'], 0.8);
    g.fillStyle = '#32363c';
    g.fillRect(BW * 0.84, BH * 0.34, BW * 0.10, BH * 0.22);
  }

  return { map: toTex(mc), emissive: toTex(ec) };
}

export function buildBaseMaterials() {
  const mats = [0, 1, 2].map((v) => {
    const t = paintBase(v);
    return new THREE.MeshStandardMaterial({
      map: t.map, emissive: 0xffffff, emissiveMap: t.emissive,
      emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.12, envMapIntensity: 0.7,
    });
  });
  return {
    materials: mats,
    forKind: { [TOWER]: 0, [MID]: 0, [PODIUM]: 1, [DECK]: 1, [LOFT]: 0 },
  };
}
