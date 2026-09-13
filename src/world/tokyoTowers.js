/**
 * Arun's four authored neon towers (public/models/buildings/tokyo_neon_tower*.glb),
 * baked into the SAME vertex format world/tokyo.js uses so they merge into the
 * chunk's existing Tokyo mesh and cost ZERO extra draw calls.
 *
 * Each GLB is 996-1680 triangles over 13 materials, seven of them emissive
 * (neon cyan/magenta/yellow/red, konbini green/orange/white, interior warm),
 * UVs on every primitive, origin at the base and centred in XZ -- the project
 * convention, so they need no re-seating. There are no textures at all, so the
 * only thing a material carries is its colour and its emissive, and both fit
 * in the `color` / `emit` attributes tokyoMaterial already reads. That is why
 * these can be merged rather than drawn as their own meshes: 13 materials a
 * building would otherwise be 13 draws per building.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';

const BASE = '/models/buildings/';
const FILES = ['tokyo_neon_tower', 'tokyo_neon_tower_b', 'tokyo_neon_tower_c', 'tokyo_neon_tower_d'];

/* Neon has to BLOOM, a lit room does not. tokyo.js runs its tubes at k 2.4-2.5
   and its windows at 0.16; the same split by material name keeps these towers
   sitting in the same light as the buildings either side of them. */
const emitGain = (name) => (/neon|konbini/i.test(name) ? 2.4 : /interior|warm/i.test(name) ? 0.55 : 1.0);

let CACHE = null;

/** The four towers, baked. Resolves to [] if they are missing -- callers fall back. */
export function loadTokyoTowers() {
  if (CACHE) return CACHE;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  CACHE = Promise.all(FILES.map((f) => new Promise((res) => {
    loader.load(`${BASE}${f}.glb`, (g) => res(bake(g, f)), undefined, (e) => {
      console.warn('tokyo tower', f, e?.message ?? e);
      res(null);
    });
  }))).then((a) => a.filter(Boolean));
  return CACHE;
}

/** One GLB -> { geo, w, d, h } in the tokyo.js vertex format, origin at the base. */
function bake(gltf, name) {
  const rnd = mulberry32(0x7e57 ^ name.length);
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const src = o.geometry;
    /* A merge needs every input to carry the SAME attribute set, so the glTF's
       extras (tangents, its own COLOR_0, skinning) are dropped and only the
       three tokyoMaterial wants are written. */
    const geo = new THREE.BufferGeometry();
    geo.setIndex(src.index ? src.index.clone() : null);
    geo.setAttribute('position', src.attributes.position.clone());
    geo.setAttribute('normal', src.attributes.normal
      ? src.attributes.normal.clone()
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 3), 3));
    geo.setAttribute('uv', src.attributes.uv
      ? src.attributes.uv.clone()
      : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
    geo.applyMatrix4(o.matrixWorld);

    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const col = m?.color ?? new THREE.Color(0x888888);
    const em = m?.emissive ?? new THREE.Color(0x000000);
    const k = emitGain(m?.name ?? '') * (m?.emissiveIntensity ?? 1);
    const lit = em.r + em.g + em.b > 0.01;
    // one glowing part in seven buzzes, the same tell tokyo.js gives its tubes
    const flick = lit && rnd() < 0.15 ? 0.5 + rnd() * 6 : 0;

    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3), e = new Float32Array(n * 3), f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
      e[i * 3] = em.r * k; e[i * 3 + 1] = em.g * k; e[i * 3 + 2] = em.b * k;
      f[i] = flick;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('emit', new THREE.BufferAttribute(e, 3));
    geo.setAttribute('flick', new THREE.BufferAttribute(f, 1));
    parts.push(geo);
  });
  if (!parts.length) return null;
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!geo) return null;
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  // re-seat to base-centre in case an export ever drifts from the convention
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  return { name, geo, w: s.x, d: s.z, h: s.y };
}

/**
 * A tower sized to a footprint, or null if none is a reasonable fit.
 * `hw`/`hd` are the footprint half-sizes and `h` the planner's height.
 * Picks the tower whose natural proportions are closest so the neon is
 * stretched as little as possible, then refuses anything past 1.6x/0.5x --
 * past that the signage smears and it reads worse than a built one.
 */
export function towerFor(towers, seed, hw, hd, h) {
  if (!towers || !towers.length) return null;
  const want = { w: hw * 2, d: hd * 2, h: Math.max(8, h) };
  let best = null, bestCost = Infinity;
  for (const t of towers) {
    const sx = want.w / t.w, sz = want.d / t.d, sy = want.h / t.h;
    const cost = Math.abs(Math.log(sx)) + Math.abs(Math.log(sz)) + Math.abs(Math.log(sy)) * 0.6;
    if (cost < bestCost) { bestCost = cost; best = { t, sx, sy, sz }; }
  }
  if (!best) return null;
  const { sx, sy, sz } = best;
  const bad = (s) => s > 1.6 || s < 0.5;
  if (bad(sx) || bad(sz) || sy > 1.9 || sy < 0.45) return null;
  const geo = best.t.geo.clone();
  geo.scale(sx, sy, sz);
  return { geo, height: best.t.h * sy, name: best.t.name };
}
