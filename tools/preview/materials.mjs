/**
 * The shared material library.
 *
 * Assets ship with material NAMES, not textures. The library is loaded once and
 * bound by name at load time, so 91 assets share 27 materials: one texture set
 * in memory, and far fewer state changes than embedding textures per asset
 * would give. districtWorld should do exactly this.
 *
 * Tiling lives here and nowhere else. Mesh UVs are in metres, and each material
 * declares how many metres one texture tile covers, so `repeat = 1 / tile`.
 * Nothing else in the codebase sets a repeat.
 */
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let cache = null;

// loadAsync, not load: a texture that has not arrived yet still binds to the
// material, and a material with an empty map and metalness 1 renders black
async function tex(url, { srgb = false, tile = 1, aniso = 8 }) {
  const t = await loader.loadAsync(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.anisotropy = aniso;
  return t;
}

export async function loadMaterials(base = '/textures', { anisotropy = 8 } = {}) {
  if (cache) return cache;
  const lib = await (await fetch(`${base}/library.json`)).json();
  const out = {};

  // library.json stores canonical /textures/... paths; rebase onto wherever the
  // library is actually being served from
  const url = (p) => base + p.replace(/^\/textures/, '');

  await Promise.all(Object.entries(lib.materials).map(async ([name, m]) => {
    const [map, normalMap, orm] = await Promise.all([
      tex(url(m.albedo), { srgb: true, tile: m.tile, aniso: anisotropy }),
      tex(url(m.normal), { tile: m.tile, aniso: anisotropy }),
      // one ORM texture serves three slots: R occlusion, G roughness, B metalness
      tex(url(m.orm), { tile: m.tile, aniso: anisotropy }),
    ]);
    orm.channel = 0;   // AO would otherwise want a second UV set

    out[name] = new THREE.MeshStandardMaterial({
      name,
      map, normalMap,
      aoMap: orm, roughnessMap: orm, metalnessMap: orm,
      roughness: 1, metalness: 1,        // scalars multiply the ORM channels
      normalScale: new THREE.Vector2(m.normalScale, m.normalScale),
      vertexColors: true,                // COLOR_0 carries the baked object AO
      envMapIntensity: 1.0,
    });

    // metalness null means "read the ORM blue channel"; a number overrides it
    if (m.metalness !== null && m.metalness !== undefined) {
      out[name].metalness = m.metalness;
      out[name].metalnessMap = null;
    }
    if (name.startsWith('glass') || name === 'car_glass') {
      out[name].envMapIntensity = 2.2;   // glazing lives on what it reflects
    }
  }));
  cache = out;
  return out;
}

/**
 * Swap every mesh's placeholder material for the library one of the same name.
 * A material with no library entry keeps whatever the GLB shipped, so an
 * unlibraried name degrades to flat colour rather than vanishing.
 */
export function applyMaterials(root, lib) {
  const missing = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name;
    if (lib[name]) o.material = lib[name];
    else if (name) missing.add(name);
  });
  if (missing.size) console.warn('no library material for:', [...missing].join(', '));
  return root;
}
