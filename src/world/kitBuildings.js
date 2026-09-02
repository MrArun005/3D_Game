import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Whole buildings from Kenney's City Kits (CC0): suburban houses, commercial
 * blocks and skyscrapers, industrial sheds. Where the district calls for
 * them, a footprint gets one of these -- scaled per axis onto the footprint,
 * height kept in proportion -- instead of the box massing, and the facade
 * modules, signs and roof clutter stay off it (it has its own). One merged
 * mesh per kit per chunk, drawn with the kit's palette texture.
 *
 * Kenney models are ~1 unit wide; a 13 m house is a x10 scale, which reads
 * fine at street level because the kit's detail is all silhouette.
 */
const BASE = '/models/vendor/kenney/';
const KITS = {
  suburban:   { files: 'abcdefghijklmnopqrstu'.split('').map((c) => `building-type-${c}`) },
  commercial: { files: [...'abcdefghijklmn'].map((c) => `building-${c}`), tall: [...'abcde'].map((c) => `building-skyscraper-${c}`) },
  industrial: { files: [...'abcdefghijklmnopqrst'].map((c) => `building-${c}`) },
};
/** Which kit a district builds with, and how many of its footprints (0..1). */
export const KIT_DISTRICT = {
  NORTHLINE: ['suburban', 0.75], 'GREENFELL PARK': ['suburban', 0.8], 'MARROW HILL': ['suburban', 0.6],
  STEELGATE: ['industrial', 0.65], 'HARBOUR POINT': ['industrial', 0.55],
  'OLD QUARTER': ['commercial', 0.45], 'VELLERY ROW': ['commercial', 0.5], ASHMOOR: ['commercial', 0.4],
  KINGSWAY: ['commercial', 0.35], 'THE FLATS': ['commercial', 0.3],
};

const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

function bake(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const parts = []; let map = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!map && o.material?.map) map = o.material.map;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const keep = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) if (g.attributes[k]) keep.setAttribute(k, g.attributes[k]);
    if (g.index) keep.setIndex(g.index);
    parts.push(keep.index ? keep.toNonIndexed() : keep);
  });
  const geo = mergeGeometries(parts, false);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  // base at y=0, centred on the footprint
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  return { geo, w: s.x, h: s.y, d: s.z, map };
}

export async function loadKitBuildings(assets) {
  const out = {};
  for (const [kit, def] of Object.entries(KITS)) {
    const files = [...def.files, ...(def.tall || [])];
    const results = await Promise.all(files.map((f) => load(`${BASE}${kit}/${f}.glb`).then(bake).catch((e) => { console.warn('kit building', kit, f, e.message); return null; })));
    const models = results.filter(Boolean);
    if (!models.length) continue;
    const map = models.find((m) => m.map)?.map;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
    const mat = new THREE.MeshStandardMaterial({ map: map || null, color: map ? 0xffffff : 0xb8b4aa, roughness: 0.7, metalness: 0.05 });
    mat.name = `kit_${kit}`;
    out[kit] = { models: models.map((m, i) => ({ ...m, tall: i >= def.files.length })), mat };
  }
  assets.kitBuildings = out;
  console.info(`kit buildings: ${Object.entries(out).map(([k, v]) => `${k} ${v.models.length}`).join(', ')}`);
  return out;
}

/** Pick a model for a footprint: tall ones for tower blocks, otherwise the closest aspect ratio. */
export function pickKitModel(kit, w, d, wantTall, r) {
  const pool = kit.models.filter((m) => !!m.tall === wantTall);
  const list = pool.length ? pool : kit.models;
  const aspect = w / d;
  const scored = list.map((m) => ({ m, s: Math.abs(Math.log((m.w / m.d) / aspect)) }))
    .sort((a, b) => a.s - b.s).slice(0, Math.max(1, Math.min(4, list.length)));
  return scored[Math.floor(r * scored.length)].m;
}
