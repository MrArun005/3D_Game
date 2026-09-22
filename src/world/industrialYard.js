/**
 * Steelgate, Northline and Harbour Point as working yards instead of bare
 * ground, from Arun's five industrial modules.
 *
 * These three districts are 26 `yard` plots running 84-197 m wide by 94-101 m
 * deep, and `warehouse` is capped at 44 x 40 m (ART_CAP), so they were building
 * on 15-16% of their plot and leaving the rest as tarmac. A single 197 m shed
 * would just be a wall, so a plot is laid out as a COMPOUND: a capped run of
 * sheds, an open gantry row, silos for vertical relief, and clutter in the gaps.
 *
 * Parts come back keyed by artKit material so districtWorld merges them per key
 * per chunk exactly like a brickRow -- real library textures, no extra draws.
 *
 * Two things measured off the models that the layout has to respect:
 *   - S1 self-tiles exactly (its +X and -X wall profiles are identical), so a
 *     run of S1 has no seam. S2's inner face matches S1's profile in HEIGHT but
 *     its depth runs to +/-30.000 against S1's +/-29.975: a 2.5 cm step. Below
 *     the 5 cm the eye resolves at these distances, and the cap is pushed out
 *     by that amount so the two never z-fight.
 *   - S3 is an open portal frame with no walls, so it can NEVER butt a shed --
 *     the shed's end would stand open. It only ever forms its own row.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const BASE = '/models/buildings/';
const FILES = ['industrial_s1', 'industrial_s2', 'industrial_s3', 'industrial_s4', 'industrial_s5'];
export const INDUSTRIAL = new Set(['STEELGATE', 'NORTHLINE', 'HARBOUR POINT']);

/* Module footprints, measured from the glTF -- not from the brief, because the
   brief is what was asked for and these are what arrived. */
const SIZE = {
  industrial_s1: { w: 20, d: 60 }, industrial_s2: { w: 12, d: 60 },
  industrial_s3: { w: 20, d: 60 }, industrial_s4: { w: 13.8, d: 13.8 },
  industrial_s5: { w: 15.8, d: 13.2 },
};
const SEAM = 0.025;   // S2 is 2.5 cm deeper than S1; nudge the cap out rather than let them fight

const KEY = [[/^metal_galv|^metal_rust/, 'metal'], [/^metal|alloy|chrome/, 'metal'],
  [/^concrete|stone/, 'concrete'], [/^brick/, 'brick'], [/^glass/, 'glass'], [/^timber/, 'timber']];
const keyFor = (n) => (KEY.find(([re]) => re.test(n || ''))?.[1]) ?? 'concrete';

let CACHE = null;

/** Load the five modules once, each baked to artKit's vertex format by key. */
export function loadIndustrial() {
  if (CACHE) return CACHE;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  CACHE = Promise.all(FILES.map((n) => new Promise((res) => {
    loader.load(`${BASE}${n}.glb`, (g) => res([n, bake(g)]), undefined, () => res([n, null]));
  }))).then((pairs) => {
    const m = new Map();
    for (const [n, v] of pairs) if (v) m.set(n, v);
    if (m.size) console.info(`industrial: ${m.size}/${FILES.length} modules loaded`);
    return m;
  });
  return CACHE;
}

function bake(gltf) {
  const byKey = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    g.setIndex(src.index ? src.index.clone() : null);
    g.setAttribute('position', src.attributes.position.clone());
    g.setAttribute('normal', src.attributes.normal ? src.attributes.normal.clone()
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 3), 3));
    g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone()
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));   // the library texture is the colour
    g.setAttribute('emit', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('flick', new THREE.BufferAttribute(new Float32Array(n), 1));
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const k = keyFor((m?.name || '').toLowerCase());
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(g);
  });
  return byKey.size ? byKey : null;
}

/**
 * Lay a plot out as a compound. `hw`/`hd` are the footprint half-sizes in the
 * building's own frame (+X across the frontage). Returns artKit-keyed parts, or
 * null if the plot is too small to be worth it -- those keep the warehouse.
 */
export function industrialYard(mods, seed, hw, hd) {
  if (!mods || !mods.size) return null;
  const W = hw * 2, D = hd * 2;
  if (W < 60 || D < 50) return null;              // small yards: warehouse already fills those
  const rnd = (() => { let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
    return () => (s = (s * 48271) % 2147483647) / 2147483647; })();

  const place = [];   // { name, x, z, ry }
  const MARGIN = 6;
  const usableW = W - MARGIN * 2;

  /* Row 1: a capped run of sheds along +X, parked toward the back of the plot
     so the yard itself faces the road. S2 caps both ends, mirrored on the far
     side so its gable always looks outward. */
  const s1 = SIZE.industrial_s1, s2 = SIZE.industrial_s2;
  const bays = Math.max(1, Math.floor((usableW - s2.w * 2) / s1.w));
  const runW = s2.w * 2 + bays * s1.w;
  const x0 = -runW / 2;
  const zRow = hd - MARGIN - s1.d / 2;             // back of the plot
  place.push({ name: 'industrial_s2', x: x0 + s2.w / 2 - SEAM, z: zRow, ry: 0 });
  for (let i = 0; i < bays; i++) place.push({ name: 'industrial_s1', x: x0 + s2.w + s1.w * (i + 0.5), z: zRow, ry: 0 });
  place.push({ name: 'industrial_s2', x: x0 + s2.w + bays * s1.w + s2.w / 2 + SEAM, z: zRow, ry: Math.PI });

  /* Row 2, if the plot is deep enough: an open gantry row. Never butted to the
     sheds -- S3 has no walls, so a shed beside it would stand open. */
  const s3 = SIZE.industrial_s3;
  const zGantry = zRow - s1.d / 2 - 14 - s3.d / 2;
  if (zGantry - s3.d / 2 > -hd + MARGIN) {
    const gBays = Math.max(1, Math.min(3, Math.floor(usableW / s3.w) - 1));
    const gW = gBays * s3.w, gx = -gW / 2 + (rnd() - 0.5) * (usableW - gW) * 0.6;
    for (let i = 0; i < gBays; i++) place.push({ name: 'industrial_s3', x: gx + s3.w * (i + 0.5), z: zGantry, ry: 0 });
  }

  // silos at a front corner: the only thing here over 12 m, so they carry the skyline
  const side = rnd() < 0.5 ? -1 : 1;
  place.push({ name: 'industrial_s4', x: side * (hw - MARGIN - SIZE.industrial_s4.w / 2), z: -hd + MARGIN + SIZE.industrial_s4.d / 2 + rnd() * 8, ry: rnd() * 6.28 });

  // clutter across the open yard, scattered rather than gridded
  const c = SIZE.industrial_s5;
  const slots = Math.max(2, Math.min(5, Math.floor(usableW / 34)));
  for (let i = 0; i < slots; i++) {
    const x = -usableW / 2 + usableW * ((i + 0.5) / slots) + (rnd() - 0.5) * 12;
    const z = -hd + MARGIN + c.d / 2 + rnd() * Math.max(1, (D - s1.d - MARGIN * 3) * 0.5);
    if (Math.abs(x - place[place.length - 1].x) < 16 && Math.abs(z - place[place.length - 1].z) < 16) continue;
    place.push({ name: 'industrial_s5', x, z, ry: rnd() * 6.28 });
  }

  // stamp every placement into per-key geometry lists
  const parts = [];
  const M = new THREE.Matrix4(), R = new THREE.Matrix4();
  for (const p of place) {
    const mod = mods.get(p.name);
    if (!mod) continue;
    M.makeRotationY(p.ry); M.setPosition(p.x, 0, p.z);
    for (const [mat, geos] of mod) {
      for (const g of geos) { const c2 = g.clone(); c2.applyMatrix4(M); parts.push({ mat, geo: c2 }); }
    }
  }
  return parts.length ? { parts, height: 12 } : null;
}
