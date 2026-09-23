import * as THREE from 'three';
import {
  attribute, uniform, texture, vec2, vec3, vec4, float, mix, select, sin, cos, Fn,
  positionGeometry, normalGeometry, normalLocal,
} from 'three/tsl';
import { toTex } from './textures.js';

/**
 * London's two street icons, authored in code (2026-09-23): a red
 * double-decker bus and a black cab, for the civilian fleet. The owner's
 * Regent Street study wants "red double-decker buses and black cabs in the
 * traffic"; rule 3 says detail inside ~30 m is authored, and nothing free was
 * both CC0 and at the fleet's density, so they are built here like the tank
 * and the helicopters -- indexed, real UVs, every triangle wound outward
 * (test/londonVehicles.test.js holds all of it).
 *
 *   bus   10.5 x 2.55 x 4.43 m, Enviro400 / New Routemaster mould. Stacked
 *         plan rings (a rounded rectangle per height: the windscreens rake,
 *         the upper deck tumbles in, the roof rolls over and crowns), so every
 *         band -- glazing, black surrounds, bumpers, the destination blind --
 *         is cut from the SAME surface and wraps the corners exactly. Two decks
 *         of dark glazing on black surrounds, pillars, glazed doors on the kerb
 *         side, the diagonal stair windows, the LED destination blind (lit, 4
 *         routes), side blind, rear route number, bunny-ear mirrors, wipers,
 *         bumpers, grilles, lamps, arch trims and liners, 22.5" wheels.
 *   cab   4.58 x 1.74 x 1.88 m, TX4 / FX4 mould. An X loft whose sections
 *         blend a bonnet crown into an upright greenhouse; the sill rises over
 *         the wheels, so the arches are real openings. Chrome grille and round
 *         lamps, big rear doors (shut lines, handles), drip rails, the yellow
 *         TAXI sign (lit at night while for hire).
 *
 * The installed contract is the fleet's (vendorCars.js):
 *   { body (the PAINT: traffic tints it), glass/detail + detailMat, lodBody }
 * plus what these two need that a car does not: their own `spec` (BODY_TYPES
 * has no bus), fixed `paints`, a paint `finish`, shared lamp geometry that
 * sits on the authored lenses (`lamps.head` for the night lamp pair,
 * `lamps.tail` for the brake mesh -- both still driven by traffic.js's own
 * lampMat / brakeMat), `lodFar`, and `occupant: null` (the glazing is opaque:
 * a driver behind it would be a draw nobody sees).
 *
 * Draws per vehicle: paint + detail + brake (+ the lamp pair at night) -- one
 * fewer than a fleet car, which also draws its occupant; beyond `lodFar` the
 * paint and detail give way to ONE LOD mesh, two fewer than a far saloon.
 *
 * One node material draws every detail and LOD mesh (london_vehicle): vertex
 * colour, a per-vertex roughness / metalness / hire mask (aSurf), an emissive
 * colour with its daylight fraction (aEmit), and aPart -- either a cell of the
 * 1024x512 canvas atlas (blinds, plates, TAXI sign, ads: u, v, 1, per-route v
 * step) or a wheel's hub (x, y, -radius, 0), which the vertex stage turns from
 * per-OBJECT uniforms, as the tank's wheels are: userData.roll (metres
 * travelled), .route (which blind), .hire (TAXI sign on). No texel is ever a
 * wheel, so the two share one attribute: the shader reads six vertex buffers,
 * two under WebGPU's default limit of eight. The night comes from
 * setLondonNight, which Traffic.setNight calls.
 *
 * Model space: +X forward, +Y up, +Z to the vehicle's RIGHT (x cross y = z;
 * traffic keeps right, so the kerb is +Z -- the bus's doors are there).
 * Origin at the base, centred in XZ.
 */

const PI = Math.PI;

/* ------------------------------------------------------------------ specs */

/**
 * BODY_TYPES-shaped specs (vehicle/config.js conventions: L, half width wMax,
 * axles measured from the nose) plus the fleet extras traffic.js reads:
 *   offsets   collision circle stations along the body (collision.js, onfoot,
 *             breakables): a bus needs five to cover 10.5 m, a car three
 *   long      placed by its two axles (off-tracking) and spawn-checked for room
 *   stopBack  how much earlier its CENTRE stops at a line: the gate distance
 *             was tuned for a sedan's half length (2.31 m), so the bus stops
 *             5.25 - 2.31 m sooner and its nose lands where a car's would
 *   axleHalf  half the wheelbase, for the two-axle placement
 * bonnetY is chosen so bonnetY * 0.78 is the authored headlamp height --
 * streaks.js and the generic lamp code both put the lamp there.
 */
export const LONDON_SPECS = {
  bus: {
    L: 10.5, wMax: 1.275, H: 4.43, bonnetY: 0.96, roofY: 4.35, beltY: 1.30, wheelR: 0.50,
    axleF: 2.30, axleR: 8.20, ride: 0.30, tumble: 1.2, detail: 1,
    long: true, stopBack: 5.25 - 2.31, axleHalf: 2.95,
    offsets: [-4.0, -2.0, 0, 2.0, 4.0],
  },
  cab: {
    L: 4.58, wMax: 0.87, H: 1.88, bonnetY: 0.92, roofY: 1.76, beltY: 1.00, wheelR: 0.35,
    axleF: 0.79, axleR: 3.68, ride: 0.27, tumble: 0.72, detail: 1,
  },
};

/** Paint per style (sRGB hex; traffic picks one per car). Buses are red, cabs are black -- a rare livery. */
export const LONDON_PAINTS = {
  bus: [0xb3141b, 0xb3141b, 0xa8121a, 0xbc1a1e],
  cab: [0x0c0d0f, 0x0c0d0f, 0x0c0d0f, 0x0c0d0f, 0x0c0d0f, 0x0c0d0f, 0x2b0f15, 0x1d232b],
};
/* Gloss solid red on the bus; the black cab is deep and glossy -- its whole
   look is the city reflected in the black. Applied to traffic's per-car clone. */
const FINISH = { bus: { metalness: 0.12, roughness: 0.30 }, cab: { metalness: 0.42, roughness: 0.22 } };
/* LOD switch distances (m, from the player). A bus is ~60 px wide at 140 m
   on a 1440 px screen, a cab ~25 px at 100 m: the LOD keeps the window bands,
   the blind and the wheels, so the pop reads as nothing. */
const LOD_FAR = { bus: 140, cab: 100 };

/** Is the London fleet on? `?nolondon` takes both styles out of the city. */
export function londonEnabled(search = (typeof location !== 'undefined' ? location.search : '')) {
  return !new URLSearchParams(search || '').has('nolondon');
}

/**
 * Which style pool slot `i` is forced to, or undefined for the weighted pick.
 * Buses are a QUOTA, not a weight: the pool is the whole live fleet, and a
 * weight of 1 in 28 would leave an 18-car pool with no bus about one boot in
 * two ((27/28)^18 = 0.52). Slot 4 of every 11 -> 1 bus at 5-15 cars, 2 at
 * 16-26 (balanced runs 18), 3 at 27-37, 4 at 38-40; quality.js limitTraffic
 * pops from the END, so the density governor keeps slot 4 to the last.
 * `?london=all` (screenshots) fills the pool: a bus in three, the rest cabs.
 */
export function fleetStyle(i, search = (typeof location !== 'undefined' ? location.search : '')) {
  const q = new URLSearchParams(search || '');
  if (q.has('nolondon')) return undefined;
  if (q.get('london') === 'all') return i % 3 === 0 ? 'bus' : 'cab';
  return i % 11 === 4 ? 'bus' : undefined;
}

/* --------------------------------------------------------- night + atlas */

const NIGHT = uniform(0);
/** 0 day .. 1 night (clock.nightFactor): blinds full, saloon lights, TAXI signs. Traffic.setNight calls it. */
export function setLondonNight(k) { NIGHT.value = Math.max(0, Math.min(1, +k || 0)); }
export const londonNight = () => NIGHT.value;

const ATLAS_W = 1024, ATLAS_H = 512;
/* Atlas cells, canvas pixels [x0, y0, x1, y1]. The blinds and route numbers
   come in four rows (routes 0-3); aPart.w steps v by one row per route. */
const CELL = {
  blind: [0, 0, 768, 104], blindStep: 104,
  taxi: [768, 0, 1024, 64],
  plateF: [768, 64, 1024, 118],
  plateR: [768, 118, 1024, 172],
  route: [768, 172, 896, 236], routeStep: 64,
  adA: [0, 416, 768, 464],
  adB: [0, 464, 768, 512],
  poster: [768, 428, 1024, 512],
};
/* London route numbers that run down Regent Street, to Halstead Bay's own districts. */
export const ROUTES = [['88', 'KINGSWAY'], ['12', 'OLD QUARTER'], ['453', 'HARBOUR POINT'], ['139', 'MARROW HILL']];

let ATLAS;   // undefined: not painted yet; null: no DOM (node --test)
function atlasTexture() {
  if (ATLAS !== undefined) return ATLAS;
  if (typeof document === 'undefined') return (ATLAS = null);
  const c = document.createElement('canvas');
  c.width = ATLAS_W; c.height = ATLAS_H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const led = (x0, y0, w, h) => {
    // an LED matrix: dark rows and columns every 3 px over whatever was drawn
    g.fillStyle = 'rgba(0,0,0,0.55)';
    for (let y = y0; y < y0 + h; y += 3) g.fillRect(x0, y, w, 1);
    for (let x = x0; x < x0 + w; x += 3) g.fillRect(x, y0, 1, h);
  };
  const fit = (text, weight, px, maxW, family = 'Arial, Helvetica, sans-serif') => {
    let s = px;
    do { g.font = `${weight} ${s}px ${family}`; s -= 2; } while (g.measureText(text).width > maxW && s > 10);
  };
  g.textBaseline = 'middle';
  ROUTES.forEach(([num, dest], r) => {
    // front / side blind: route number boxed at the left, destination beside it
    const y = r * CELL.blindStep;
    g.fillStyle = '#000'; g.fillRect(0, y, 768, 104);
    g.fillStyle = '#ffb21a';
    g.textAlign = 'center'; fit(num, 900, 76, 150); g.fillText(num, 88, y + 54);
    g.fillRect(176, y + 14, 4, 76);
    g.textAlign = 'left'; fit(dest, 800, 62, 560); g.fillText(dest, 200, y + 42);
    fit('VIA LITTLE TOKYO', 700, 26, 560); g.fillText('VIA LITTLE TOKYO', 202, y + 82);
    led(0, y, 768, 104);
    // the small route-number cell (side and rear boxes)
    const ry = CELL.route[1] + r * CELL.routeStep;
    g.fillStyle = '#000'; g.fillRect(768, ry, 128, 64);
    g.fillStyle = '#ffb21a'; g.textAlign = 'center'; fit(num, 900, 50, 112); g.fillText(num, 832, ry + 34);
    led(768, ry, 128, 64);
  });
  // the TAXI sign: black letters on the yellow lamp
  g.fillStyle = '#f7c600'; g.fillRect(768, 0, 256, 64);
  g.fillStyle = '#111'; g.textAlign = 'center'; fit('TAXI', 900, 50, 220); g.fillText('TAXI', 896, 34);
  // plates: white front, yellow rear, one made-up registration
  for (const [cell, bg] of [[CELL.plateF, '#f2f2ec'], [CELL.plateR, '#f6c200']]) {
    const [x0, y0, x1, y1] = cell;
    g.fillStyle = bg; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = '#222'; g.lineWidth = 2; g.strokeRect(x0 + 3, y0 + 3, x1 - x0 - 6, y1 - y0 - 6);
    g.fillStyle = '#111'; fit('HB61 LDN', 800, 38, 220); g.fillText('HB61 LDN', (x0 + x1) / 2, (y0 + y1) / 2 + 2);
  }
  // two side ads (the between-decks panel)
  {
    const [x0, y0, x1, y1] = CELL.adA;
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, '#d0147a'); gr.addColorStop(0.55, '#5b1fb8'); gr.addColorStop(1, '#0bb8d8');
    g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#fff'; g.textAlign = 'left'; fit('SHIBUYA CITY POP  ·  88.3 FM  ·  渋谷', 800, 30, 700); g.fillText('SHIBUYA CITY POP  ·  88.3 FM  ·  渋谷', x0 + 24, (y0 + y1) / 2 + 1);
  }
  {
    const [x0, y0, x1, y1] = CELL.adB;
    g.fillStyle = '#f4f1ea'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#b3141b'; g.fillRect(x0, y0, 150, y1 - y0);
    g.fillStyle = '#fff'; g.textAlign = 'center'; fit('SALE', 900, 32, 130); g.fillText('SALE', x0 + 75, (y0 + y1) / 2 + 1);
    g.fillStyle = '#1a1a1a'; g.textAlign = 'left'; fit('KINGSWAY  ·  THE WINTER SALE IS ON', 800, 28, 580); g.fillText('KINGSWAY  ·  THE WINTER SALE IS ON', x0 + 170, (y0 + y1) / 2 + 1);
  }
  {
    // the rear poster: Little Tokyo's night market, neon on ink
    const [x0, y0, x1, y1] = CELL.poster;
    g.fillStyle = '#12081f'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#ff2d95'; g.textAlign = 'center'; fit('NIGHT MARKET', 900, 30, 230); g.fillText('NIGHT MARKET', (x0 + x1) / 2, y0 + 30);
    g.fillStyle = '#35e0ff'; fit('LITTLE TOKYO · 夜市', 700, 22, 230); g.fillText('LITTLE TOKYO · 夜市', (x0 + x1) / 2, y0 + 62);
  }
  const t = toTex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.name = 'london_atlas';
  return (ATLAS = t);
}

/* -------------------------------------------------------------- material */

/* Under plain three (node --test) there are no node materials: the classic
   fallback draws vertex colours and the node assignments below never run. The
   browser build aliases three -> three/webgpu, where they are real. */
let MAT = null;
/** The one material every London detail and LOD mesh draws with (warm-up: main compiles it from the hidden fleet). */
export function londonMaterial() {
  if (MAT) return MAT;
  const NodeMaterial = THREE.MeshStandardNodeMaterial;
  if (!NodeMaterial) {
    MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
    MAT.name = 'london_vehicle';
    return MAT;
  }
  const m = new NodeMaterial({ roughness: 0.5, metalness: 0.1 });
  m.name = 'london_vehicle';
  const col = attribute('color', 'vec3'), surf = attribute('aSurf', 'vec3');
  const emit = attribute('aEmit', 'vec4'), part = attribute('aPart', 'vec4');
  const inAtlas = part.z.clamp(0, 1);         // 1 on an atlas texel; a wheel's -radius clamps to 0
  // per OBJECT, like the tank's tracks: traffic writes them on the detail / LOD mesh
  const route = uniform(0).onObjectUpdate(({ object }) => object.userData.route ?? 0);
  const hire = uniform(1).onObjectUpdate(({ object }) => object.userData.hire ?? 1);
  const roll = uniform(0).onObjectUpdate(({ object }) => object.userData.roll ?? 0);
  /* vertexColors stays FALSE: colorNode reads the colour attribute itself,
     and with the flag on NodeMaterial multiplies by it a second time. */
  let base = col, lit = vec3(1);
  const tex = atlasTexture();
  if (tex) {
    const s = texture(tex, vec2(part.x, part.y.add(part.w.mul(route)))).rgb;
    base = mix(col, s, inAtlas);
    lit = mix(vec3(1), s, inAtlas);          // an atlas texel glows in its own colour: amber LEDs, the yellow TAXI lamp
  }
  m.colorNode = vec4(base, 1);
  m.roughnessNode = surf.x;
  m.metalnessNode = surf.y;
  // day fraction .. 1 at night; the TAXI sign also needs the cab for hire
  const k = mix(emit.w, float(1), NIGHT).mul(mix(float(1), hire, surf.z));
  m.emissiveNode = emit.xyz.mul(lit).mul(k);
  /* Wheels turn about their own hubs (aPart = hub x, hub y, -radius on a
     wheel; everywhere else z >= 0, the angle is 0 and this is the identity).
     The axle is local Z; rolling forward (+X) turns a wheel by -distance / r. */
  m.positionNode = Fn(() => {
    const w = attribute('aPart', 'vec4'), r = w.z.negate();
    const a = select(r.greaterThan(0.001), roll.negate().div(r.max(0.001)), float(0)).toVar();
    const c = cos(a).toVar(), s = sin(a).toVar();
    const q = positionGeometry.sub(vec3(w.x, w.y, 0)).toVar();
    const n = normalGeometry.toVar();
    normalLocal.assign(vec3(n.x.mul(c).sub(n.y.mul(s)), n.x.mul(s).add(n.y.mul(c)), n.z));
    return vec3(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)), q.z).add(vec3(w.x, w.y, 0));
  })();
  MAT = m;
  return m;
}

/* ------------------------------------------------------------ looks (kinds) */

const _col = new THREE.Color();
const lin = (hex) => { _col.setHex(hex); return [_col.r, _col.g, _col.b]; };
/** colour (sRGB hex), roughness, metalness, emissive rgb (linear, at night), its daylight fraction, TAXI hire mask. */
const look = (hex, r, m, e = null, day = 0, hire = 0) => ({ c: lin(hex), r, m, e: e ?? [0, 0, 0], day, hire });
const K = {
  paintBus: look(0xb3141b, 0.30, 0.12),   // LOD only: near, the paint is traffic's own tinted material
  paintCab: look(0x0c0d0f, 0.22, 0.42),
  glass: look(0x0a0f14, 0.05, 0.3),
  glassLit: look(0x0b1218, 0.05, 0.3, [0.22, 0.24, 0.20]),   // a bus saloon at night: the windows glow, below the bloom line
  black: look(0x0b0b0c, 0.5, 0.05),
  trim: look(0x1c1d1f, 0.62, 0.1),
  rubber: look(0x111112, 0.9, 0),
  tyre: look(0x151516, 0.93, 0),
  rim: look(0xa8acb1, 0.32, 0.85),
  rimDark: look(0x26282b, 0.5, 0.5),
  hub: look(0x55585c, 0.45, 0.6),
  chrome: look(0xdfe3e7, 0.1, 1.0),
  grey: look(0x44474b, 0.55, 0.3),
  reflector: look(0xeef1f3, 0.08, 0.75),
  lensR: look(0x5a0709, 0.18, 0.1),
  lensA: look(0xd07a10, 0.2, 0.1, [0.55, 0.26, 0.02]),
  liner: look(0x0a0a0b, 0.95, 0),
  blind: look(0x060606, 0.35, 0, [1.0, 0.78, 0.32], 0.55),   // LED blinds read in daylight too
  taxi: look(0xf3c400, 0.32, 0, [1.0, 0.86, 0.36], 0.08, 1),
  plate: look(0xf2f2ec, 0.4, 0),
  plateR: look(0xf6c200, 0.4, 0),
  ad: look(0xf4f1ea, 0.45, 0),
};

/* ------------------------------------------------------------- raw parts */
/* A raw part: flat arrays p (xyz), n (xyz), uv, i (triangles), st (atlas
   param 0..1, optional). Every builder winds each triangle to agree with its
   normals, so the merged geometry cannot come out inside out. */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Push triangle (a, b, c), flipped if its face disagrees with the vertex normals. */
function tri(raw, a, b, c) {
  const P = raw.p, N = raw.n;
  const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
  const f = cross(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pa), sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], pa));
  const n = [N[a * 3] + N[b * 3] + N[c * 3], N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]];
  if (dot(f, n) < 0) raw.i.push(a, c, b); else raw.i.push(a, b, c);
}

/**
 * An indexed grid, (nu + 1) x (nv + 1) vertices from at(i, j) -> { p, n, st? }.
 * UVs are metres: u runs along i (per row), v along j (per column).
 */
function grid(nu, nv, at) {
  const raw = { p: [], n: [], uv: [], i: [], st: [] };
  const pts = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(at(i, j));
  const id = (i, j) => j * (nu + 1) + i;
  for (let j = 0; j <= nv; j++) {
    let u = 0;
    for (let i = 0; i <= nu; i++) {
      const q = pts[id(i, j)];
      if (i > 0) { const pr = pts[id(i - 1, j)].p; u += Math.hypot(q.p[0] - pr[0], q.p[1] - pr[1], q.p[2] - pr[2]); }
      q.u = u;
    }
  }
  for (let i = 0; i <= nu; i++) {
    let v = 0;
    for (let j = 0; j <= nv; j++) {
      const q = pts[id(i, j)];
      if (j > 0) { const pr = pts[id(i, j - 1)].p; v += Math.hypot(q.p[0] - pr[0], q.p[1] - pr[1], q.p[2] - pr[2]); }
      q.v = v;
    }
  }
  for (const q of pts) {
    raw.p.push(...q.p); raw.n.push(...q.n); raw.uv.push(q.u, q.v);
    raw.st.push(...(q.st ?? [0, 0]));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    tri(raw, a, b, c); tri(raw, a, c, d);
  }
  return raw;
}

/** An axis-aligned box, centre (cx, cy, cz), size (sx, sy, sz): 12 triangles, metre UVs. */
function box(cx, cy, cz, sx, sy, sz) {
  const raw = { p: [], n: [], uv: [], i: [], st: [] };
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  // each face: normal, then two in-plane axes (u, v) with their half extents
  const faces = [
    [[1, 0, 0], [0, 0, -1], hz, [0, 1, 0], hy, hx], [[-1, 0, 0], [0, 0, 1], hz, [0, 1, 0], hy, hx],
    [[0, 0, 1], [1, 0, 0], hx, [0, 1, 0], hy, hz], [[0, 0, -1], [-1, 0, 0], hx, [0, 1, 0], hy, hz],
    [[0, 1, 0], [1, 0, 0], hx, [0, 0, -1], hz, hy], [[0, -1, 0], [1, 0, 0], hx, [0, 0, 1], hz, hy],
  ];
  for (const [n, U, hu, V, hv, d] of faces) {
    const base = raw.p.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      raw.p.push(cx + n[0] * d + U[0] * su * hu + V[0] * sv * hv, cy + n[1] * d + U[1] * su * hu + V[1] * sv * hv, cz + n[2] * d + U[2] * su * hu + V[2] * sv * hv);
      raw.n.push(...n);
      raw.uv.push((su + 1) * hu, (sv + 1) * hv);
      raw.st.push((su + 1) / 2, (sv + 1) / 2);
    }
    tri(raw, base, base + 1, base + 2); tri(raw, base, base + 2, base + 3);
  }
  return raw;
}

/** A box of cross-section (w, d) from point a to point b (mirror arms, wipers). */
function bar(a, b, w, d) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const raw = box(0, 0, 0, len, w, d);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  return transform(raw, new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
}

/** A flat disc (or annulus from r0) centred at c, facing axis 'x' | 'z' with sign s. */
function disc(c, r, segs, axis, s, r0 = 0, bulge = 0) {
  const raw = { p: [], n: [], uv: [], i: [], st: [] };
  const P = (a, rr, lift) => {
    const u = Math.cos(a) * rr, v = Math.sin(a) * rr;
    return axis === 'x' ? [c[0] + s * lift, c[1] + v, c[2] + u] : [c[0] + u, c[1] + v, c[2] + s * lift];
  };
  const N = axis === 'x' ? [s, 0, 0] : [0, 0, s];
  if (r0 <= 0) {
    raw.p.push(...P(0, 0, bulge)); raw.n.push(...N); raw.uv.push(r, r); raw.st.push(0.5, 0.5);
    for (let k = 0; k <= segs; k++) { const a = (k / segs) * 2 * PI; raw.p.push(...P(a, r, 0)); raw.n.push(...N); raw.uv.push(r + Math.cos(a) * r, r + Math.sin(a) * r); raw.st.push(0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2); }
    for (let k = 0; k < segs; k++) tri(raw, 0, 1 + k, 2 + k);
  } else {
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * 2 * PI;
      raw.p.push(...P(a, r0, bulge), ...P(a, r, 0)); raw.n.push(...N, ...N);
      raw.uv.push(a * r0, 0, a * r, r - r0); raw.st.push(0, 0, 0, 0);
    }
    for (let k = 0; k < segs; k++) { const a = k * 2, b = a + 1, cc = a + 2, d = a + 3; tri(raw, a, b, d); tri(raw, a, d, cc); }
  }
  return raw;
}

/** A flat polygon (x, y) at z, facing +z (s = 1) or -z. */
function flat(poly, z, s) {
  const raw = { p: [], n: [], uv: [], i: [], st: [] };
  const contour = poly.map(([x, y]) => new THREE.Vector2(x, y));
  for (const [x, y] of poly) { raw.p.push(x, y, z); raw.n.push(0, 0, s); raw.uv.push(x, y); raw.st.push(0, 0); }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) tri(raw, a, b, c);
  return raw;
}

/** Apply a Matrix4 to a raw part: positions, normals (normal matrix), and the winding when the matrix mirrors. */
function transform(raw, m) {
  const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
  for (let k = 0; k < raw.p.length; k += 3) {
    v.set(raw.p[k], raw.p[k + 1], raw.p[k + 2]).applyMatrix4(m); raw.p[k] = v.x; raw.p[k + 1] = v.y; raw.p[k + 2] = v.z;
    v.set(raw.n[k], raw.n[k + 1], raw.n[k + 2]).applyMatrix3(nm).normalize(); raw.n[k] = v.x; raw.n[k + 1] = v.y; raw.n[k + 2] = v.z;
  }
  if (m.determinant() < 0) for (let k = 0; k < raw.i.length; k += 3) { const t = raw.i[k + 1]; raw.i[k + 1] = raw.i[k + 2]; raw.i[k + 2] = t; }
  return raw;
}

/* --------------------------------------------------------------- the bag */

/**
 * Parts for one mesh. `add(raw, look, opts)`: opts.atlas = { cell, step,
 * read } maps the part into an atlas cell -- `read` is the world direction
 * text runs left to right as seen from outside (s), height gives t -- or
 * uses the part's own st when read is omitted; opts.wheel = [hub x, hub y, r].
 */
class Parts {
  constructor() { this.list = []; }
  add(raw, lk, opts = {}) { this.list.push({ raw, lk, opts }); return this; }
  triangles() { return this.list.reduce((n, e) => n + e.raw.i.length / 3, 0); }
  /** detail = false: position / normal / uv only (the paint, the shared lamp geometry). */
  build(detail = true) {
    let nv = 0, ni = 0;
    for (const { raw } of this.list) { nv += raw.p.length / 3; ni += raw.i.length; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const col = detail ? new Float32Array(nv * 3) : null, surf = detail ? new Float32Array(nv * 3) : null;
    const emit = detail ? new Float32Array(nv * 4) : null, part = detail ? new Float32Array(nv * 4) : null;
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, oi = 0;
    for (const { raw, lk, opts } of this.list) {
      const n = raw.p.length / 3;
      pos.set(raw.p, o * 3); nrm.set(raw.n, o * 3); uv.set(raw.uv, o * 2);
      for (let k = 0; k < raw.i.length; k++) index[oi + k] = raw.i[k] + o;
      if (detail) {
        const L = lk ?? K.black;
        let st = raw.st;
        const A = opts.atlas;
        if (A?.read) {
          // s along the reading direction, t up, both 0..1 over the part
          let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
          const s = [], t = [];
          for (let k = 0; k < n; k++) {
            const sv = raw.p[k * 3] * A.read[0] + raw.p[k * 3 + 2] * A.read[1], tv = raw.p[k * 3 + 1];
            s.push(sv); t.push(tv);
            s0 = Math.min(s0, sv); s1 = Math.max(s1, sv); t0 = Math.min(t0, tv); t1 = Math.max(t1, tv);
          }
          st = [];
          for (let k = 0; k < n; k++) st.push((s[k] - s0) / (s1 - s0 || 1), (t[k] - t0) / (t1 - t0 || 1));
        }
        for (let k = 0; k < n; k++) {
          const w = o + k;
          col.set(L.c, w * 3);
          surf[w * 3] = L.r; surf[w * 3 + 1] = L.m; surf[w * 3 + 2] = L.hire;
          emit[w * 4] = L.e[0]; emit[w * 4 + 1] = L.e[1]; emit[w * 4 + 2] = L.e[2]; emit[w * 4 + 3] = L.day;
          if (A) {
            const [x0, y0, x1, y1] = A.cell, pad = 3;
            const sx = st[k * 2] ?? 0, ty = st[k * 2 + 1] ?? 0;
            part[w * 4] = (x0 + pad + sx * (x1 - x0 - 2 * pad)) / ATLAS_W;
            part[w * 4 + 1] = 1 - (y1 - pad - ty * (y1 - y0 - 2 * pad)) / ATLAS_H;   // flipY: canvas row y is v = 1 - y / H
            part[w * 4 + 2] = 1;
            part[w * 4 + 3] = A.step ? -A.step / ATLAS_H : 0;                         // the next route is one row DOWN the canvas
          }
          if (opts.wheel) { part[w * 4] = opts.wheel[0]; part[w * 4 + 1] = opts.wheel[1]; part[w * 4 + 2] = -opts.wheel[2]; }   // a hub: z < 0 says wheel
        }
      }
      o += n; oi += raw.i.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (detail) {
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
      g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 4));
      g.setAttribute('aPart', new THREE.BufferAttribute(part, 4));
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A wheel: hard-edged lathe about local Z (one strip per profile segment, so
 * tread, sidewall, rim and dish each keep their own normal), hub at (x, y, z),
 * the outer face toward `side`. The dish alternates rim / dark every other
 * segment -- hand holes on the bus, spokes on the cab -- which is what makes
 * the turning visible. 8 strips x `segs` quads: 192 triangles at 12.
 */
function addWheel(P, x, y, z, side, R, W, segs, dishLook) {
  const prof = [
    [R, -W / 2, K.tyre], [R, W / 2 - 0.03, K.tyre], [R * 0.955, W / 2, K.tyre], [R * 0.72, W / 2 + 0.004, K.tyre],
    [R * 0.645, W / 2 - 0.018, K.rim], [R * 0.60, W / 2 - 0.03, K.rim], [R * 0.36, W / 2 - 0.075, null],
    [R * 0.22, W / 2 - 0.05, K.hub], [0, W / 2 - 0.015, null],
  ];
  const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(1, 1, side));
  for (let s = 0; s < prof.length - 1; s++) {
    const [r0, z0, lk] = prof[s], [r1, z1] = prof[s + 1];
    const tr = r1 - r0, tz = z1 - z0, l = Math.hypot(tr, tz) || 1;
    const nr = tz / l, nz = -tr / l;                 // outward for this traversal (tread -> hub)
    const strip = (pick) => {
      const raw = { p: [], n: [], uv: [], i: [], st: [] };
      for (let k = 0; k < segs; k++) {
        if (pick && !pick(k)) continue;
        const a0 = (k / segs) * 2 * PI, a1 = ((k + 1) / segs) * 2 * PI, b = raw.p.length / 3;
        for (const [a, r, zz, v] of [[a0, r0, z0, 0], [a1, r0, z0, 0], [a1, r1, z1, l], [a0, r1, z1, l]]) {
          raw.p.push(Math.cos(a) * r, Math.sin(a) * r, zz);
          raw.n.push(Math.cos(a) * nr, Math.sin(a) * nr, nz);
          raw.uv.push(a * Math.max(r0, r1), v); raw.st.push(0, 0);
        }
        tri(raw, b, b + 1, b + 2); tri(raw, b, b + 2, b + 3);
      }
      return transform(raw, m);
    };
    if (lk) P.add(strip(null), lk, { wheel: [x, y, R] });
    else if (s === 6) {   // the dish: the pattern
      P.add(strip((k) => k % 2 === 0), K.rim, { wheel: [x, y, R] });
      P.add(strip((k) => k % 2 === 1), dishLook, { wheel: [x, y, R] });
    } else P.add(strip(null), K.chrome, { wheel: [x, y, R] });   // hub cap
  }
}

/** Half-cylinder liner inside a wheel arch, facing the hub: from z = za to zb (|zb| > |za|). */
function archLiner(ax, ay, r, yCut, za, zb) {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (yCut - ay) / r)));
  const n = 10;
  return grid(n, 1, (i, j) => {
    const a = a0 + (PI - 2 * a0) * (i / n);
    const z = j === 0 ? za : zb;
    return { p: [ax + Math.cos(a) * r, ay + Math.sin(a) * r, z], n: [-Math.cos(a), -Math.sin(a), 0] };
  });
}

/** The trim round an arch opening on the body side (z, facing s): r0..r1, down to yCut. */
function archTrim(ax, ay, r0, r1, yCut, z, s) {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (yCut - ay) / r0)));
  const n = 12;
  return grid(n, 1, (i, j) => {
    const a = a0 + (PI - 2 * a0) * (i / n), r = j === 0 ? r0 : r1;
    return { p: [ax + Math.cos(a) * r, Math.max(yCut, ay + Math.sin(a) * r), z], n: [0, 0, s] };
  });
}

/* ------------------------------------------------------ the bus surface */

const BUS = { y0: 0.30, yS: 3.95, R: 0.30, crown: 0.10, axle: 2.95, wheelR: 0.50, wheelW: 0.30, wheelZ: 1.08, archR: 0.60, archY: 0.52, split: 1.25 };
BUS.xA = BUS.axle + BUS.archR + 0.08;   // where the lower-front paint meets the flat side panel

const knot = (Kn, y) => {
  if (y <= Kn[0][0]) return Kn[0][1];
  for (let i = 1; i < Kn.length; i++) if (y <= Kn[i][0]) { const [y0, v0] = Kn[i - 1], [y1, v1] = Kn[i]; return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0); }
  return Kn[Kn.length - 1][1];
};
// front face x, rear face |x|, half width, front / rear corner radii -- each by height
const BUS_XF = [[0.30, 5.25], [1.15, 5.25], [2.25, 5.16], [2.72, 5.13], [3.95, 4.98]];
const BUS_XR = [[0.30, 5.25], [3.95, 5.21]];
const BUS_B = [[0.30, 1.275], [2.20, 1.275], [3.95, 1.235]];
const BUS_RF = [[0.30, 0.30], [1.25, 0.33], [2.72, 0.40], [3.95, 0.44]];
const BUS_RR = [[0.30, 0.28], [3.95, 0.30]];
const busPlan = (y) => ({ xf: knot(BUS_XF, y), xr: knot(BUS_XR, y), b: knot(BUS_B, y), rf: knot(BUS_RF, y), rr: knot(BUS_RR, y) });
const inset = (p, d) => ({ xf: p.xf - d, xr: p.xr - d, b: Math.max(0, p.b - d), rf: Math.max(0, p.rf - d), rr: Math.max(0, p.rr - d) });

/**
 * A point on the rounded-rectangle plan outline `p` at k in [0, 10): ten
 * pieces, clockwise from above starting at the front centre -- front half,
 * FR corner, right side (front -> rear), RR corner, rear half, rear half, RL
 * corner, left side (rear -> front), FL corner, front half. Unrolled k (10.3)
 * wraps. Returns [x, z].
 */
function ringAt(p, k) {
  k = ((k % 10) + 10) % 10;
  const i = Math.min(9, Math.floor(k)), t = k - i;
  const fz = p.b - p.rf, rz = p.b - p.rr, sx0 = p.xf - p.rf, sx1 = -p.xr + p.rr;
  switch (i) {
    case 0: return [p.xf, t * fz];
    case 1: { const a = t * PI / 2; return [sx0 + p.rf * Math.cos(a), fz + p.rf * Math.sin(a)]; }
    case 2: return [sx0 + (sx1 - sx0) * t, p.b];
    case 3: { const a = PI / 2 + t * PI / 2; return [sx1 + p.rr * Math.cos(a), rz + p.rr * Math.sin(a)]; }
    case 4: return [-p.xr, rz * (1 - t)];
    case 5: return [-p.xr, -rz * t];
    case 6: { const a = PI + t * PI / 2; return [sx1 + p.rr * Math.cos(a), -rz + p.rr * Math.sin(a)]; }
    case 7: return [sx1 + (sx0 - sx1) * t, -p.b];
    case 8: { const a = 1.5 * PI + t * PI / 2; return [sx0 + p.rf * Math.cos(a), -fz + p.rf * Math.sin(a)]; }
    default: return [p.xf, -fz * (1 - t)];
  }
}

/** The bus body at (k, h): h 0..1 up the walls, 1..2 over the roof roll, 2..3 across the crown to the ridge. */
function busS(k, h) {
  let p, y;
  if (h <= 1) { y = BUS.y0 + h * (BUS.yS - BUS.y0); p = busPlan(y); }
  else if (h <= 2) { const f = (h - 1) * PI / 2; p = inset(busPlan(BUS.yS), BUS.R * (1 - Math.cos(f))); y = BUS.yS + BUS.R * Math.sin(f); }
  else { const t = Math.min(1, h - 2), base = busPlan(BUS.yS); p = inset(base, BUS.R + t * (base.b - BUS.R)); y = BUS.yS + BUS.R + (BUS.crown * (1 - Math.cos(t * PI))) / 2; }
  const [x, z] = ringAt(p, k);
  return [x, y, z];
}
const busAxis = (p) => [Math.max(-3.9, Math.min(3.7, p[0])), 1.9, 0];
const hOfY = (y) => (y - BUS.y0) / (BUS.yS - BUS.y0);

/** Outward unit normal of a parametric surface S(a, b) by central differences; `axis` orients it and stands in where it degenerates. */
function surfaceNormal(S, a, b, da, db, bMin, bMax, axis) {
  const p = S(a, b);
  const ta = sub(S(a + da, b), S(a - da, b));
  const tb = sub(S(a, Math.min(bMax, b + db)), S(a, Math.max(bMin, b - db)));
  let n = cross(ta, tb);
  const out = sub(p, axis(p));
  if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = out;
  if (dot(n, out) < 0) n = [-n[0], -n[1], -n[2]];
  return norm(n);
}
const busN = (k, h) => surfaceNormal(busS, k, h, 1e-3, 1e-3, 0, 3, busAxis);

/**
 * Resolve a column spec at height y to k: a number is k itself; {x, side} a
 * side-wall column at x (vertical at any rake); {x0, x1, side} slants from x0
 * at the patch's bottom row to x1 at its top (the stair windows); {fz} a front
 * face column at z, {rz} a rear one.
 */
function colK(c, y, f) {
  if (typeof c === 'number') return c;
  const p = busPlan(y);
  if (c.fz !== undefined) return 10 + c.fz / (p.b - p.rf);
  if (c.rz !== undefined) return 5 - c.rz / (p.b - p.rr);
  const x = c.x !== undefined ? c.x : c.x0 + (c.x1 - c.x0) * f;
  const sx0 = p.xf - p.rf, sx1 = -p.xr + p.rr, t = Math.max(0, Math.min(1, (sx0 - x) / (sx0 - sx1)));
  return c.side > 0 ? 2 + t : 7 + (1 - t);
}

/** A patch of the bus surface over columns `cols` and heights `ys`, pushed out by `off` along the normal. */
function busPatch(cols, ys, off) {
  const nv = ys.length - 1;
  return grid(cols.length - 1, nv, (i, j) => {
    const y = ys[j], h = hOfY(y), k = colK(cols[i], y, j / nv);
    const p = busS(k, h), n = busN(k, h);
    return { p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n, st: [i / (cols.length - 1), j / nv] };
  });
}

// k samples round the front (FL corner .. front .. FR corner) and the rear, unrolled so they increase
const FRONT_K = [8, 8.25, 8.5, 8.75, 9, 9.5, 10, 10.5, 11, 11.25, 11.5, 11.75, 12];
const REAR_K = [3, 3.25, 3.5, 3.75, 4, 4.5, 5, 5.5, 6, 6.25, 6.5, 6.75, 7];
const FRONT_K_LOD = [8, 8.5, 9, 10, 11, 11.5, 12];
const REAR_K_LOD = [3, 3.5, 4, 5, 6, 6.5, 7];
/** Columns from the left side at xL round the front to the right side at xR. */
const aroundFront = (xL, xR, ks = FRONT_K) => [{ x: xL, side: -1 }, ...ks, { x: xR, side: 1 }];
/** Columns from the right side at xR round the rear to the left side at xL. */
const aroundRear = (xR, xL, ks = REAR_K) => [{ x: xR, side: 1 }, ...ks, { x: xL, side: -1 }];
/** Corner k values strictly between two resolved columns (a patch that starts and ends on the front face but wraps a corner). */
const ksBetween = (list, k0, k1) => list.filter((k) => k > k0 + 1e-6 && k < k1 - 1e-6);

/* Ring segments per plan piece (front half, corner, side, corner, rear half, ...). */
const HULL_SEGS = [2, 4, 4, 4, 2, 2, 4, 4, 4, 2];
const LOD_SEGS = [1, 2, 1, 2, 1, 1, 2, 1, 2, 1];
const ringKs = (segs) => { const ks = []; segs.forEach((n, piece) => { for (let s = 0; s < n; s++) ks.push(piece + s / n); }); ks.push(10); return ks; };

/** The painted shell of the bus: 11 ring rows over the walls, roll and crown, the lower front and rear, the arched side panels, a roof pod. */
function busShell(lod) {
  const P = new Parts();
  const ks = ringKs(lod ? LOD_SEGS : HULL_SEGS);
  const wallY = lod ? [BUS.y0, BUS.split, 2.25, 2.72, BUS.yS] : [BUS.split, 2.25, 2.72, BUS.yS];
  const hs = [...wallY.map(hOfY), ...(lod ? [1.5, 2, 3] : [1.25, 1.5, 1.75, 2, 2.33, 2.66, 3])];
  P.add(grid(ks.length - 1, hs.length - 1, (i, j) => ({ p: busS(ks[i], hs[j]), n: busN(ks[i], hs[j]) })), K.paintBus);
  // the roof pod (air conditioning), sunk into the crown
  P.add(box(-3.2, 4.315, 0, 2.0, 0.23, 1.6), K.paintBus);
  if (lod) return P;
  // below the split: the front and rear wrap down to the skirt, the flat sides carry the arches
  const low = [BUS.y0, 0.62, 0.95, BUS.split];
  P.add(busPatch(aroundFront(BUS.xA, BUS.xA), low, 0), K.paintBus);
  P.add(busPatch(aroundRear(-BUS.xA, -BUS.xA), low, 0), K.paintBus);
  for (const side of [1, -1]) {
    const poly = [];
    const arch = (ax, dir) => {
      const a0 = Math.asin((BUS.y0 - BUS.archY) / BUS.archR);
      for (let s = 0; s <= 12; s++) {
        const a = dir > 0 ? PI - a0 - (PI - 2 * a0) * (s / 12) : a0 + (PI - 2 * a0) * (s / 12);
        poly.push([ax + Math.cos(a) * BUS.archR, BUS.archY + Math.sin(a) * BUS.archR]);
      }
    };
    // along the bottom rear -> front, over both arches, then back along the top
    poly.push([-BUS.xA, BUS.y0]);
    arch(-BUS.axle, 1);
    arch(BUS.axle, 1);
    poly.push([BUS.xA, BUS.y0], [BUS.xA, BUS.split], [-BUS.xA, BUS.split]);
    P.add(flat(poly, side * knot(BUS_B, 0.5), side), K.paintBus);
  }
  return P;
}

/** Everything on the bus that is not paint. `lod`: bands, blind, bumpers and four wheel discs only. */
function busDetail(lod) {
  const P = new Parts();
  const b = knot(BUS_B, 0.5);
  if (lod) {
    // the bands take the LOD hull's own k samples: on a coarser chord they would cut inside it at the corners
    P.add(busPatch(aroundFront(-4.95, -4.95, FRONT_K_LOD), [BUS.split, 2.25], 0.02), K.glassLit);
    P.add(busPatch(ringKs(LOD_SEGS), [2.76, 3.82], 0.02), K.glassLit);
    P.add(busPatch([{ fz: -0.82 }, { fz: 0.82 }], [2.33, 2.64], 0.03), K.blind, { atlas: { cell: CELL.blind, step: CELL.blindStep, read: [0, -1] } });
    P.add(busPatch(aroundFront(3.6, 3.6, FRONT_K_LOD), [BUS.y0, 0.64], 0.03), K.trim);
    P.add(busPatch(aroundRear(-3.6, -3.6, REAR_K_LOD), [BUS.y0, 0.44], 0.03), K.trim);
    for (const x of [BUS.axle, -BUS.axle]) for (const s of [1, -1]) P.add(disc([x, BUS.wheelR, s * (b + 0.015)], BUS.wheelR, 8, 'z', s), K.tyre);
    return P;
  }
  const G = 0.022, F = 0.012;   // glass sits 1 cm proud of its black surround, the surround 1.2 cm proud of the paint
  const pane = (x0, x1, y0, y1, side, lk = K.glassLit) => P.add(busPatch([{ x: x0, side }, { x: x1, side }], [y0, y1], G), lk);

  /* Lower deck. The left (off) side is one run of eight panes; the kerb side
     has the entrance door behind the front axle's arch... ahead of it, and the
     exit between the axles. */
  P.add(busPatch([{ x: -4.95, side: -1 }, { x: 4.80, side: -1 }], [1.30, 2.22], F), K.black);
  P.add(busPatch([{ x: -4.95, side: 1 }, { x: -0.16, side: 1 }], [1.30, 2.22], F), K.black);
  P.add(busPatch([{ x: 1.16, side: 1 }, { x: 3.54, side: 1 }], [1.30, 2.22], F), K.black);
  const lowL = [-4.90, -3.85, -2.60, -1.35, -0.10, 1.15, 2.40, 3.60, 4.75];
  for (let i = 0; i < lowL.length - 1; i++) pane(lowL[i] + 0.04, lowL[i + 1] - 0.04, 1.36, 2.16, -1);
  for (const [x0, x1] of [[-4.86, -3.89], [-3.81, -2.64], [-2.56, -1.39], [-1.31, -0.22], [1.22, 2.36], [2.44, 3.46]]) pane(x0, x1, 1.36, 2.16, 1);
  // the doors, kerb side: black frames, two glazed leaves each (the entrance ends where the front corner begins)
  for (const [d0, d1] of [[-0.10, 1.10], [3.60, 4.76]]) {
    P.add(busPatch([{ x: d0, side: 1 }, { x: d1, side: 1 }], [0.34, 2.24], F), K.black);
    const mid = (d0 + d1) / 2;
    pane(d0 + 0.05, mid - 0.025, 0.42, 2.16, 1);
    pane(mid + 0.025, d1 - 0.05, 0.42, 2.16, 1);
  }
  // the lower windscreen and its surround, wrapping both front corners
  P.add(busPatch(aroundFront(4.80, 4.80), [1.14, 2.28], F), K.black);
  P.add(busPatch(aroundFront(4.86, 4.86), [1.20, 2.22], G), K.glass);

  /* Between the decks: the destination blind (lit), the side blind over the
     entrance, the rear route number, the ads, and the diagonal stair windows
     (the New Routemaster's signature) where the staircases climb. */
  P.add(busPatch([{ fz: -0.88 }, { fz: 0.88 }], [2.29, 2.68], F), K.black);
  P.add(busPatch([{ fz: -0.82 }, { fz: 0.82 }], [2.33, 2.64], G), K.blind, { atlas: { cell: CELL.blind, step: CELL.blindStep, read: [0, -1] } });
  P.add(busPatch([{ x: 3.40, side: 1 }, { x: 4.78, side: 1 }], [2.30, 2.56], F), K.black);
  P.add(busPatch([{ x: 3.44, side: 1 }, { x: 4.74, side: 1 }], [2.34, 2.52], G), K.blind, { atlas: { cell: CELL.blind, step: CELL.blindStep, read: [1, 0] } });
  P.add(busPatch([{ rz: -0.27 }, { rz: 0.27 }], [2.35, 2.65], F), K.black);
  P.add(busPatch([{ rz: -0.22 }, { rz: 0.22 }], [2.39, 2.61], G), K.blind, { atlas: { cell: CELL.route, step: CELL.routeStep, read: [0, 1] } });
  P.add(busPatch([{ x: -4.30, side: 1 }, { x: 1.90, side: 1 }], [2.28, 2.70], 0.008), K.ad, { atlas: { cell: CELL.adA, read: [1, 0] } });
  P.add(busPatch([{ x: -3.10, side: -1 }, { x: 3.60, side: -1 }], [2.28, 2.70], 0.008), K.ad, { atlas: { cell: CELL.adB, read: [-1, 0] } });
  /* Stair windows: kerb side behind the entrance climbing rearward, off side
     at the rear climbing forward. Their surrounds sit 2 mm prouder than the
     deck bands they cross, so the overlap never z-fights. */
  const FS = F + 0.002;
  P.add(busPatch([{ x0: 2.86, x1: 2.16, side: 1 }, { x0: 3.50, x1: 2.80, side: 1 }], [2.12, 2.86], FS), K.black);
  P.add(busPatch([{ x0: 2.90, x1: 2.20, side: 1 }, { x0: 3.46, x1: 2.76, side: 1 }], [2.16, 2.82], G), K.glassLit);
  P.add(busPatch([{ x0: -4.54, x1: -3.84, side: -1 }, { x0: -3.90, x1: -3.20, side: -1 }], [2.12, 2.86], FS), K.black);
  P.add(busPatch([{ x0: -4.50, x1: -3.80, side: -1 }, { x0: -3.94, x1: -3.24, side: -1 }], [2.16, 2.82], G), K.glassLit);

  /* Upper deck: one black band all the way round, eight panes a side, the two
     front screens wrapping the corners, the rear window wrapping the back. */
  P.add(busPatch(ringKs(HULL_SEGS), [2.76, 3.82], F), K.black);
  const up = [-4.90, -3.75, -2.55, -1.35, -0.15, 1.05, 2.25, 3.45, 4.60];
  for (const side of [1, -1]) for (let i = 0; i < up.length - 1; i++) pane(up[i] + 0.04, up[i + 1] - 0.04, 2.82, 3.76, side);
  {
    const yM = 3.3, pl = busPlan(yM), fz = pl.b - pl.rf, kL = 10 - 0.03 / fz, kR = 10 + 0.03 / fz;
    const kSideL = colK({ x: 4.64, side: -1 }, yM, 0), kSideR = colK({ x: 4.64, side: 1 }, yM, 0) + 10;
    P.add(busPatch([{ x: 4.64, side: -1 }, ...ksBetween(FRONT_K, kSideL, kL), kL], [2.82, 3.76], G), K.glassLit);
    P.add(busPatch([kR, ...ksBetween(FRONT_K, kR, kSideR), { x: 4.64, side: 1 }], [2.82, 3.76], G), K.glassLit);
    P.add(busPatch([3.2, ...ksBetween(REAR_K, 3.2, 6.8), 6.8], [2.95, 3.70], G), K.glassLit);
  }

  /* The front: bumper wrapping the corners (with a top face), grille, lamp
     clusters and indicators, plate, wipers, the bunny-ear mirrors. */
  const slab = (cols, y0, y1, off, lk) => {
    P.add(busPatch(cols, [y0, y1], off), lk);
    // the top face: from the paint out to the slab's upper edge
    P.add(grid(cols.length - 1, 1, (i, j) => {
      const h = hOfY(y1), k = colK(cols[i], y1, 1), p = busS(k, h), n = busN(k, h), o = j === 0 ? 0 : off;
      return { p: [p[0] + n[0] * o, p[1], p[2] + n[2] * o], n: [0, 1, 0] };
    }), lk);
  };
  // the bumper stops at the kerb-side corner: the entrance door comes down to the step
  slab([{ x: 3.62, side: -1 }, ...FRONT_K], BUS.y0, 0.64, 0.035, K.trim);
  P.add(busPatch([{ fz: -0.62 }, { fz: 0.62 }], [0.68, 1.02], F), K.black);
  for (const y of [0.76, 0.85, 0.94]) P.add(box(5.265, y, 0, 0.012, 0.022, 1.2), K.grey);
  for (const s of [1, -1]) {
    // headlamp reflector from z = 0.70 to the corner (k 11 / 9 are where the front face meets the corner arcs), an indicator round the corner
    P.add(busPatch(s > 0 ? [{ fz: 0.70 }, 11] : [9, { fz: -0.70 }], [0.66, 0.84], 0.02), K.reflector);
    P.add(busPatch(s > 0 ? [11.04, 11.2, 11.36] : [8.64, 8.8, 8.96], [0.66, 0.84], 0.02), K.lensA);
  }
  P.add(box(5.25 + 0.035 + 0.006, 0.415, 0, 0.004, 0.11, 0.52), K.plate, { atlas: { cell: CELL.plateF } });
  for (const z0 of [-0.55, 0.15]) P.add(bar([5.262, 1.27, z0], [5.215, 1.93, z0 + 0.30], 0.022, 0.018), K.black);
  for (const s of [1, -1]) {
    P.add(bar([5.00, 2.30, s * 1.18], [5.42, 2.22, s * 1.34], 0.045, 0.045), K.black);
    P.add(bar([5.42, 2.22, s * 1.34], [5.46, 1.98, s * 1.36], 0.04, 0.04), K.black);
    P.add(box(5.47, 1.80, s * 1.37, 0.07, 0.36, 0.22), K.black);
    P.add(box(5.432, 1.80, s * 1.37, 0.004, 0.32, 0.19), K.chrome);   // the glass faces the driver; from ahead you see its black back
  }

  /* The rear: bumper, engine grille with louvres, tail lamp housings (the
     brake mesh glows over them), plate on the bumper. */
  slab(aroundRear(-3.62, -3.62), BUS.y0, 0.44, 0.03, K.trim);
  P.add(busPatch([{ rz: -0.80 }, { rz: 0.80 }], [0.46, 1.06], F), K.black);
  for (let i = 0; i < 5; i++) P.add(box(-5.268, 0.53 + i * 0.12, 0, 0.014, 0.03, 1.5), K.grey);
  for (const s of [1, -1]) P.add(busPatch([{ rz: s * 0.86 }, { rz: s * 1.0 }], [0.47, 1.19], 0.014), K.lensR);
  P.add(box(-5.25 - 0.03 - 0.006, 0.37, 0, 0.004, 0.11, 0.52), K.plateR, { atlas: { cell: CELL.plateR, read: [0, 1] } });
  // the big rear poster every London bus carries
  P.add(busPatch([{ rz: -0.97 }, { rz: 0.97 }], [1.28, 1.93], 0.008), K.ad, { atlas: { cell: CELL.poster, read: [0, 1] } });
  for (const s of [1, -1]) P.add(busPatch([{ rz: s * 0.18 }, { rz: s * 0.42 }], [3.84, 3.94], 0.012), K.lensR);

  // a black plinth between the arches (broken for the exit door), the arch trims and liners, the underside
  for (const s of [1, -1]) {
    for (const [x0, x1] of s > 0 ? [[-2.34, -0.12], [1.12, 2.34]] : [[-2.34, 2.34]]) P.add(busPatch([{ x: x0, side: s }, { x: x1, side: s }], [BUS.y0, 0.40], F), K.trim);
    for (const ax of [BUS.axle, -BUS.axle]) {
      P.add(archTrim(ax, BUS.archY, BUS.archR, BUS.archR + 0.045, BUS.y0, s * (b + 0.010), s), K.rubber);
      // the liner meets the panel's own edge: 1.5 cm inside it left a sliver of sky between the two
      P.add(archLiner(ax, BUS.archY, BUS.archR - 0.004, BUS.y0, s * (b - 0.48), s * (b + 0.002)), K.liner);
    }
  }
  P.add(grid(1, 1, (i, j) => ({ p: [i ? 5.05 : -5.05, BUS.y0 + 0.004, j ? 1.2 : -1.2], n: [0, -1, 0] })), K.liner);

  for (const x of [BUS.axle, -BUS.axle]) for (const s of [1, -1]) addWheel(P, x, BUS.wheelR, s * BUS.wheelZ, s, BUS.wheelR, BUS.wheelW, 12, K.rimDark);
  return P;
}

/** Shared lamp geometry: the night lamp pair (traffic's lampMat) and the brake lamps (its brakeMat), on the authored lenses. */
function busLamps() {
  const head = new Parts(), tail = new Parts();
  for (const s of [1, -1]) {
    head.add(box(5.25 + 0.02 + 0.012, 0.75, s * 0.82, 0.012, 0.15, 0.22));
    tail.add(box(-5.25 - 0.024, 0.83, s * 0.93, 0.012, 0.64, 0.11));
    tail.add(box(-knot(BUS_XR, 3.89) - 0.022, 3.89, s * 0.30, 0.01, 0.06, 0.20));
  }
  return { head: head.build(false), tail: tail.build(false) };
}

/* ------------------------------------------------------- the cab surface */

const CAB = { axleF: 1.50, axleR: -1.39, wheelR: 0.35, wheelW: 0.20, wheelZ: 0.75, archR: 0.43, archY: 0.35, sill: 0.27 };
/* Key stations, nose to tail: x, sill yb, half width w, belt, centreline top,
   greenhouse g (0 bonnet/boot, 1 cabin), roof-edge half width wg, roof-edge height. */
const CAB_KEYS = [
  [2.29, 0.34, 0.60, 0.85, 0.88, 0, 0.70, 1.00],
  [2.25, 0.30, 0.72, 0.89, 0.93, 0, 0.70, 1.00],
  [2.12, 0.28, 0.81, 0.94, 0.98, 0, 0.70, 1.02],
  [1.95, 0.27, 0.86, 0.97, 1.01, 0, 0.70, 1.04],
  [0.97, 0.27, 0.87, 1.00, 1.045, 0, 0.70, 1.08],
  [0.55, 0.27, 0.87, 1.02, 1.73, 1, 0.70, 1.64],
  [-0.30, 0.27, 0.87, 1.02, 1.765, 1, 0.715, 1.67],
  [-1.26, 0.27, 0.87, 1.02, 1.74, 1, 0.70, 1.64],
  [-1.74, 0.27, 0.86, 1.00, 1.08, 0, 0.70, 1.10],
  [-2.08, 0.28, 0.83, 0.97, 1.03, 0, 0.70, 1.05],
  [-2.24, 0.31, 0.76, 0.91, 0.96, 0, 0.70, 1.00],
  [-2.29, 0.35, 0.62, 0.84, 0.87, 0, 0.70, 1.00],
];

function cabParams(x) {
  const Kc = CAB_KEYS;
  let i = 1;
  while (i < Kc.length - 1 && Kc[i][0] > x) i++;
  const a = Kc[i - 1], b = Kc[i], t = Math.max(0, Math.min(1, (a[0] - x) / (a[0] - b[0])));
  const v = a.map((av, j) => av + (b[j] - av) * t);
  const p = { yb: v[1], w: v[2], belt: v[3], top: v[4], g: v[5], wg: v[6], yRE: v[7] };
  /* The sill rises over the wheels: the arches are openings, not paint. One
     height per station, so the opening is the circle's UPPER half, and the
     sill steps up to the hub height 4 mm outside it (cabStations) -- the
     first cut took the arch from the sill line and the lower half of the
     circle doubles back, so the sill ramped into the rear arch instead. */
  for (const ax of [CAB.axleF, CAB.axleR]) {
    const dx = x - ax;
    if (Math.abs(dx) <= CAB.archR + 1e-6) p.yb = Math.max(p.yb, CAB.archY + Math.sqrt(Math.max(0, CAB.archR * CAB.archR - dx * dx)));
  }
  return p;
}

/** Half a section, u = 0 (floor centre) .. 11 (roof centre): floor, lower corner, side with a bulge, belt, then bonnet or greenhouse by g. */
function cabHalf(p) {
  const rb = 0.09, crown = p.top - p.belt;
  const pts = [
    [0, p.yb], [p.w - rb, p.yb], [p.w - rb * 0.29, p.yb + rb * 0.29], [p.w, p.yb + rb],
    [p.w + 0.012, (p.yb + rb + p.belt) / 2], [p.w + 0.004, p.belt - 0.06], [p.w - 0.012, p.belt],
  ];
  const B = [[p.w - 0.07, p.belt + crown * 0.35], [p.w - 0.18, p.belt + crown * 0.62], [p.w * 0.55, p.belt + crown * 0.88], [p.w * 0.25, p.top - 0.002], [0, p.top]];
  const C = [[p.w - 0.05, p.belt + 0.03], [p.wg + 0.015, p.yRE - 0.05], [p.wg - 0.035, p.yRE + 0.03], [p.wg - 0.22, p.top - 0.012], [0, p.top]];
  for (let i = 0; i < 5; i++) pts.push([B[i][0] + (C[i][0] - B[i][0]) * p.g, B[i][1] + (C[i][1] - B[i][1]) * p.g]);
  return pts;
}

/** Mesh stations, nose to tail: the keys, seven over each arch's upper half (30 degree steps) so the openings are round, and the sill step just outside each. */
function cabStations(lod) {
  const xs = new Set(CAB_KEYS.map((k) => k[0]));
  if (!lod) {
    for (const ax of [CAB.axleF, CAB.axleR]) {
      for (let s = 0; s <= 6; s++) xs.add(ax + Math.cos((s / 6) * PI) * CAB.archR);
      xs.add(ax + CAB.archR + 0.004); xs.add(ax - CAB.archR - 0.004);
    }
  }
  return [...xs].sort((a, b) => b - a);
}

/**
 * The cab's loft as a surface that matches its own MESH: exact sections at
 * the stations, linear between them in x, and linear between section points
 * in u (0..22 round the ring: 0..11 up the right half, 11..22 down the left).
 * Patches sampled at the same stations and integer u lie on the mesh exactly.
 */
function makeCabLoft(lod) {
  const xs = cabStations(lod);
  const secs = xs.map((x) => cabHalf(cabParams(x)));
  const halfAt = (sec, u) => {
    u = Math.max(0, Math.min(11, u));
    const i = Math.min(10, Math.floor(u)), t = u - i;
    return [sec[i][0] + (sec[i + 1][0] - sec[i][0]) * t, sec[i][1] + (sec[i + 1][1] - sec[i][1]) * t];
  };
  const S = (x, u) => {
    x = Math.max(xs[xs.length - 1], Math.min(xs[0], x));
    let i = 1;
    while (i < xs.length - 1 && xs[i] > x) i++;
    const t = (xs[i - 1] - x) / (xs[i - 1] - xs[i] || 1);
    const left = u > 11, uu = left ? 22 - u : u;
    const a = halfAt(secs[i - 1], uu), b = halfAt(secs[i], uu);
    const z = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    return [x, y, left ? -z : z];
  };
  const axis = (p) => [Math.max(-1.8, Math.min(1.8, p[0])), 0.85, 0];
  const N = (x, u) => surfaceNormal((uu, xx) => S(xx, uu), u, x, 1e-3, 1e-3, xs[xs.length - 1], xs[0], axis);
  return { xs, S, N };
}

/** Sample list over [a, b] (either order) keeping every mesh station / integer in between. */
function span(a, b, stops) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const inner = stops.filter((s) => s > lo + 1e-6 && s < hi - 1e-6);
  const out = [lo, ...inner.sort((p, q) => p - q), hi];
  return a > b ? out.reverse() : out;
}
const INTS = [...Array(23).keys()];
/** A patch of the cab loft over x in [x0, x1], u in [u0, u1], pushed out by off. */
function cabPatch(L, x0, x1, u0, u1, off) {
  const xs = span(x0, x1, L.xs), us = span(u0, u1, INTS);
  return grid(xs.length - 1, us.length - 1, (i, j) => {
    const p = L.S(xs[i], us[j]), n = L.N(xs[i], us[j]);
    return { p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n, st: [i / (xs.length - 1), j / (us.length - 1)] };
  });
}

/** Close the loft's first / last ring with a fan. */
function cabCap(L, x, s) {
  const raw = { p: [], n: [], uv: [], i: [], st: [] };
  const ring = [];
  for (let u = 0; u < 22; u++) ring.push(L.S(x, u));
  const c = ring.reduce((a, p) => [a[0] + p[0] / 22, a[1] + p[1] / 22, a[2] + p[2] / 22], [0, 0, 0]);
  raw.p.push(...c); raw.n.push(s, 0, 0); raw.uv.push(c[2], c[1]); raw.st.push(0, 0);
  for (const p of ring) { raw.p.push(...p); raw.n.push(s, 0, 0); raw.uv.push(p[2], p[1]); raw.st.push(0, 0); }
  for (let k = 0; k < 22; k++) tri(raw, 0, 1 + k, 1 + ((k + 1) % 22));
  return raw;
}

function cabShell(lod) {
  const L = makeCabLoft(lod), P = new Parts();
  const us = lod ? [0, 1, 3, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 19, 21, 22] : INTS;
  P.add(grid(L.xs.length - 1, us.length - 1, (i, j) => ({ p: L.S(L.xs[i], us[j]), n: L.N(L.xs[i], us[j]) })), K.paintCab);
  P.add(cabCap(L, L.xs[0], 1), K.paintCab);
  P.add(cabCap(L, L.xs[L.xs.length - 1], -1), K.paintCab);
  return { P, L };
}

function cabDetail(lod, wheels = true) {
  const L = makeCabLoft(lod), P = new Parts();
  const mirrorU = (u) => 22 - u;
  // the greenhouse: black band behind the side glass, then the panes, windscreen and rear window on their surrounds
  for (const s of [1, -1]) {
    const U = (u) => (s > 0 ? u : mirrorU(u));
    P.add(cabPatch(L, 0.535, -1.245, U(6.97), U(8.03), 0.003), K.black);
    if (!lod) for (const [x0, x1] of [[0.52, 0.20], [0.12, -0.88], [-1.00, -1.22]]) P.add(cabPatch(L, x0, x1, U(7.06), U(7.94), 0.007), K.glass);
  }
  P.add(cabPatch(L, 0.965, 0.555, 7.96, 14.04, 0.003), K.black);
  P.add(cabPatch(L, 0.955, 0.565, 8.06, 13.94, 0.006), K.glass);
  P.add(cabPatch(L, -1.262, -1.738, 8.0, 14.0, 0.003), K.black);
  P.add(cabPatch(L, -1.27, -1.73, 8.1, 13.9, 0.006), K.glass);

  // the TAXI sign on the roof's front edge: lit both ways, the letters from the atlas
  {
    const x = 0.42, y0 = 1.72, h = 0.14, d = 0.12, w = 0.54;   // the plinth sinks 1.5 cm into the crowned roof so its ends never float
    P.add(box(x, y0 + 0.012, 0, d + 0.02, 0.024, w + 0.04), K.black);
    const sign = box(x, y0 + 0.024 + h / 2, 0, d, h, w);
    P.add(sign, K.taxi);
    for (const s of [1, -1]) P.add(box(x + s * (d / 2 + 0.001), y0 + 0.024 + h / 2, 0, 0.002, h * 0.9, w * 0.94), K.taxi, { atlas: { cell: CELL.taxi, read: [0, -s] } });
  }
  if (lod) {
    for (const ax of [CAB.axleF, CAB.axleR]) for (const s of [1, -1]) P.add(disc([ax, CAB.wheelR, s * 0.90], CAB.wheelR, 8, 'z', s), K.tyre);
    P.add(box(2.305, 0.385, 0, 0.11, 0.17, 1.6), K.trim);
    P.add(box(-2.305, 0.385, 0, 0.11, 0.17, 1.6), K.trim);
    return P;
  }
  // shut lines of the front and the big rear doors, the sill line under them
  for (const s of [1, -1]) {
    const U = (u) => (s > 0 ? u : mirrorU(u));
    for (const x of [0.94, 0.16, -0.92]) P.add(cabPatch(L, x + 0.006, x - 0.006, U(3.0), U(6.95), 0.002), K.black);
    P.add(cabPatch(L, 0.94, -0.92, U(3.10), U(3.20), 0.002), K.black);
    // chrome drip rail along the roof edge
    P.add(cabPatch(L, 0.55, -1.26, U(8.93), U(9.07), 0.004), K.chrome);
    // door handles: the front door's at its rear edge, the rear door's at its front edge
    for (const x of [0.26, 0.04]) P.add(box(x, 0.93, s * 0.893, 0.13, 0.028, 0.026), K.chrome);
    // door mirror
    P.add(bar([0.84, 1.06, s * 0.86], [0.79, 1.11, s * 0.98], 0.03, 0.03), K.black);
    P.add(box(0.78, 1.13, s * 1.035, 0.08, 0.12, 0.17), K.black);
  }
  // wipers parked at the foot of the windscreen
  for (const [u0, u1] of [[9.0, 10.8], [11.2, 13.0]]) {
    const a = L.S(0.935, u0), b = L.S(0.935, u1), n = L.N(0.935, (u0 + u1) / 2);
    P.add(bar([a[0] + n[0] * 0.014, a[1] + n[1] * 0.014, a[2]], [b[0] + n[0] * 0.014, b[1] + n[1] * 0.014, b[2]], 0.018, 0.016), K.black);
  }
  // the grille: chrome surround, black insert, seven chrome bars
  P.add(box(2.300, 0.64, 0, 0.030, 0.40, 0.52), K.chrome);
  P.add(box(2.318, 0.64, 0, 0.010, 0.34, 0.44), K.black);
  for (let i = -3; i <= 3; i++) P.add(box(2.325, 0.64, i * 0.06, 0.012, 0.33, 0.016), K.chrome);
  // round headlamps in chrome bezels, amber indicators under them
  for (const s of [1, -1]) {
    P.add(disc([2.292, 0.72, s * 0.49], 0.104, 14, 'x', 1, 0.083, 0.012), K.chrome);
    P.add(disc([2.300, 0.72, s * 0.49], 0.084, 14, 'x', 1, 0, 0.01), K.reflector);
    P.add(box(2.296, 0.585, s * 0.49, 0.016, 0.05, 0.11), K.lensA);
  }
  // bumpers: black bars with a chrome top strip, wrapping the corners; plates
  for (const s of [1, -1]) {
    P.add(box(s * 2.305, 0.385, 0, 0.11, 0.17, 1.6), K.trim);
    P.add(box(s * 2.325, 0.476, 0, 0.07, 0.02, 1.56), K.chrome);
    for (const z of [1, -1]) P.add(box(s * 2.19, 0.385, z * 0.83, 0.18, 0.16, 0.06), K.trim);
  }
  P.add(box(2.362, 0.385, 0, 0.004, 0.11, 0.52), K.plate, { atlas: { cell: CELL.plateF } });
  P.add(box(-2.297, 0.555, 0, 0.004, 0.11, 0.52), K.plateR, { atlas: { cell: CELL.plateR, read: [0, 1] } });
  // tail lamp housings (the brake mesh glows over them)
  for (const s of [1, -1]) P.add(box(-2.294, 0.73, s * 0.50, 0.012, 0.28, 0.13), K.lensR);
  // arch liners and wheels
  for (const ax of [CAB.axleF, CAB.axleR]) for (const s of [1, -1]) {
    P.add(archLiner(ax, CAB.archY, CAB.archR - 0.025, CAB.sill, s * 0.46, s * 0.86), K.liner);
    if (wheels) addWheel(P, ax, CAB.wheelR, s * CAB.wheelZ, s, CAB.wheelR, CAB.wheelW, 12, K.rimDark);
  }
  return P;
}

function cabLamps() {
  const head = new Parts(), tail = new Parts();
  for (const s of [1, -1]) {
    head.add(disc([2.312, 0.72, s * 0.49], 0.078, 14, 'x', 1));
    tail.add(box(-2.306, 0.73, s * 0.50, 0.012, 0.22, 0.11));
  }
  return { head: head.build(false), tail: tail.build(false) };
}

/* ------------------------------------------------------------- the kits */

const cache = new Map();
/**
 * The kit for 'bus' | 'cab' at its own size, built once and shared by every
 * vehicle of the style (never disposed: it lives as long as the fleet).
 *   paint    position / normal / uv (traffic's tinted paint material)
 *   detail   the london_vehicle attributes; lodBody the same, one mesh
 */
export function londonKit(style) {
  if (!cache.has(style)) cache.set(style, buildKit(style));
  return cache.get(style);
}

/** A fresh, uncached kit (londonKit shares one; the test builds two to prove determinism). */
function buildKit(style) {
  let paint, detail, lodBody, lamps;
  if (style === 'bus') {
    paint = busShell(false).build(false);
    detail = busDetail(false).build(true);
    const lp = busShell(true); for (const e of busDetail(true).list) lp.list.push(e);
    lodBody = lp.build(true);
    lamps = busLamps();
  } else if (style === 'cab') {
    paint = cabShell(false).P.build(false);
    detail = cabDetail(false).build(true);
    const lp = cabShell(true).P; for (const e of cabDetail(true).list) lp.list.push(e);
    lodBody = lp.build(true);
    lamps = cabLamps();
  } else throw new Error(`no London style '${style}'`);
  const spec = LONDON_SPECS[style];
  paint.userData = { length: spec.L, width: spec.wMax * 2 };
  return {
    style, paint, detail, lodBody, detailMat: londonMaterial(), spec, lamps,
    paints: LONDON_PAINTS[style], finish: FINISH[style], lodFar: LOD_FAR[style], occupant: null,
  };
}

/**
 * The kit for a body of another size -- the hero hull when you carjack a cab
 * (vendorCars.fetchKit with the hull's L / wMax, wheels off: the hero keeps
 * its own). Scaled per axis like the Quaternius fleet (height by the width
 * factor), cached per size so a second carjack allocates nothing.
 */
export function londonKitFor(style, spec, { wheels = true } = {}) {
  const base = londonKit(style), own = base.spec;
  if (!spec || (Math.abs(spec.L - own.L) < 1e-3 && Math.abs(spec.wMax - own.wMax) < 1e-3 && wheels)) return base;
  const key = `${style}|${spec.L.toFixed(3)}|${spec.wMax.toFixed(3)}|${wheels}`;
  if (cache.has(key)) return cache.get(key);
  const sx = spec.L / own.L, sz = spec.wMax / own.wMax;
  const m = new THREE.Matrix4().makeScale(sx, sz, sz);
  // applyMatrix4 moves position / normal only: the hubs the wheels turn about move with them
  const scaled = (g) => {
    const c = g.clone().applyMatrix4(m), w = c.attributes.aPart;
    if (w) for (let i = 0; i < w.count; i++) if (w.getZ(i) < 0) w.setXYZ(i, w.getX(i) * sx, w.getY(i) * sz, w.getZ(i) * sz);
    return c;
  };
  const fresh = !wheels && style === 'cab';
  const detailSrc = fresh ? cabDetail(false, false).build(true) : base.detail;
  const kit = { ...base, paint: base.paint.clone().applyMatrix4(m), detail: scaled(detailSrc), lodBody: scaled(base.lodBody), spec: { ...own, L: spec.L, wMax: spec.wMax } };
  if (fresh) detailSrc.dispose();   // the scaled clone is the one kept
  kit.paint.userData = { length: spec.L, width: spec.wMax * 2 };
  cache.set(key, kit);
  return kit;
}

/** Triangles per style (budget line and the test): paint, detail, their sum, and the LOD. */
export function londonTriangles(style) {
  const k = londonKit(style), t = (g) => g.index.count / 3;
  return { paint: t(k.paint), detail: t(k.detail), total: t(k.paint) + t(k.detail), lod: t(k.lodBody) };
}

export const _internals = { buildKit, busS, busN, busPlan, ringAt, cabParams, makeCabLoft, BUS, CAB, CELL, ATLAS_W, ATLAS_H };
