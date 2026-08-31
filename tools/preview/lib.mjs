/**
 * Shared loading + lighting for the kit previews.
 *
 * The manifest is the contract: bounds and triangle counts come from it, so
 * placement can be decided before anything downloads. Nothing here awaits a
 * GLB to find out how big it is — that is the rule districtWorld has to follow
 * too, because chunk building is synchronous.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadMaterials, applyMaterials } from './materials.mjs';

// the ingest step Meshopt-compresses every asset, so the loader needs the
// decoder or nothing in public/models/ will parse
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

let materials = null;

export async function loadManifest(base = '/models', { textures = '/textures' } = {}) {
  const [m, lib] = await Promise.all([
    (await fetch(`${base}/manifest.json`)).json(),
    textures ? loadMaterials(textures) : null,
  ]);
  materials = lib;
  return { base, ...m };
}

/** Load once, clone per placement. Never load the same asset twice. */
export async function asset(manifest, key) {
  if (!cache.has(key)) {
    const entry = manifest.assets[key];
    if (!entry) throw new Error(`no such asset: ${key}`);
    const url = manifest.base + entry.url.replace(/^\/models/, '');
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (materials) applyMaterials(root, materials);
    cache.set(key, root);
  }
  const root = cache.get(key);
  // Object3D.clone() copies a SkinnedMesh but not its skeleton binding, so every
  // clone ends up driven by the original's bones — they all stack at the origin.
  // SkeletonUtils.clone rebuilds the bone graph per instance.
  let skinned = false;
  root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
  return skinned ? cloneSkinned(root) : root.clone(true);
}

/** Ask the manifest, not the mesh. */
export const bounds = (manifest, key) => manifest.assets[key].bounds;
export const size = (manifest, key) => {
  const b = manifest.assets[key].bounds;
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
};

/** Everything tagged with all of `tags`. This is how placement rules query. */
export function byTags(manifest, ...tags) {
  return Object.entries(manifest.assets)
    .filter(([, a]) => tags.every((t) => a.tags.includes(t)))
    .map(([k]) => k);
}

export function place(parent, obj, { x = 0, y = 0, z = 0, ry = 0, s = 1 } = {}) {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  if (s !== 1) obj.scale.setScalar(s);
  parent.add(obj);
  return obj;
}

export function makeRenderer(w, h) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/** Overcast day. The honest light: it hides nothing. */
let _env = null;
/** PMREM baking is expensive; bake once per renderer and share it. */
export function environment(renderer) {
  if (!_env) _env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  return _env;
}

export function lightScene(scene, renderer, { span = 40, night = false, shadowMap = 2048 } = {}) {
  scene.environment = environment(renderer);
  scene.environmentIntensity = night ? 0.16 : 0.9;
  scene.background = new THREE.Color(night ? 0x0d1016 : 0x93a3b4);
  scene.fog = new THREE.Fog(night ? 0x0d1016 : 0x93a3b4, span * 1.4, span * 5);

  const sun = new THREE.DirectionalLight(night ? 0x9fb6d8 : 0xfff1dc, night ? 0.5 : 2.6);
  sun.position.set(span * 0.5, span * 0.9, span * 0.42);
  sun.castShadow = true;
  const d = span * 1.1;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: span * 4 });
  sun.shadow.mapSize.set(shadowMap, shadowMap);
  sun.shadow.bias = -0.0006;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(night ? 0x24303f : 0xc4d6e6, night ? 0x14100c : 0x5a5348, night ? 0.7 : 2.0));
  return sun;
}

/** 1.78 m stand-in. Scale is the first thing to get wrong and the last to notice. */
export function human(colour = 0xd8642f) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.12, 0.26), mat);
  body.position.y = 1.02;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), mat);
  head.position.y = 1.71;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.9, 0.24), mat);
  legs.position.y = 0.45;
  for (const m of [body, head, legs]) { m.castShadow = true; g.add(m); }
  return g;
}

export function ground(size, colour = 0x6d7076) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}
