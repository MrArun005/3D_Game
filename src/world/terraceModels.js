/**
 * Arun's six authored terraces, placed on the row plots of the three districts
 * whose own brief the procedural styles never matched.
 *
 * artBuildings.js records the mismatch: MARROW HILL asks for "terraces climbing
 * the hill, GABLE ends" and ASHMOOR for "inter-war semis, cream render, red
 * tile", but both were served by brickRow -- a flat-parapet Victorian terrace --
 * which is why their share sat at 0.03-0.04 instead of the 0.30-0.35 their
 * districts want. These models are that language, and at 308-636 triangles
 * against brickRow's 1,207 mean they are cheap enough to actually raise it.
 *
 * They ride the EXISTING art pipeline rather than the Tokyo one: each glTF
 * primitive is mapped onto an artKit material key and handed back in the same
 * { parts: [{ mat, geo }] } shape buildArt returns, so districtWorld merges
 * them per key per chunk exactly as it merges a brickRow. That means real
 * library textures (brick_red, plaster_worn) and no extra draw calls.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = '/models/buildings/';

/* district -> the models that belong to it. The plot sizes these were built to
   are measured in docs/ASSET-BRIEF.md; a model is only offered to its own
   district, so Ashmoor render never appears on a Marrow Hill hill terrace. */
export const TERRACES = {
  'MARROW HILL': ['terrace_m1', 'terrace_m2'],
  ASHMOOR: ['terrace_a1', 'terrace_a2'],
  'VELLERY ROW': ['terrace_v1', 'terrace_v2'],
};

/* glTF material name -> artKit material key (artKit.MAT_KEYS). The library
   texture carries the colour -- brick_red IS red, plaster_worn IS cream -- so
   the vertex colour stays white and does not tint it twice. */
const KEY = [
  [/^brick/, 'brick'],
  [/^plaster|render/, 'plaster'],
  [/^stone|concrete/, 'concrete'],
  [/^timber|wood/, 'timber'],
  [/^glass/, 'glass'],
  [/^metal|alloy|chrome/, 'metal'],
];
const keyFor = (n) => (KEY.find(([re]) => re.test(n || ''))?.[1]) ?? 'concrete';

let CACHE = null;

/** Load every terrace once. Resolves to a Map name -> { parts, w, d, h }. */
export function loadTerraces() {
  if (CACHE) return CACHE;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const names = [...new Set(Object.values(TERRACES).flat())];
  CACHE = Promise.all(names.map((n) => new Promise((res) => {
    loader.load(`${BASE}${n}.glb`, (g) => res([n, bake(g)]), undefined, () => res([n, null]));
  }))).then((pairs) => {
    const out = new Map();
    for (const [n, v] of pairs) if (v) out.set(n, v);
    if (out.size) console.info(`terraces: ${out.size}/${names.length} loaded`);
    return out;
  });
  return CACHE;
}

/** One glTF -> parts grouped by artKit key, in artKit's vertex format. */
function bake(gltf) {
  const byKey = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    g.setIndex(src.index ? src.index.clone() : null);
    g.setAttribute('position', src.attributes.position.clone());
    g.setAttribute('normal', src.attributes.normal
      ? src.attributes.normal.clone()
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 3), 3));
    g.setAttribute('uv', src.attributes.uv
      ? src.attributes.uv.clone()
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    /* artMaterial's meshes are vertexColors, and a brickRow passes near-white
       unless it means a tint. These do not: the library texture is the colour. */
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('emit', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('flick', new THREE.BufferAttribute(new Float32Array(n), 1));
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const k = keyFor((m?.name || '').toLowerCase());
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(g);
  });
  if (!byKey.size) return null;
  const parts = [];
  const box = new THREE.Box3();
  for (const [mat, geos] of byKey) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    geo.computeBoundingBox();
    box.union(geo.boundingBox);
    parts.push({ mat, geo });
  }
  if (!parts.length) return null;
  const s = box.getSize(new THREE.Vector3());
  return { parts, w: s.x, d: s.z, h: s.y };
}

/**
 * A terrace for this plot, or null. Same contract as towerFor: every model
 * inside tolerance is ranked by fit and the seed picks among the closest, so a
 * street is not one house repeated. Terraces are party-wall rows, so the WIDTH
 * is held near 1:1 -- stretching a terrace sideways is what makes a row read
 * as wallpaper -- while the depth and height may give.
 */
export function terraceFor(models, district, seed, hw, hd, h) {
  const names = TERRACES[district];
  if (!models || !names) return null;
  const want = { w: hw * 2, d: hd * 2, h: Math.max(5, h) };
  const fits = [];
  for (const n of names) {
    const t = models.get(n);
    if (!t) continue;
    const sx = want.w / t.w, sz = want.d / t.d, sy = want.h / t.h;
    if (sx > 1.18 || sx < 0.85) continue;          // the frontage is the party-wall pitch: hold it
    if (sz > 1.6 || sz < 0.55 || sy > 1.5 || sy < 0.6) continue;
    fits.push({ t, sx, sy, sz, cost: Math.abs(Math.log(sz)) + Math.abs(Math.log(sy)) * 0.8 });
  }
  if (!fits.length) return null;
  fits.sort((a, b) => a.cost - b.cost);
  const pick = fits[Math.floor(Math.abs(Math.sin(seed * 91.7) * 43758.5453) % 1 * fits.length) % fits.length];
  const { t, sx, sy, sz } = pick;
  const parts = t.parts.map(({ mat, geo }) => {
    const g = geo.clone();
    g.scale(sx, sy, sz);
    return { mat, geo: g };
  });
  return { parts, height: t.h * sy };
}
