import * as THREE from 'three';

/**
 * Recycled InstancedMeshes for the chunk streamer (2026-11-11).
 *
 * three r185 keys its compiled node state by the InstancedMesh's UUID
 * (RenderObject.getMaterialCacheKey: "isInstancedMesh -> cacheKey +=
 * object.uuid"), because the built state holds that mesh's own instance
 * buffers. So every NEW InstancedMesh pays a full TSL node build the first
 * time it is drawn, whatever its material and geometry -- and a streamed
 * chunk is ~28 of them. After the shared-instancing fix no program is linked
 * at a chunk border any more, but the node builds were still 2.2 s of the
 * 3.3 s the three new chunks cost (CPU profile, tools/perf/drive-bench.mjs,
 * software GL).
 *
 * The render objects three keeps for a mesh survive its removal from the
 * scene, and are reused when the SAME object is drawn again. So a released
 * chunk's meshes are parked here instead of disposed, and the next chunk
 * that needs the same geometry + material takes one, rewrites its matrices
 * and draws with everything already built. Capacity is rounded up so that
 * "eight parked sedans" can serve "eleven parked sedans".
 *
 * Only for meshes whose geometry is SHARED (assets.geo.*): an owned,
 * per-chunk geometry carries per-instance attributes of its own.
 */
const capacityFor = (n) => (n <= 16 ? 16 : 2 ** Math.ceil(Math.log2(n)));
/* Which parked mesh to hand out: one that fits, and among those the WARMEST --
   a mesh that has been drawn (`main`) has its render object, one that has
   cast a shadow (`cast`) has the shadow pass's too; a mesh that sat hidden in
   its last chunk (the near parked cars of a ring-2 chunk, say) is no better
   than a new one. Then the smallest capacity. */
const warmth = (p) => (p.cast ? 2 : 0) + (p.main ? 1 : 0);
function pick(list, n) {
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const p = list[i].userData.pooled;
    if (p.cap < n) continue;
    if (best < 0) { best = i; continue; }
    const q = list[best].userData.pooled, d = warmth(p) - warmth(q);
    if (d > 0 || (d === 0 && p.cap < q.cap)) best = i;
  }
  return best;
}

export class InstPool {
  constructor({ perKey = 8, total = 480 } = {}) {
    this.perKey = perKey;
    this.total = total;
    this.free = new Map();      // key -> [mesh]
    this.size = 0;
    this.stats = { made: 0, reused: 0, warm: 0, kept: 0, dropped: 0 };
  }

  /** An InstancedMesh drawing `n` instances: recycled when one fits, new otherwise. The caller writes all n matrices (and colours). */
  take(geo, mat, n, shadow = false, colour = false) {
    const key = `${geo.id}|${mat.id}|${shadow ? 1 : 0}|${colour ? 1 : 0}`;
    const list = this.free.get(key);
    let m = null;
    if (list) {
      const best = pick(list, n);
      if (best >= 0) { m = list[best]; list.splice(best, 1); this.size--; this.stats.reused++; if (m.userData.pooled.main) this.stats.warm++; }
    }
    if (!m) {
      const cap = capacityFor(n);
      m = new THREE.InstancedMesh(geo, mat, cap);
      m.userData.pooled = { key, cap };
      this.stats.made++;
    }
    m.count = n;
    m.boundingSphere = null; m.boundingBox = null;
    return m;
  }

  /**
   * The same, for a mesh that needs per-instance attributes of its own (atlas
   * cell, tint, uv scale): the geometry is a clone made by `makeGeo()` that
   * travels with the mesh, with one InstancedBufferAttribute per entry of
   * `attrs` ({ name: itemSize }) sized to the capacity. The caller fills the
   * first n items of each (`fill`) -- every one, a recycled array holds the
   * last chunk's data.
   */
  takeOwned(kind, makeGeo, mat, n, attrs) {
    const key = `own|${kind}|${mat.id}`;
    const list = this.free.get(key);
    let m = null;
    if (list) {
      const best = pick(list, n);
      if (best >= 0) { m = list[best]; list.splice(best, 1); this.size--; this.stats.reused++; if (m.userData.pooled.main) this.stats.warm++; }
    }
    if (!m) {
      const cap = capacityFor(n), geo = makeGeo();
      geo.userData.owned = true;       // disposed with the mesh when the pool lets it go
      for (const name of Object.keys(attrs)) geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(cap * attrs[name]), attrs[name]));
      m = new THREE.InstancedMesh(geo, mat, cap);
      m.userData.pooled = { key, cap };
      this.stats.made++;
    }
    m.count = n;
    m.boundingSphere = null; m.boundingBox = null;
    return m;
  }

  /** Write `data` into a pooled mesh's own instanced attribute. */
  static fill(mesh, name, data) {
    const a = mesh.geometry.attributes[name];
    a.array.set(data.length > a.array.length ? data.subarray(0, a.array.length) : data);
    a.needsUpdate = true;
  }

  /** A released chunk hands a mesh back. Returns false when it is not ours or the pool is full: the caller disposes it. */
  give(m, seen = false) {
    const p = m.userData?.pooled;
    /* `seen`: its chunk was drawn at some point. A mesh that was visible then
       has been through the main pass, a caster through the shadow pass.
       (The parked LOD sets, whose visibility and casting change with the
       ring, are marked by the streamer as it switches them.) */
    if (m.userData?.coldMask !== undefined) { m.layers.mask = m.userData.coldMask; seen = false; }   // still waiting to be let in (districtWorld #warmCold): never drawn
    if (p && seen) { if (m.visible) p.main = true; if (m.castShadow) p.cast = true; }
    if (!p || this.size >= this.total) { if (p) this.stats.dropped++; return false; }
    let list = this.free.get(p.key);
    if (!list) this.free.set(p.key, list = []);
    if (list.length >= this.perKey) { this.stats.dropped++; return false; }
    m.userData = { pooled: p };
    m.name = '';
    m.visible = true;
    m.renderOrder = 0;
    m.frustumCulled = true;
    m.castShadow = false; m.receiveShadow = false;
    m.layers.set(0);
    list.push(m);
    this.size++;
    this.stats.kept++;
    return true;
  }

  dispose() {
    for (const list of this.free.values()) for (const m of list) m.dispose();
    this.free.clear();
    this.size = 0;
  }
}
