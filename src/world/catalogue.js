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
    /* City-wide batching (2026-09-02). One BatchedMesh per (material, casts
       shadow) for the WHOLE city, instead of one merged mesh per material per
       chunk. Profiled before: ~800 dressing/facade meshes in the scene, 160MB
       of per-chunk vertex copies, 11.6ms of CPU per frame in the render call.
       A BatchedMesh stores each kit part once and draws every instance of a
       material in one call, culled per instance. attach(scene) turns it on;
       without it emit() falls back to the per-chunk merge. */
    this.batchRoot = null;
    this.batches = new Map();       // key -> { mesh, geoIds: Map(part -> geometryId) }
  }

  /** Enable city-wide batching: the root group lives in the scene for good. */
  attach(scene) {
    if (this.batchRoot) return;
    this.batchRoot = new THREE.Group();
    this.batchRoot.name = 'catalogueBatches';
    scene.add(this.batchRoot);
  }

  /** The batch for a material, created on first use and grown on demand. */
  batchFor(material, shadow) {
    const key = material.uuid + (shadow ? ':s' : ':n');
    let b = this.batches.get(key);
    if (b) return b;
    const mesh = new THREE.BatchedMesh(2048, 65536, 131072, material);
    mesh.name = `batch:${material.name}${shadow ? '' : ':noshadow'}`;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.sortObjects = false;          // opaque kit: the sort buys nothing and costs a frame's worth of CPU at scale
    mesh.perObjectFrustumCulled = true;
    mesh.frustumCulled = false;        // the whole-batch sphere would span the city; per-instance culling does the work
    this.batchRoot.add(mesh);
    b = { mesh, geoIds: new Map(), maxInst: 2048, maxVerts: 65536 };
    this.batches.set(key, b);
    return b;
  }

  /** Geometry id of a kit part inside a batch, registering it on first use. */
  geometryIdFor(b, part) {
    let id = b.geoIds.get(part);
    if (id !== undefined) return id;
    const g = batchReady(part);
    for (let attempt = 0; attempt < 8; attempt++) {
      try { id = b.mesh.addGeometry(g); break; } catch (e) {
        // out of vertex room or geometry slots: double and retry
        b.maxVerts *= 2; b.mesh.setGeometrySize(b.maxVerts, b.maxVerts * 2);
        b.maxInst *= 2; b.mesh.setInstanceCount(b.maxInst);
      }
    }
    b.geoIds.set(part, id);
    return id;
  }

  /** One placement; returns its instance id. */
  addBatched(b, geoId, matrix) {
    let id;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { id = b.mesh.addInstance(geoId); break; } catch (e) {
        b.maxInst *= 2; b.mesh.setInstanceCount(b.maxInst);
      }
    }
    b.mesh.setMatrixAt(id, matrix);
    return id;
  }

  setBatchedVisible(list, visible) {
    for (const { batch, id } of list) batch.setVisibleAt(id, visible);
  }

  releaseBatched(list) {
    for (const { batch, id } of list) { try { batch.deleteInstance(id); } catch (e) { /* already gone */ } }
    list.length = 0;
  }

  /** Fetch both indexes and build every material. Models load lazily after. */
  async load(renderer) {
    const [manifest, library] = await Promise.all([
      fetch(MANIFEST).then((r) => r.json()),
      fetch(LIBRARY).then((r) => r.json()),
    ]);
    this.manifest = manifest;
    /* City-wide BatchedMesh only pays where the device can multi-draw. On a
       WebGPU device without chromium-experimental-multi-draw-indirect three
       issues ONE draw per instance -- measured 2026-09-02: 8,938 draws and
       17.9ms of render CPU against 1,090 / 11.6ms for the per-chunk merge.
       So the batch path stays dormant until the feature exists. */
    this.multiDraw = !!(renderer.hasFeature?.('chromium-experimental-multi-draw-indirect')
      || (renderer.backend?.isWebGLBackend && renderer.hasFeature?.('WEBGL_multi_draw')));
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
          /* Rule 4, for real. Every one of the 201 shipped parts arrived with
             NO TEXCOORD_0, so the merge step's zero-fill put every texel of
             every PBR material on one point: brick, glass and timber never
             actually showed. Box-projection in METRES -- each vertex takes the
             two axes perpendicular to its normal's dominant axis -- so the
             library's per-metre tiling reads at true size and a 3.6m bay gets
             3.6m of brick. Baked positions, so it is done once per asset. */
          if (!g.attributes.uv) boxProjectUv(g);
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


/** Planar UVs from position, chosen per vertex by the dominant normal axis. */
function boxProjectUv(g) {
  const pos = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; }          // top/bottom faces
    else if (nx >= nz) { u = z; v = y; }                 // faces looking down x
    else { u = x; v = y; }                               // faces looking down z
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const MISSING = new Set();

/**
 * A kit part in the one layout every BatchedMesh geometry must share:
 * non-indexed, position/normal/uv only. Cached on the part, since the same
 * geometry is instanced by every chunk.
 */
function batchReady(part) {
  if (part.batchGeo) return part.batchGeo;
  const src = part.geometry;
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const attr of Object.keys(g.attributes)) {
    if (attr !== 'position' && attr !== 'normal' && attr !== 'uv') g.deleteAttribute(attr);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.computeBoundingSphere();
  part.batchGeo = g;
  return g;
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
    /* Optional break-tracking (world/breakables.js). Set `trackNames` to
       anything with .has(name) before emit() and every placement of those
       assets records WHERE its triangles landed in the merged buffers —
       {name, matrix, ranges:[{mesh, start, count}]} — so a broken prop can be
       zeroed out of the merge instead of costing its own draw call. */
    this.trackNames = null;
    this.tracked = [];
  }

  add(name, matrix) {
    if (!name) return;
    let list = this.buckets.get(name);
    if (!list) this.buckets.set(name, (list = []));
    list.push(matrix);
  }

  #trackRec(name, matrix) {
    let rec = this.tracked.find((r) => r.matrix === matrix);
    if (!rec) this.tracked.push(rec = { name, matrix, ranges: [], instances: [] });
    return rec;
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
        /* A name the manifest no longer knows must cost ONE prop, not the
           whole chunk. Re-running the ingest renamed two blockouts and every
           chunk's dressing threw on the first missing asset -- 21 warnings,
           draw count down by two thirds, and nothing on the pavements. */
        if (!lods) {
          if (!MISSING.has(name)) { MISSING.add(name); console.warn(`catalogue: no asset named ${name}`); }
          return;
        }
        const parts = lods[Math.min(lod, lods.length - 1)] || [];
        for (const p of parts) {
          let b = byMaterial.get(p.material);
          if (!b) byMaterial.set(p.material, (b = []));
          for (const mm of list) b.push({ geo: p.geometry, part: p, matrix: mm, name });
        }
      }));
    }
    await Promise.all(jobs);

    /* City-wide batches (Catalogue.attach): every placement becomes an
       instance in its material's BatchedMesh, and the chunk group only
       remembers the ids so it can hide or delete them. No merge, no per-chunk
       vertex copies, one draw per material for the whole city. */
    if (this.cat.batchRoot) {
      const list = group.userData.batched ?? (group.userData.batched = []);
      for (const [material, items] of byMaterial) {
        const b = this.cat.batchFor(material, shadow);
        for (const it of items) {
          const geoId = this.cat.geometryIdFor(b, it.part);
          const id = this.cat.addBatched(b, geoId, it.matrix);
          list.push({ batch: b.mesh, id });
          if (this.trackNames?.has(it.name)) this.#trackRec(it.name, it.matrix).instances.push({ batch: b.mesh, id });
        }
      }
      // a hidden group (ring LOD) hides its instances too
      if (!group.visible) this.cat.setBatchedVisible(list, false);
      return group;
    }

    /* One material's merge per macrotask. The merges used to run as a single
       microtask continuation — the whole kit's mergeGeometries in one gulp,
       a hitch the chunk-build budget never even saw because it lives on the
       promise side of the fence. */
    const nextTask = () => new Promise((r) => setTimeout(r, 0));
    for (const [material, items] of byMaterial) {
      await nextTask();
      const geos = [];
      const pending = [];               // break-tracking: ranges awaiting the mesh
      let offset = 0;
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
        const count = g.attributes.position.count;
        if (this.trackNames?.has(it.name)) {
          pending.push({ rec: this.#trackRec(it.name, it.matrix), start: offset, count });
        }
        offset += count;
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
      /* The chunk is a render bundle (districtWorld): meshes inside it are
         never culled per object, and a mesh landing after the recording
         has to trigger a new one. */
      mesh.frustumCulled = false;
      for (let p = group; p; p = p.parent) if (p.isBundleGroup) { p.needsUpdate = true; break; }
      for (const p of pending) p.rec.ranges.push({ mesh, start: p.start, count: p.count });
    }
    return group;
  }
}

/**
 * Put the material library's surface detail on the hero car.
 *
 * Only worth doing now that core/geometry.js:loft() emits a real cylindrical
 * unwrap -- against the old all-zero UV attribute every one of these maps
 * would have sampled a single texel and done nothing at all.
 *
 * COLOUR is deliberately not taken from the library. The paint tint is
 * per-car and the damage model drives roughness, metalness and soot through
 * the same material every frame; what the library adds is the surface
 * underneath that -- orange peel in the clearcoat, tread on the rubber.
 * A map multiplies the scalar rather than replacing it, so the damage model
 * keeps working untouched.
 */
export function dressCarMaterials(cat, mats) {
  if (!cat?.materials?.size || !mats) return 0;
  const pairs = [
    [mats.paint, 'car_paint'],
    [mats.rubber, 'tyre_rubber'],
    [mats.chrome, 'chrome_trim'],
    [mats.alloy, 'alloy_polished'],
    [mats.glass, 'car_glass'],
    [mats.skin, 'skin'],
    [mats.shirt, 'cloth_shirt'],
  ];
  let n = 0;
  for (const [target, name] of pairs) {
    const src = cat.materials.get(name);
    if (!target || !src) continue;
    if (src.normalMap) {
      target.normalMap = src.normalMap;
      target.normalScale = src.normalScale?.clone?.() ?? target.normalScale;
    }
    if (src.roughnessMap) {
      target.roughnessMap = src.roughnessMap;
      /* aoMap needs a second UV set unless told otherwise, and the hull has
         exactly one. The texture's own channel was already set to 0 when the
         library was built, so this just opts the car into the same map. */
      target.aoMap = src.aoMap ?? src.roughnessMap;
      target.metalnessMap = src.metalnessMap ?? src.roughnessMap;
    }
    target.needsUpdate = true;
    n++;
  }
  return n;
}
