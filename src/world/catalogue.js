import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { anisotropyOf } from './textures.js';

/**
 * The asset catalogue.
 *
 * 91 ingested models and 32 procedural PBR materials were sitting in
 * public/ with nothing in src/ referencing them -- `grep -rn manifest src/`
 * returned nothing. This is the file that makes them real.
 *
 * Two rules shape the whole design:
 *
 * 1. Materials bind BY NAME, once, at boot. The glTFs ship with placeholder
 *    materials; we throw those away and look the real one up from the library
 *    by the name the manifest records. 91 assets share 32 materials, so the
 *    city ends up with 32 material objects rather than several hundred.
 *
 * 2. Geometry is flattened to world-of-the-asset space and split by material.
 *    A prop's glTF may be several nodes deep with its own transforms; an
 *    InstancedMesh takes exactly one geometry, so each asset becomes a list of
 *    (geometry, materialName) parts with the node transforms already baked in.
 *    Placement then instances the parts, not the tree.
 */

const MANIFEST = '/models/manifest.json';
const LIBRARY = '/textures/library.json';

/**
 * ORM is one image doing three jobs: occlusion in R, roughness in G,
 * metalness in B. three reads exactly those channels from aoMap/roughnessMap/
 * metalnessMap, so the same texture is assigned to all three and the GPU
 * samples it once.
 */
function ormMaps(mat, tex) {
  mat.aoMap = tex;
  mat.roughnessMap = tex;
  mat.metalnessMap = tex;
  /* aoMap defaults to the second UV set, which none of these assets have --
     without this the ambient occlusion samples garbage or drops out entirely. */
  tex.channel = 0;
}

export class Catalogue {
  constructor() {
    this.materials = new Map();     // name -> THREE.Material
    this.assets = new Map();        // 'props/bench' -> { lods: [...], bounds, tags }
    this.byTag = new Map();         // 'kerb' -> ['props/bench', ...]
    this.ready = false;
  }

  /** Fetch both indexes and build every material. Models load lazily after. */
  async load(renderer) {
    const [manifest, library] = await Promise.all([
      fetch(MANIFEST).then((r) => r.json()),
      fetch(LIBRARY).then((r) => r.json()),
    ]);
    this.manifest = manifest;
    const aniso = anisotropyOf(renderer);
    const loader = new THREE.TextureLoader();

    const tex = (url, srgb) => {
      const t = loader.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    };

    for (const [name, def] of Object.entries(library.materials)) {
      const m = new THREE.MeshStandardMaterial({ name });
      m.map = tex(def.albedo, true);
      if (def.normal) {
        m.normalMap = tex(def.normal, false);
        m.normalScale = new THREE.Vector2(def.normalScale ?? 1, def.normalScale ?? 1);
      }
      if (def.orm) ormMaps(m, tex(def.orm, false));
      if (def.metalness !== null && def.metalness !== undefined) m.metalness = def.metalness;
      if (def.tile && def.tile !== 1) {
        for (const t of [m.map, m.normalMap, m.roughnessMap]) {
          if (t) t.repeat.set(def.tile, def.tile);
        }
      }
      /* Glazing is the one family that cannot be a plain opaque standard
         material -- a shopfront you cannot see into reads as a painted panel. */
      if (name.startsWith('glass')) {
        m.transparent = true;
        m.opacity = 0.42;
        m.roughness = 0.08;
        m.metalness = 0.1;
        m.envMapIntensity = 2.2;
      }
      this.materials.set(name, m);
    }

    for (const [name, def] of Object.entries(manifest.assets)) {
      this.assets.set(name, { ...def, lods: null, def });
      for (const t of def.tags || []) {
        if (!this.byTag.has(t)) this.byTag.set(t, []);
        this.byTag.get(t).push(name);
      }
    }
    this.ready = true;
    return this;
  }

  /** Asset names carrying a tag, in manifest order so placement is stable. */
  tagged(tag) { return this.byTag.get(tag) ?? []; }

  /**
   * Load one asset's LOD chain and flatten it to instanceable parts.
   *
   * Returns `[lod0, lod1, lod2]`, each `[{ geometry, material, tris }]`. The
   * glTF's own materials are discarded: the manifest says which library
   * materials the asset uses, and the primitive's material NAME is the key.
   */
  async fetchAsset(name) {
    const rec = this.assets.get(name);
    if (!rec) return null;
    if (rec.lods) return rec.lods;
    if (rec.loading) return rec.loading;

    const urls = [rec.def.url, ...(rec.def.lods || [])];
    rec.loading = Promise.all(urls.map((u) => this.#loadOne(u, rec)))
      .then((lods) => {
        rec.lods = lods;
        rec.loading = null;
        return lods;
      })
      .catch((e) => {
        console.warn(`asset ${name} failed:`, e.message);
        rec.lods = [[]];
        rec.loading = null;
        return rec.lods;
      });
    return rec.loading;
  }

  #loadOne(url, rec) {
    return new Promise((res, rej) => {
      LOADER.load(url, (gltf) => {
        const parts = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          /* Bake the node transform into the geometry. The alternative is a
             per-part offset matrix multiplied into every instance, which is
             the same maths done thousands more times. */
          const g = deQuantize(o.geometry.clone());
          g.applyMatrix4(o.matrixWorld);
          /* NOT marked `owned`. Catalogue geometry is shared by every chunk
             that instances the asset, and districtWorld's release sweep
             disposes anything flagged owned -- so flagging these would free
             the bench buffer the moment one chunk unloaded and leave every
             other chunk drawing from a dead VBO. */
          const matName = this.#materialFor(o, rec);
          parts.push({
            geometry: g,
            material: this.materials.get(matName) ?? FALLBACK,
            materialName: matName,
            tris: (g.index ? g.index.count : g.attributes.position.count) / 3,
          });
        });
        res(parts);
      }, undefined, rej);
    });
  }

  /**
   * Which library material a primitive wants.
   *
   * The ingest writes the library name onto the glTF material, so that is the
   * first choice. When a placeholder slipped through we fall back to the
   * asset's first declared material rather than dropping to untextured grey.
   */
  #materialFor(mesh, rec) {
    const n = mesh.material?.name;
    if (n && this.materials.has(n)) return n;
    const declared = rec.def.materials || [];
    for (const d of declared) if (this.materials.has(d)) return d;
    return 'concrete_cast';
  }

  /** Total triangles an asset contributes at a given LOD. */
  trisOf(name, lod = 0) {
    const rec = this.assets.get(name);
    return rec?.def?.tris?.[`lod${lod}`] ?? 0;
  }

  /** Footprint radius, for spacing props without overlapping them. */
  radiusOf(name) {
    const b = this.assets.get(name)?.def?.bounds;
    if (!b) return 0.5;
    return Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[2] - b.min[2])) / 2;
  }

  heightOf(name) {
    const b = this.assets.get(name)?.def?.bounds;
    return b ? b.max[1] - b.min[1] : 1;
  }
}

/* tools/ingest.mjs compresses every asset with EXT_meshopt_compression, so
   the loader cannot read a single one of them without the decoder -- it fails
   per-file with "setMeshoptDecoder must be called before loading compressed
   files", which is a warning rather than a crash and therefore very easy to
   ship. */

/**
 * Undo vertex quantization.
 *
 * tools/ingest.mjs runs KHR_mesh_quantization, so positions arrive as
 * NORMALIZED int16 in [-1,1] and the real world scale is carried on the node
 * transform. Two things then go wrong if you treat them as ordinary floats:
 *
 *   - `applyMatrix4` writes float results straight back into the Int16Array,
 *     so every coordinate truncates to -1, 0 or 1;
 *   - `mergeGeometries` cannot mix normalized and plain attributes.
 *
 * The symptom is unforgettable: 837 props per chunk, all collapsed into one
 * 2-metre cube at the world origin. `getX/getY/getZ` denormalize on the way
 * out, so reading through them into a Float32Array is the whole fix.
 */
function deQuantize(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    if (a.array instanceof Float32Array && !a.normalized) continue;
    const out = new Float32Array(a.count * a.itemSize);
    const get = [
      (i) => a.getX(i), (i) => a.getY(i), (i) => a.getZ(i), (i) => a.getW(i),
    ];
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = get[c](i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return geo;
}

const LOADER = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const FALLBACK = new THREE.MeshStandardMaterial({ color: 0x8d8d90, roughness: 0.9 });

/**
 * Instance accumulator for one chunk.
 *
 * Placement pushes matrices under an asset name; `emit` then turns each
 * (asset, material) pair into one InstancedMesh. Bucketing by material as well
 * as asset is what keeps the draw count near the per-chunk budget: a bench
 * that is timber and steel is two draws no matter how many benches there are.
 */
export class InstanceBatch {
  constructor(catalogue) {
    this.cat = catalogue;
    this.buckets = new Map();       // assetName -> Matrix4[]
  }

  add(name, matrix) {
    if (!name) return;
    let list = this.buckets.get(name);
    if (!list) this.buckets.set(name, (list = []));
    list.push(matrix);
  }

  get count() { return this.buckets.size; }

  /**
   * Build the meshes into `group`. Asynchronous because an asset may not have
   * been fetched yet -- chunks therefore populate a frame or two after they
   * appear, which is invisible next to the streaming itself and much better
   * than blocking the build on a network round trip.
   */
  async emit(group, { shadow = true, lod = 0 } = {}) {
    const jobs = [];
    /* Bucket by MATERIAL, not by asset.
       One InstancedMesh per (asset, material) is the obvious shape and it cost
       54 draw calls per chunk against a budget of 40 -- 2063 draws city-wide,
       because variety is the whole point of a prop kit and every new asset was
       another draw. Merging every prop that shares a material into one
       geometry makes the draw count depend on the MATERIAL count (17) instead
       of the asset count (69), so the kit can grow for free. */
    const byMaterial = new Map();
    for (const [name, list] of this.buckets) {
      jobs.push(this.cat.fetchAsset(name).then((lods) => {
        const parts = lods[Math.min(lod, lods.length - 1)] || [];
        for (const p of parts) {
          let b = byMaterial.get(p.material);
          if (!b) byMaterial.set(p.material, (b = []));
          for (const mm of list) b.push({ geo: p.geometry, matrix: mm });
        }
      }));
    }
    await Promise.all(jobs);

    for (const [material, items] of byMaterial) {
      const geos = [];
      for (const it of items) {
        /* Non-indexed throughout: mergeGeometries refuses a mix of indexed and
           non-indexed inputs, and the kit is authored both ways. These are
           84-160 triangle props, so the duplication is cheap next to the
           1400 draw calls it buys back. */
        const g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
        g.applyMatrix4(it.matrix);
        for (const attr of Object.keys(g.attributes)) {
          if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') {
            g.deleteAttribute(attr);
          }
        }
        if (!g.attributes.uv) {
          // rule 4: every mesh gets UVs, even if this one has nothing to say
          const n = g.attributes.position.count;
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        }
        if (!g.attributes.normal) g.computeVertexNormals();
        geos.push(g);
      }
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.userData.owned = true;     // built for this chunk, dies with it
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.userData.fromCatalogue = true;
      group.add(mesh);
    }
    return group;
  }
}
