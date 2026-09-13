/**
 * Arun's ten authored trees (public/models/vegetation/tree_*.glb) replacing the
 * procedural cylinders-and-icospheres in props.js:buildSpecies.
 *
 * Each GLB is exactly two primitives -- `bark` and `foliage`, the real library
 * material names -- which is precisely the { trunk, canopy } shape
 * districtWorld already instances, so nothing downstream changes: same two
 * InstancedMeshes per species per chunk, same materials, same per-instance
 * colour, no new draws.
 *
 * The foliage COLOUR is read off each model and handed back with it. The
 * instancing path tints every canopy from a table of six greens, which is right
 * for a plane tree and wrong for a cherry; carrying the model's own colour
 * through that same per-instance tint keeps sakura pink and the maple red
 * without adding a material or a draw.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = '/models/vegetation/';
/* file stem -> the species key props.js/districtWorld already use. Anything not
   listed keeps its procedural build, so the set can grow one tree at a time. */
export const TREE_FILES = {
  plane: 'tree_plane', pine: 'tree_pine', palm: 'tree_palm', sakura: 'tree_sakura',
  ginkgo: 'tree_ginkgo', willow: 'tree_willow', red_maple: 'tree_red_maple',
  autumn_oak: 'tree_autumn_oak', cypress: 'tree_cypress', magnolia: 'tree_magnolia',
};

/**
 * Overwrite `assets.geo.species[k]` with the authored model wherever one
 * exists. Awaited at boot (main.js) rather than landing later, because trees
 * are on every street -- a late swap would leave half the city procedural.
 * A species whose file is missing or malformed keeps its procedural geometry.
 */
export async function loadTreeModels(assets) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const one = (stem) => new Promise((res) => {
    loader.load(`${BASE}${stem}.glb`, (g) => res(g), undefined, () => res(null));
  });
  const done = [];
  await Promise.all(Object.entries(TREE_FILES).map(async ([key, stem]) => {
    const gltf = await one(stem);
    if (!gltf) return;
    const built = split(gltf);
    if (!built) return;
    const prev = assets.geo.species?.[key];
    if (!assets.geo.species) return;
    assets.geo.species[key] = { ...prev, ...built, authored: true };
    done.push(key);
  }));
  if (done.length) console.info(`trees: ${done.length}/${Object.keys(TREE_FILES).length} authored (${done.sort().join(', ')})`);
  return done;
}

/** A loaded glTF -> { trunk, canopy, leaf } by material name. */
function split(gltf) {
  const bark = [], foliage = [];
  let leaf = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const src = o.geometry;
    /* mergeGeometries needs one attribute set across its inputs, and the
       instanced path wants nothing but these three. */
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
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const name = (m?.name || '').toLowerCase();
    if (/bark|trunk|wood/.test(name)) bark.push(g);
    else { foliage.push(g); if (!leaf && m?.color) leaf = m.color.getHex(); }
  });
  if (!bark.length && !foliage.length) return null;
  const trunk = bark.length ? mergeGeometries(bark, false) : null;
  const canopy = foliage.length ? mergeGeometries(foliage, false) : null;
  for (const g of [...bark, ...foliage]) g.dispose();
  if (!trunk || !canopy) return null;
  return { trunk, canopy, leaf: leaf ?? 0x3d5a32 };
}
