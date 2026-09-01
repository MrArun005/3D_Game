import * as THREE from 'three';
import { InstanceBatch } from './catalogue.js';
import { dressChunk, dressRoofs, dressFacades, place as placeAsset } from './dressing.js';
import { KERB_H, roadDepth } from './metrics.js';
import { ARCH, TOWER, MID, LOFT, PODIUM, DECK } from './facades.js';
import { mulberry32 } from '../core/rng.js';
import { PAINT_COLOURS, BODY_KEYS } from '../vehicle/config.js';
import { signalState, LAMP_COLOURS } from './signals.js';
import { BREAK_CLASS } from './breakables.js';
import { ZEBRA_DEPTH } from '../game/traffic.js';

/**
 * Halstead Bay in three dimensions.
 *
 * The planner exports centrelines and footprints; the volume is built here.
 * Streaming works in 256m chunks: a chunk owns the road quads whose segments
 * fall inside it and the blocks whose centre does, so nothing is built twice
 * and a chunk can be thrown away without consulting its neighbours.
 */
const CHUNK = 256;
const BUILD_MS = 4;      // docs/BUDGETS.md: chunk build must not hitch a frame
const ck = (ix, iz) => `${ix},${iz}`;

/* The file carries footprints, not heights — the 2D planner has no opinion on
   how tall anything is. Heights are derived here, deterministically from the
   footprint's own position, so every load agrees without storing 2,598 numbers. */
const HEIGHT = {
  tower: [34, 78], mid: [16, 30], row: [8, 13],
  yard: [7, 11], lot: [0, 0], park: [0, 0], vacant: [0, 0],
};
/* Downtown towers should tower. The block type says what KIND of thing stands
   here; the district says how hard the land is working. */
const DISTRICT_SCALE = {
  KINGSWAY: 1.7, NORTHLINE: 0.8, STEELGATE: 0.9, 'HARBOUR POINT': 0.85,
  'OLD QUARTER': 0.8, 'VELLERY ROW': 1.0, ASHMOOR: 0.85,
  'MARROW HILL': 0.8, 'THE FLATS': 0.95, 'GREENFELL PARK': 0.6,
};
const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};
const ARCHETYPE = { tower: TOWER, mid: MID, row: LOFT, yard: DECK, lot: PODIUM };
/* Foliage is never one green. These multiply the leaf material, so they read
   as the same planting in different light rather than as five paint pots. */
const LEAF = [0xa8c48a, 0x8fae74, 0xc2cf92, 0x7f9e6c, 0xb6c88d, 0x9dbb85];

export class DistrictWorld {
  constructor(scene, assets, district, opts = {}) {
    this.scene = scene;
    this.assets = assets;
    this.district = district;
    this.chunks = new Map();
    // solid parked cars, kept per chunk so collision only ever asks about the
    // ones nearby. The old City had this; the district world shipped without
    // it, which is why kerbside cars went back to being scenery you drive
    // through.
    this.parkedByChunk = new Map();
    /* Signal heads, per chunk. The traffic has been obeying lights at every
       cross and tee since it moved onto the graph -- there was simply nothing
       to see, so a queue of stopped cars looked like a jam rather than a red. */
    this.signalsByChunk = new Map();
    /* Real building footprints, per chunk. Collision used to be "anything
       more than a pavement's width past the kerb is a wall", which was true
       of the 130m procedural grid and true of nothing in Halstead Bay: its
       roads run 14m to 44m wide and its blocks are set back irregularly, so
       that rule put invisible walls across car parks and left half the
       facades passable. */
    this.solidsByChunk = new Map();
    this.poolsByChunk = new Map();
    this.queue = [];          // chunks waiting to be built
    this.pending = new Set(); // ...and their keys, so we never queue twice
    this.primed = false;
    /* The authored asset catalogue. Optional on purpose: if the manifest or
       the texture library fails to load, the city falls back to the procedural
       props it shipped with rather than appearing empty. */
    this.catalogue = opts.catalogue ?? null;
    this.propGroups = new Map();
    this.facadeGroups = new Map();
    this.parkedLod = new Map();
    this.propRadius = 2;
    this.nodeById = new Map(district.graph.nodes.map((n) => [n.id, n]));
    this.radius = 2;   // 5x5 x 256m ~= 1.2km of full-detail street

    this.#buildFarCity(opts.day);

    // bucket road segments and blocks into chunks once
    this.segByChunk = new Map();
    district.segments.forEach((s, i) => {
      const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
      const k = ck(Math.floor(mx / CHUNK), Math.floor(mz / CHUNK));
      (this.segByChunk.get(k) ?? this.segByChunk.set(k, []).get(k)).push(i);
    });
    /* Kerbs and markings are built from graph EDGES, not road segments: an
       edge runs junction to junction, so it knows where to stop painting. A
       segment is just a polyline vertex pair and has no idea a crossroads is
       halfway along it. */
    this.edgeByChunk = new Map();
    district.graph.edges.forEach((e, i) => {
      const p = e.points[Math.floor(e.points.length / 2)];
      const k = ck(Math.floor(p[0] / CHUNK), Math.floor(p[1] / CHUNK));
      (this.edgeByChunk.get(k) ?? this.edgeByChunk.set(k, []).get(k)).push(i);
    });

    this.blkByChunk = new Map();
    district.blocks.forEach((bl) => {
      const k = ck(Math.floor(bl.x / CHUNK), Math.floor(bl.y / CHUNK));
      (this.blkByChunk.get(k) ?? this.blkByChunk.set(k, []).get(k)).push(bl);
    });
  }

  /**
   * The whole 4200x3000m map as five draw calls.
   *
   * Clear daylight sees to the mountains, and a detail radius of 1.2km left
   * the city as an island on an empty plain with a hard edge that slid around
   * as chunks streamed. So every road and every building in the file is also
   * drawn once, cheaply, for the whole map. The detailed chunks sit on top:
   * the far copies are deliberately a little shorter and a little narrower so
   * they can never fight the real geometry for the same pixel.
   */
  #buildFarCity(day) {
    const D = this.district;
    const far = new THREE.Group();

    const pos = [];
    for (const s of D.segments) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * s.half, nz = (dx / L) * s.half;
      pos.push(
        s.ax + nx, 0, s.az + nz, s.bx + nx, 0, s.bz + nz, s.bx - nx, 0, s.bz - nz,
        s.ax + nx, 0, s.az + nz, s.bx - nx, 0, s.bz - nz, s.ax - nx, 0, s.az - nz,
      );
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    rg.setAttribute('normal', new THREE.BufferAttribute(
      new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const roads = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({
      color: day ? 0x4c5057 : 0x181d24,
    }));
    roads.position.y = -0.03;               // always loses to the real tarmac
    roads.frustumCulled = false;
    far.add(roads);

    const slabs = [], solids = [], cols = [];
    const c = new THREE.Color();
    const PAL = day ? [0xb0aca3, 0xa5a9ac, 0x9c968c, 0xbdb8ad, 0x8f949a]
                    : [0x2a3038, 0x252b33, 0x30363e, 0x222831, 0x2d333b];
    for (const bl of D.blocks) {
      slabs.push(mat4(bl.x, 0, bl.y, bl.angle, bl.w, KERB_H * 0.9, bl.h));
      const range = HEIGHT[bl.type];
      if (!range || !range[1]) continue;
      const scale = DISTRICT_SCALE[bl.district] ?? 1;
      const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
      for (const g of D.buildingsOf(bl.id)) {
        const h = (range[0] + hash(g.x + bl.x, g.y + bl.y) * (range[1] - range[0])) * scale;
        const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
        solids.push(mat4(bl.x + lx * ca - lz * sa, KERB_H,
                         bl.y + lx * sa + lz * ca, bl.angle,
                         Math.max(1, g.w - 0.3), Math.max(1, h - 0.4),
                         Math.max(1, g.d - 0.3)));
        cols.push(PAL[Math.floor(hash(lz, lx) * PAL.length)]);
      }
    }
    const box = this.assets.geo.box;
    const slabMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({
      color: day ? 0x9d9a90 : 0x1b2027,
    }), slabs.length);
    slabs.forEach((m, i) => slabMesh.setMatrixAt(i, m));
    slabMesh.instanceMatrix.needsUpdate = true;
    slabMesh.frustumCulled = false;
    far.add(slabMesh);

    const solidMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({
      color: 0xffffff,
    }), solids.length);
    /* Where detail exists the far copy has to get out of the way: a stand-in
       box is full width to the top, so it burst out of every setback and
       crown as a pale cube sitting on the real building. */
    this.farSolids = solids;
    this.farAt = solids.map((m) => [m.elements[12], m.elements[14]]);
    this.farMesh = solidMesh;
    this.farHidden = new Set();
    solids.forEach((m, i) => solidMesh.setMatrixAt(i, m));
    cols.forEach((hex, i) => solidMesh.setColorAt(i, c.setHex(hex)));
    solidMesh.instanceMatrix.needsUpdate = true;
    solidMesh.instanceColor.needsUpdate = true;
    // matrices are rewritten by #cullFar as you move, so the sphere would go
    // stale -- this one genuinely has to opt out
    solidMesh.frustumCulled = false;
    /* No shadows from the far stand-ins. With frustumCulled off, all 2,482 of
       them are submitted to the shadow pass every frame, and every one of
       them is outside the sun's 120m shadow frustum by construction. */
    solidMesh.castShadow = false;
    far.add(solidMesh);

    this.scene.add(far);
    this.far = far;
  }

  /** Zero-scale the far stand-ins that the detailed chunks now cover. */
  #cullFar(x, z) {
    const R = (this.radius + 0.5) * CHUNK;
    let dirty = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.farAt.length; i++) {
      const [px, pz] = this.farAt[i];
      const inside = Math.abs(px - x) < R && Math.abs(pz - z) < R;
      if (inside === this.farHidden.has(i)) continue;
      if (inside) { this.farHidden.add(i); this.farMesh.setMatrixAt(i, zero); }
      else { this.farHidden.delete(i); this.farMesh.setMatrixAt(i, this.farSolids[i]); }
      dirty = true;
    }
    if (dirty) this.farMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Stream, on a time budget.
   *
   * Building was fully synchronous: crossing a corner could construct five
   * 256m chunks inside one frame, and a chunk is roads, kerbs, markings,
   * pavements, facades, lamps, signals and parked cars. That is a visible
   * hitch exactly when you are moving fastest.
   *
   * Now chunks go on a queue sorted by distance and we spend at most
   * BUILD_MS per frame on it. The far-city LOD already covers anything not
   * yet built, so a chunk arriving a frame or two late is invisible; a 60 ms
   * frame is not.
   */
  update(x, z) {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    if (this.farAt && (this.lastCull === undefined
        || Math.abs(x - this.lastCull[0]) > 48 || Math.abs(z - this.lastCull[1]) > 48)) {
      this.#cullFar(x, z);
      this.lastCull = [x, z];
    }

    // what is missing, nearest first
    const want = [];
    for (let dx = -this.radius; dx <= this.radius; dx++) {
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        const k = ck(ix + dx, iz + dz);
        if (this.chunks.has(k) || this.pending.has(k)) continue;
        want.push({ k, cx: ix + dx, cz: iz + dz, d: dx * dx + dz * dz });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) { this.queue.push(w); this.pending.add(w.k); }

    /* The first frame has to be complete -- streaming the world in around a
       stationary player at the start looks like a bug, not like streaming.
       After that, a build is a GENERATOR pumped for at most BUILD_MS a frame:
       the queue kept five chunks from landing on one frame, but a single
       chunk was still 40-70ms of roads, massing, dressing and instancing in
       one gulp — a felt steering hitch at exactly the moment you cross a
       boundary at speed. The group only enters the scene when its generator
       finishes, so nobody ever sees half a chunk. */
    const wasPrimed = this.primed;
    const budget = wasPrimed ? BUILD_MS : Infinity;
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      if (!this.building) {
        const w = this.queue.shift();
        if (!w) break;
        // it may have gone out of range while it sat in the queue
        if (Math.abs(w.cx - ix) > this.radius || Math.abs(w.cz - iz) > this.radius) {
          this.pending.delete(w.k);
          continue;
        }
        // stays in `pending` until the build completes, or the rescan re-queues it
        this.building = {
          k: w.k, cx: w.cx, cz: w.cz,
          group: new THREE.Group(),
          gen: null,
        };
        this.building.gen = this.#buildSteps(w.cx, w.cz, this.building.group);
      }
      const b = this.building;
      if (b.gen.next().done) {
        this.chunks.set(b.k, b.group);
        this.pending.delete(b.k);
        this.building = null;
      }
    }
    // what the budget line in the stats HUD actually promises: the time THIS
    // frame spent building, not the total cost of a chunk. The boot-time
    // prime (budget Infinity, hidden behind the loading screen) is excluded.
    const slice = performance.now() - t0;
    if (wasPrimed && slice > 0.2 && this.onChunkBuilt) this.onChunkBuilt(slice);
    this.primed = true;
    /* An in-flight build whose chunk left the radius is abandoned: nothing of
       it is in the scene yet, but sections may have parked entries in the
       per-chunk registries and owned geometry in the group. */
    if (this.building) {
      const b = this.building;
      if (Math.abs(b.cx - ix) > this.radius || Math.abs(b.cz - iz) > this.radius) {
        b.group.traverse((o) => {
          if (!o.isMesh) return;
          if (o.isInstancedMesh) o.dispose();
          if (o.geometry?.userData?.owned) o.geometry.dispose();
        });
        for (const m of [this.propGroups, this.facadeGroups, this.parkedLod,
                         this.parkedByChunk, this.signalsByChunk,
                         this.solidsByChunk, this.poolsByChunk]) m.delete(b.k);
        this.pending.delete(b.k);
        this.building = null;
      }
    }

    /* Dressing is visible only in the near ring. Props are small, numerous and
       the single biggest contributor to the draw count; at 400m they are a few
       pixels each and cost exactly as much as they do at 10m. One boolean per
       chunk is the whole LOD system for them. */
    for (const [key, g] of this.propGroups) {
      const [a, b] = key.split(',').map(Number);
      const d = Math.max(Math.abs(a - ix), Math.abs(b - iz));
      g.visible = d <= this.propRadius;
      const fg = this.facadeGroups.get(key);
      if (fg) fg.visible = d <= 1;
      const pl = this.parkedLod.get(key);
      if (pl) {
        for (const m of pl.near) { m.visible = d <= 1; m.castShadow = d === 0; }
        for (const m of pl.far) m.visible = d > 1;
        /* Shadows from the chunk you are standing in, and nowhere else.
           389 near parked cars were casting 950k triangles into the cascades
           -- more than the entire authored prop kit -- to draw a row of
           smudges under cars a street away. */
      }
      /* Shadows only from the ring you are standing in.
         A shadow-casting mesh is drawn once per camera and once per cascade,
         so the 733k triangles of street furniture were costing 2.2M. You
         cannot see a bollard's shadow from the next chunk over, and the
         cascade that would contain it covers 460m at 4.5 texels/m -- the
         shadow is sub-pixel long before the prop is. */
      if (g.userData.shadowRing !== d) {
        g.userData.shadowRing = d;
        const cast = d === 0;
        for (const m of g.children) m.castShadow = cast;
      }
    }
    for (const [k, g] of [...this.chunks]) {
      const [a, b] = k.split(',').map(Number);
      if (Math.abs(a - ix) > this.radius || Math.abs(b - iz) > this.radius) {
        this.scene.remove(g);
        /* Only geometry this chunk built. The old sweep disposed shared
           assets.geo.* buffers that 24 other live chunks were still drawing
           from, forcing a silent GPU re-upload at every chunk boundary. */
        this.propGroups.delete(k);
        this.facadeGroups.delete(k);
        this.parkedLod.delete(k);
        g.traverse((o) => {
          if (!o.isMesh) return;
          if (o.isInstancedMesh) o.dispose();      // frees the instance buffers
          if (o.geometry?.userData?.owned) o.geometry.dispose();
        });
        this.chunks.delete(k);
        this.pending.delete(k);
        this.parkedByChunk.delete(k);
        this.signalsByChunk.delete(k);
        this.solidsByChunk.delete(k);
        this.poolsByChunk.delete(k);
        this.onBreakablesGone?.(k);
      }
    }
  }

  /**
   * One building, as a stack of volumes rather than a single extrusion: a
   * shopfront base, a shaft that may step back once or twice, a cornice
   * capping every step, and a crown on the towers. This is the difference
   * between a skyline and a bar chart.
   */
  #massing(arch, wx, wz, angle, w, d, h, out) {
    const A = this.assets;
    const rand = mulberry32(Math.floor(hash(wx, wz) * 2147483647) >>> 0);
    const spec = ARCH[arch];
    const BASE = A.baseHeight, SINK = 0.35;
    const variant = Math.floor(rand() * 3);

    // ground floor: shopfront, lobby or shutter, on its own material set
    const baseH = Math.min(h * 0.6, BASE + (rand() - 0.5) * 0.5);
    const bk = arch === PODIUM || arch === DECK ? 1 : rand() < 0.62 ? 0 : rand() < 0.7 ? 1 : 2;
    const bb = (out.bases[bk] ?? (out.bases[bk] = { m: [], uv: [] }));
    bb.m.push(mat4(wx, KERB_H, wz, angle, w + 0.12, baseH, d + 0.12));
    bb.uv.push((w + 0.12) / 9.0, baseH / BASE);

    const fb = out.facades[`${arch}|${variant}`]
      ?? (out.facades[`${arch}|${variant}`] = { m: [], uv: [] });
    const tileW = spec.wide, tileH = spec.floors * spec.storey;
    const y0 = KERB_H + baseH - SINK;
    const shaft = Math.max(2.5, h - (baseH - SINK));
    const glassTop = arch === TOWER || arch === MID;

    const stage = (y, hh, k) => {
      fb.m.push(mat4(wx, y, wz, angle, w * k, hh, d * k));
      fb.uv.push((w * k) / tileW, hh / tileH);
    };
    const cap = (y, hh, k, pad) =>
      (glassTop ? out.glassRoofs : out.roofs).push(
        mat4(wx, y, wz, angle, w * k + pad, hh, d * k + pad));

    let topK = 1;
    if (arch === TOWER && shaft > 48 && rand() < 0.75) {
      const a = shaft * 0.42, b = shaft * 0.32;
      const k1 = 0.84 + rand() * 0.06, k2 = 0.66 + rand() * 0.08;
      stage(y0, a, 1);
      stage(y0 + a - SINK, b, k1);
      stage(y0 + a + b - SINK * 2, shaft - a - b + SINK * 2, k2);
      cap(y0 + a - SINK, 0.5 + SINK, 1, 0.1);
      cap(y0 + a + b - SINK * 2, 0.5 + SINK, k1, 0.1);
      cap(KERB_H + h - SINK, 0.7 + SINK, k2, 0.1);
      topK = k2;
    } else if ((arch === TOWER || arch === MID) && shaft > 28 && rand() < 0.7) {
      const split = shaft * (0.58 + rand() * 0.14);
      const k = 0.78 + rand() * 0.08;
      stage(y0, split, 1);
      stage(y0 + split - SINK, shaft - split + SINK, k);
      cap(y0 + split - SINK, 0.5 + SINK, 1, 0.1);
      cap(KERB_H + h - SINK, 0.7 + SINK, k, 0.1);
      topK = k;
    } else {
      stage(y0, shaft, 1);
      cap(KERB_H + h - SINK, 0.7 + SINK, 1, 0.1);
    }

    if (arch === TOWER) {
      out.crowns.push(mat4(wx, KERB_H + h + 0.55, wz, angle,
        w * topK * 0.52, 1.4 + rand() * 1.6, d * topK * 0.52));
      if (rand() < 0.55) {
        out.masts.push(mat4(wx, KERB_H + h + 3.2 + rand() * 4, wz, 0,
          0.16, 8 + rand() * 14, 0.16));
      }
    } else if (w > 7 && rand() < 0.7) {
      // roof clutter reads at street level as soon as the building is short
      for (let i = 0, n = 1 + Math.floor(rand() * 2); i < n; i++) {
        const r = rand();
        out.plant[r < 0.6 ? 'ac' : r < 0.85 ? 'tank' : 'hut'].push(
          mat4(wx + (rand() - 0.5) * w * 0.5, KERB_H + h + 0.8,
               wz + (rand() - 0.5) * d * 0.5, rand() * 6.28, 1, 1, 1));
      }
    }
  }

  /**
   * Everything that makes a carriageway read as a street: lane markings at the
   * real lane pitch, a kerb face, and a pavement behind it. Built per graph
   * edge and trimmed back from both junctions, so nothing is ever painted
   * across a crossroads.
   */
  #streetFurniture(edgeIds, group) {
    const A = this.assets;
    const white = [], warm = [], kerb = [], kerbN = [], walk = [], walkUv = [], walkN = [];

    /* Normals are written by hand rather than computed.
       computeVertexNormals() takes them from winding, and a ribbon laid down
       the left kerb winds opposite to the same ribbon on the right -- so half
       of every pavement in the city came out facing into the ground, which
       under a Lambert material is simply black. */
    const D = this.district;
    // every ribbon rides the deck: `y` is an offset above the road, not an
    // absolute height, or the paint stays at sea level under a bridge
    const lift = (px, pz) => D.elevationAt(px, pz);
    const ribbon = (out, ax, az, bx, bz, w, y, nrm) => {
      const dx = bx - ax, dz = bz - az;
      const L = Math.hypot(dx, dz);
      if (L < 0.01) return;
      const nx = (-dz / L) * (w / 2), nz = (dx / L) * (w / 2);
      const ya = y + lift(ax, az), yb = y + lift(bx, bz);
      out.push(
        ax + nx, ya, az + nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz,
        ax + nx, ya, az + nz, bx - nx, yb, bz - nz, ax - nx, ya, az - nz,
      );
      if (nrm) for (let i = 0; i < 6; i++) nrm.push(0, 1, 0);
    };
    // a vertical face, for the kerb upstand; `ox,oz` is which way it looks
    const wall = (out, nrm, ax, az, bx, bz, y0, y1, ox, oz) => {
      const la = lift(ax, az), lb = lift(bx, bz);
      out.push(ax, y0 + la, az, bx, y0 + lb, bz, bx, y1 + lb, bz,
               ax, y0 + la, az, bx, y1 + lb, bz, ax, y1 + la, az);
      for (let i = 0; i < 6; i++) nrm.push(ox, 0, oz);
    };

    for (const ei of edgeIds) {
      const e = this.district.graph.edges[ei];
      if (e.class === 'freeway' || e.class === 'ramp') continue;
      const half = e.width / 2;
      /* The file says lanes:2 on a 34m carriageway, which would put the lane
         line 8.5m off the centre. Lane COUNT is a planning number; lane WIDTH
         is a physical one, so the markings are derived from the metres. */
      const lanes = Math.max(1, Math.round((half - 1.8) / 3.6));
      const laneW = (half - 1.0) / lanes;
      // enough to clear a junction, but not so much that a 40m block of street
      // gets no paint at all -- which is exactly what half+3 was doing
      const trim = Math.min(half, 11) + 2;

      // walk the polyline as one run so the trim applies to the whole edge
      const pts = e.points;
      let done = 0;
      const total = e.length || this.#polyLen(pts);
      if (total < trim * 2 + 4) continue;

      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        const segL = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / segL, uz = (bz - az) / segL;
        // clip this piece to the trimmed span [trim, total - trim]
        const s0 = Math.max(0, trim - done), s1 = Math.min(segL, total - trim - done);
        done += segL;
        if (s1 - s0 < 1) continue;
        const px0 = ax + ux * s0, pz0 = az + uz * s0;
        const px1 = ax + ux * s1, pz1 = az + uz * s1;
        const nx = -uz, nz = ux;
        const at = (o, t) => [ax + ux * t + nx * o, az + uz * t + nz * o];

        // centre line: double solid on anything wider than a lane each way
        if (lanes > 1 || e.width > 12) {
          for (const o of [-0.22, 0.22]) {
            ribbon(warm, px0 + nx * o, pz0 + nz * o, px1 + nx * o, pz1 + nz * o, 0.14, 0.02);
          }
        } else {
          for (let t = s0; t < s1; t += 9) {
            const [qx, qz] = at(0, t), [rx, rz] = at(0, Math.min(s1, t + 3));
            ribbon(white, qx, qz, rx, rz, 0.14, 0.02);
          }
        }

        // lane dividers: dashed, at the real lane pitch on both carriageways
        for (let k = 1; k < lanes; k++) {
          for (const side of [-1, 1]) {
            const o = side * laneW * k;
            for (let t = s0; t < s1; t += 9) {
              const [qx, qz] = at(o, t), [rx, rz] = at(o, Math.min(s1, t + 3));
              ribbon(white, qx, qz, rx, rz, 0.13, 0.02);
            }
          }
        }

        // edge line, then the kerb it runs alongside, then the pavement
        for (const side of [-1, 1]) {
          const o = side * (half - 0.45);
          ribbon(white, px0 + nx * o, pz0 + nz * o, px1 + nx * o, pz1 + nz * o, 0.15, 0.02);
          const kx = side * half;
          // the kerb face looks back at the road it edges
          wall(kerb, kerbN, px0 + nx * kx, pz0 + nz * kx, px1 + nx * kx, pz1 + nz * kx,
               0, KERB_H, -nx * side, -nz * side);
          const w = side * (half + 2.4);
          ribbon(walk, px0 + nx * w, pz0 + nz * w, px1 + nx * w, pz1 + nz * w, 4.8, KERB_H, walkN);
          // the slab texture is 2.4m; without UVs the pavement is flat colour
          const v = (s1 - s0) / 2.4, u = 4.8 / 2.4;
          walkUv.push(0, 0, v, 0, v, u, 0, 0, v, u, 0, u);
        }
      }
    }

    const emit = (arr, mat, nrm, uv, shadow) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry();
      g.userData.owned = true;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
      if (uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = !!shadow;
      group.add(m);
    };
    emit(white, A.mat.paint);              // basic material, normals unused
    emit(warm, A.mat.paintWarm);
    emit(kerb, A.mat.kerbFace, kerbN);
    emit(walk, A.mat.walkDistrict ?? A.mat.walk, walkN, walkUv, true);
  }

  /**
   * A signal head on every approach to every signalised junction, wired to the
   * same pure phase function the traffic reads. Lenses are one instanced mesh
   * per chunk whose colours are rewritten each frame.
   */
  #signals(edgeIds, group, key) {
    const A = this.assets;
    const posts = [], arms = [], lens = [], meta = [], zebra = [];
    const seen = new Set();
    const sigBatch = this.catalogue ? new InstanceBatch(this.catalogue) : null;
    const ly = (x, z) => this.district.elevationAt(x, z);

    /* Junction paint: stop lines and lane arrows.
       Kept here rather than in #streetFurniture because both are positioned
       from the APPROACH -- they need the junction node, the direction into it
       and the crossing depth, all of which this function already has and that
       one does not. */
    const jpaint = [];
    /* One triangle, laid flat, wound so it always faces UP.
       A.mat.paint is FrontSide, and the (forward, lateral) basis these shapes
       are built in is left-handed with respect to world XZ -- so the natural
       corner order emits a downward normal and the paint is invisible from
       above. Measured before fixing: 11,485 of 12,191 junction triangles faced
       down. Rather than hand-order the corners of every shape and get one of
       them wrong, the winding is corrected HERE, once, for every caller. It is
       the same trap `ribbon()` hit on the kerbs -- see the note in
       #streetFurniture about half the pavements coming out black. */
    const tri = (ax, az, bx, bz, cx, cz) => {
      // +Y component of (b-a) x (c-a) for points in the XZ plane
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (ny < 0) { const tx = bx, tz = bz; bx = cx; bz = cz; cx = tx; cz = tz; }
      jpaint.push(ax, 0.021 + ly(ax, az), az,
                  bx, 0.021 + ly(bx, bz), bz,
                  cx, 0.021 + ly(cx, cz), cz);
    };
    /* A rectangle from a centre, a forward unit vector and half-extents.
       `along` runs with the traffic, `across` is lateral. */
    const rect = (cx, cz, fx, fz, along, across) => {
      const lx = -fz, lz = fx;
      const p = (a, b) => [cx + fx * a + lx * b, cz + fz * a + lz * b];
      const [x0, z0] = p(-along, -across), [x1, z1] = p(along, -across);
      const [x2, z2] = p(along, across), [x3, z3] = p(-along, across);
      tri(x0, z0, x1, z1, x2, z2);
      tri(x0, z0, x2, z2, x3, z3);
    };
    /* A lane arrow pointing the way the traffic goes. `turn` bends the head:
       0 straight, -1 left, +1 right. */
    /* Sized like real road paint, not like a UI icon.
       The first pass used a 0.34m shaft and a 1.1m head, which is correct for
       an arrow you look at from two metres and invisible from the thirty
       metres a driver actually reads it at -- a few pixels, swamped by the
       lane dividers either side. A UK/US lane arrow is about 5m long and
       1.7m across the head, and at that size it reads from the stop line. */
    const arrow = (cx, cz, fx, fz, turn = 0) => {
      const lx = -fz, lz = fx;
      const p = (a, b) => [cx + fx * a + lx * b, cz + fz * a + lz * b];
      rect(cx + fx * -0.9, cz + fz * -0.9, fx, fz, 2.1, 0.28);
      if (turn === 0) {
        const [tx, tz] = p(2.6, 0);
        const [bx, bz] = p(0.9, -0.85), [dx2, dz2] = p(0.9, 0.85);
        tri(bx, bz, tx, tz, dx2, dz2);
      } else {
        // an elbow into the turn, then a head on the end of it
        rect(...p(1.2, turn * 0.85), lx * turn, lz * turn, 1.1, 0.28);
        const [tx, tz] = p(1.2, turn * 2.5);
        const [bx, bz] = p(2.05, turn * 1.15), [dx2, dz2] = p(0.35, turn * 1.15);
        tri(bx, bz, tx, tz, dx2, dz2);
      }
    };

    for (const ei of edgeIds) {
      const e = this.district.graph.edges[ei];
      if (e.class === 'freeway' || e.class === 'ramp') continue;
      for (const end of [e.a, e.b]) {
        const node = this.nodeById.get(end);   // 1789 nodes; a scan per approach is not free
        if (!node || (node.kind !== 'cross' && node.kind !== 'tee')) continue;
        const tag = `${ei}:${end}`;
        if (seen.has(tag)) continue;
        seen.add(tag);

        // approach direction: from the edge's far end back into this junction
        const pts = this.#oriented(e, node);
        if (!pts) continue;
        const ux = pts[0][0] - pts[1][0], uz = pts[0][1] - pts[1][1];
        const L = Math.hypot(ux, uz) || 1;
        const dx = ux / L, dz = uz / L;             // points INTO the junction
        const half = e.width / 2;
        const back = e.width / 2 + 1.2 + ZEBRA_DEPTH + 1.0;
        // mounted on the right of the approach, at the stop line
        // the mast stands level with the stop line, behind the crossing
        const px = node.x - dx * back + -dz * (half - 1.2);
        const pz = node.y - dz * back + dx * (half - 1.2);
        const yaw = Math.atan2(-dz, dx);

        /* A crossing on every signalled approach, and the mast beside it.
           Without one the cars pulled up nose-to-post at the signal itself,
           which is where the pole is, not where a car should stop. */
        for (let k = -half + 1.6; k <= half - 1.6; k += 1.45) {
          const bx = node.x - dx * (e.width / 2 + 1.2 + ZEBRA_DEPTH / 2) + -dz * k;
          const bz = node.y - dz * (e.width / 2 + 1.2 + ZEBRA_DEPTH / 2) + dx * k;
          zebra.push(flatRect(bx, 0.02, bz, yaw, ZEBRA_DEPTH, 0.62));
        }

        /* Stop line and lane arrows.
           Traffic keeps RIGHT here -- traffic.js:#laneOffset returns a positive
           offset "right of the centreline" and #shift applies it along
           (-dz, dx) -- so the approach lanes are the right half of the
           carriageway and the paint only covers that half. Painting the full
           width would put a stop line across the oncoming side. */
        /* 1.6m of clear tarmac between the crossing and the stop line. At the
           0.5m the first pass used, the line touched the zebra and read as one
           more stripe rather than as the place you stop. */
        const stopBack = half + 1.2 + ZEBRA_DEPTH + 1.6;
        const sx = node.x - dx * stopBack + -dz * (half / 2);
        const sz = node.y - dz * stopBack + dx * (half / 2);
        rect(sx, sz, dx, dz, 0.3, half / 2 - 0.3);

        /* Lane count from METRES, the same derivation the lane dividers use --
           the file's `lanes` field is a planning number and disagrees with the
           width on most edges. */
        const lanes = Math.max(1, Math.round((half - 1.8) / 3.6));
        const laneW = (half - 1.0) / lanes;
        for (let i = 0; i < lanes; i++) {
          const off = laneW * (i + 0.5);
          const ax2 = node.x - dx * (stopBack + 9) + -dz * off;
          const az2 = node.y - dz * (stopBack + 9) + dx * off;
          // kerbside lane turns right, the lane against the centre turns left
          const turn = lanes > 1 && i === lanes - 1 ? 1
                     : lanes > 2 && i === 0 ? -1 : 0;
          arrow(ax2, az2, dx, dz, turn);
        }

        const axis = Math.abs(dx) > Math.abs(dz) ? 0 : 1;
        if (sigBatch) {
          /* The authored mast, with the lenses this file already drives sitting
             on its head. Only the POSTS become an asset -- the lens cluster
             stays an InstancedMesh because updateSignals() rewrites its
             colours every frame from the same phase function the traffic
             reads, and an authored lamp cannot be recoloured per instance. */
          sigBatch.add('props/traffic_signal',
            placeAsset(px, KERB_H + ly(px, pz), pz, Math.atan2(-dx, -dz)));
          for (let k = 0; k < 3; k++) {
            lens.push(mat4(px + dx * 0.24, KERB_H + 3.82 - k * 0.32, pz + dz * 0.24,
              -yaw, 1, 1, 1));
          }
          // a gantry where the approach is wide enough to need one
          if (e.width > 26 && hash(node.x + ei, node.y) < 0.4) {
            sigBatch.add('props/sign_gantry', placeAsset(
              node.x - dx * (back + 3), KERB_H + ly(node.x, node.y), node.y - dz * (back + 3),
              Math.atan2(-dx, -dz)));
          }
        } else {
          posts.push(mat4(px, KERB_H, pz, -yaw, 0.11, 3.9, 0.11));
          arms.push(mat4(px + dx * 1.1, KERB_H + 3.75, pz + dz * 1.1, -yaw, 2.4, 0.1, 0.1));
          // backing box, so a lens reads as a lamp rather than a floating dot
          arms.push(mat4(px + dx * 2.24, KERB_H + 2.62, pz + dz * 2.24, -yaw, 0.1, 1.06, 0.34));
          for (let k = 0; k < 3; k++) {
            lens.push(mat4(px + dx * 2.1, KERB_H + 3.35 - k * 0.3, pz + dz * 2.1, -yaw, 1, 1, 1));
          }
        }
        meta.push({ node: node.id, axis, base: lens.length - 3 });
      }
    }

    if (!lens.length) return;
    const inst = (list, m2) => {
      /* Never build a zero-count InstancedMesh. With the catalogue loaded the
         authored mast replaces the box posts and arms, so both lists are
         EMPTY here -- and an InstancedMesh with count 0 owns a zero-byte
         instanceMatrix buffer that WebGPU refuses to bind:
           "Binding size for [Buffer ...UniformBuffer_N_(vertex)] is zero"
         once per mesh per frame, ~100 errors a second across the near
         chunks. The guard is the whole fix. */
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(A.geo.box, m2, list.length);
      list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };
    if (jpaint.length) {
      const pg = new THREE.BufferGeometry();
      pg.userData.owned = true;
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(jpaint), 3));
      pg.computeBoundingSphere();
      group.add(new THREE.Mesh(pg, A.mat.paint));
    }
    if (sigBatch) sigBatch.emit(group, { shadow: false })
      .catch((e) => console.warn('signals failed:', e.message));
    inst(posts, A.mat.pole);
    inst(arms, A.mat.pole);
    if (zebra.length) {
      const zm = new THREE.InstancedMesh(A.geo.plane, A.mat.paint, zebra.length);
      zebra.forEach((mm, i) => zm.setMatrixAt(i, mm));
      zm.instanceMatrix.needsUpdate = true;
      zm.computeBoundingSphere();
      group.add(zm);
    }

    const lensMesh = new THREE.InstancedMesh(
      A.geo.lens ?? new THREE.SphereGeometry(0.11, 8, 6),
      /* Basic, not Standard: instanceColor multiplies the DIFFUSE term, so an
         emissive-white Standard material renders every lens white no matter
         what colour the phase says it is. A lens is self-luminous anyway. */
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      lens.length,
    );
    lens.forEach((mm, i) => lensMesh.setMatrixAt(i, mm));
    lensMesh.instanceMatrix.needsUpdate = true;
    // only the colours change per frame; the transforms are fixed
    lensMesh.computeBoundingSphere();
    group.add(lensMesh);
    this.signalsByChunk.set(key, { mesh: lensMesh, meta });
  }

  /** Repaint every lens from the clock. Called once a frame from main. */
  updateSignals(t) {
    if (!this.signalsByChunk.size) return;
    const c = _colour;
    for (const { mesh, meta } of this.signalsByChunk.values()) {
      for (const m of meta) {
        const state = signalState(m.node, 0, m.axis, t);
        const cols = LAMP_COLOURS[state];
        for (let k = 0; k < 3; k++) mesh.setColorAt(m.base + k, c.setHex(cols[k]));
      }
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /** The edge polyline oriented so its FIRST point is the one nearest `node`. */
  #oriented(e, node) {
    const p = e.points;
    if (!p || p.length < 2) return null;
    const head = Math.hypot(p[0][0] - node.x, p[0][1] - node.y);
    const tail = Math.hypot(p[p.length - 1][0] - node.x, p[p.length - 1][1] - node.y);
    return head <= tail ? p : p.slice().reverse();
  }

  #polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  /**
   * One chunk, as a resumable sequence of steps. Every `yield` is a point
   * where update()'s budget pump may park the build until next frame; all
   * state lives in generator locals, and `group` stays out of the scene
   * until the final step, so a parked build is invisible rather than half
   * a street. Yield placement is load-bearing: between sections, and inside
   * the two per-item loops that dominate the cost (building massing,
   * per-segment furniture).
   */
  *#buildSteps(ix, iz, group) {
    const A = this.assets;
    const k = ck(ix, iz);

    /* --- carriageway: one quad per segment, all merged into one mesh ---
       Overlaps at junctions are coplanar and the same colour, so the depth
       fight they provoke is invisible — far cheaper than mitring every join. */
    const D = this.district;
    const segs = this.segByChunk.get(k) ?? [];
    if (segs.length) {
      const pos = [], nor = [], uv = [];
      for (const id of segs) {
        const s = this.district.segments[id];
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const L = Math.hypot(dx, dz) || 1;
        const nx = (-dz / L) * s.half, nz = (dx / L) * s.half;
        const q = [
          [s.ax + nx, s.az + nz], [s.bx + nx, s.bz + nz],
          [s.bx - nx, s.bz - nz], [s.ax - nx, s.az - nz],
        ];
        const tri = [q[0], q[1], q[2], q[0], q[2], q[3]];
        // sample the deck height per corner so a bridge is a ramp, not a decal
        for (const [px, pz] of tri) {
          pos.push(px, D.elevationAt(px, pz), pz);
          nor.push(0, 1, 0);
        }
        // the tile is 18.4m square; stretching one across a 34m carriageway is
        // what turned every arterial into a car park with faint stripes on it
        const v = L / 18.4, u = (s.half * 2) / 18.4;
        uv.push(0, 0, v, 0, v, u, 0, 0, v, u, 0, u);
      }
      const g = new THREE.BufferGeometry();
      g.userData.owned = true;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      const road = new THREE.Mesh(g, A.mat.tarmac);
      road.receiveShadow = true;
      group.add(road);
    }
    yield;

    /* --- blocks: a raised slab is its own kerb, and buildings stand on it --- */
    const blocks = this.blkByChunk.get(k) ?? [];
    const boxes = [];              // solid building footprints in this chunk
    const slabs = { block: [], park: [], lot: [], vacant: [] };
    const facades = {}, bases = {};
    const roofs = [], glassRoofs = [], crowns = [], masts = [];
    const plant = { ac: [], tank: [], hut: [] };
    const slabGeo = A.geo.box;

    let massed = 0;
    for (const bl of blocks) {
      const kind = bl.type === 'park' ? 'park'
                 : bl.type === 'lot' ? 'lot'
                 : bl.type === 'vacant' ? 'vacant' : 'block';
      slabs[kind].push(mat4(bl.x, 0, bl.y, bl.angle, bl.w, KERB_H, bl.h));

      const arch = ARCHETYPE[bl.type];
      if (!arch) continue;
      const range = HEIGHT[bl.type] || [10, 20];
      for (const g of this.district.buildingsOf(bl.id)) {
        if (++massed % 8 === 0) yield;
        const scale = DISTRICT_SCALE[bl.district] ?? 1;
        const h = (range[0] + hash(g.x + bl.x, g.y + bl.y) * (range[1] - range[0])) * scale;
        // local footprint -> world, through the block's own transform
        const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
        const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
        const wx = bl.x + lx * ca - lz * sa;
        const wz = bl.y + lx * sa + lz * ca;
        this.#massing(arch, wx, wz, bl.angle, g.w, g.d, h,
                      { bases, facades, roofs, glassRoofs, crowns, masts, plant });
        boxes.push({ x: wx, z: wz, angle: bl.angle, hw: g.w / 2, hd: g.d / 2, height: h });
      }
    }

    yield;
    this.#streetFurniture(this.edgeByChunk.get(k) ?? [], group);
    yield;
    this.#signals(this.edgeByChunk.get(k) ?? [], group, k);
    yield;

    /* Lamps every 30m down each segment, alternating sides. The old procedural
       city got all its night light from these; the district world shipped
       without a single one, which is why Halstead Bay looked like a dark plain
       rather than a lit street. */
    const lamps = [], heads = [], pools = [], solidParked = [];
    const parked = {}, parkedCol = {};       // keyed by silhouette
    const dressed = !!this.catalogue;
    // one bucket per species, so a street never plants the same tree twice over
    const trees = { plane: [], pine: [], poplar: [], palm: [] };
    const leafCol = { plane: [], pine: [], poplar: [], palm: [] };
    let seg = 0;
    for (const id of segs) {
      if (++seg % 10 === 0) yield;
      const s2 = this.district.segments[id];
      if (s2.cls === 'freeway' || s2.cls === 'ramp') continue;
      const dx = s2.bx - s2.ax, dz = s2.bz - s2.az;
      const L = Math.hypot(dx, dz);
      if (L < 24) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      const off = s2.half + 1.4;
      for (let t = 16, i = 0; t < L - 8; t += 38, i++) {
        const side = i % 2 ? 1 : -1;
        const px = s2.ax + ux * t + nx * off * side;
        const pz = s2.az + uz * t + nz * off * side;
        const yaw = Math.atan2(-nz * side, -nx * side);
        const ly = this.district.elevationAt(px, pz);
        /* With a catalogue loaded the authored lamp and its light pool come
           from dressing.js instead, placed by the same loop -- keeping both
           would stand a box lamp inside every real one. */
        if (dressed) continue;
        // same junction rule as dressing.js: never on anyone's tarmac
        if (this.district.tarmacDepth(px, pz) <= 0.2) continue;
        lamps.push(mat4(px, KERB_H + ly, pz, -yaw, 1, 1, 1));
        solidParked.push({ x: px, z: pz, yaw: 0, offsets: [0],
                           radius: 0.22, reach: 0.6, tag: 'prop' });
        heads.push(mat4(px, KERB_H + ly, pz, -yaw, 1, 1, 1));
        const hx = px + Math.cos(yaw) * 1.42, hz = pz - Math.sin(yaw) * 1.42;
        pools.push(flat(hx, 0.03 + ly, hz, 13));
        if (hash(px, pz) < 0.35) {
          /* Species follows the street it stands on: formal poplars down the
             arterials, plane trees on the side streets, palms on the water
             boundary, pines where the map has nothing much else. */
          const r = hash(pz * 1.7, px * 0.9);
          const sp = s2.cls === 'arterial' ? (r < 0.62 ? 'poplar' : 'plane')
                   : s2.cls === 'boundary' ? (r < 0.5 ? 'palm' : 'pine')
                   : r < 0.72 ? 'plane' : r < 0.88 ? 'poplar' : 'pine';
          const sc = 0.85 + hash(px, pz) * 0.45;
          const tx = px + nx * 2.2 * side, tz = pz + nz * 2.2 * side;
          trees[sp].push(mat4(tx, KERB_H, tz, hash(pz, px) * 6.28, sc, sc * (0.9 + hash(px, pz) * 0.3), sc));
          solidParked.push({ x: tx, z: tz, yaw: 0, offsets: [0],
                             radius: 0.34, reach: 0.7, tag: 'prop' });
          leafCol[sp].push(LEAF[Math.floor(r * LEAF.length)]);
        }
      }
      // kerbside parking on the quieter streets
      if (s2.cls === 'street') {
        for (let t = 20; t < L - 12; t += 12) {
          if (hash(s2.ax + t, s2.az) > 0.42) continue;
          const side = hash(s2.az, s2.ax + t) < 0.5 ? 1 : -1;
          const px = s2.ax + ux * t + nx * (s2.half - 1.2) * side;
          const pz = s2.az + uz * t + nz * (s2.half - 1.2) * side;
          /* A bay is legal on its OWN street's tarmac and nowhere else.
             Segments run straight through junctions, so before this guard
             1,995 of 6,305 bays (32%) sat inside another road's carriageway
             -- a parked car in the middle of the crossing street. 1.5m keeps
             the body (±1.45m offsets, 0.98m radius) clear of the other kerb. */
          if (this.district.tarmacDepth(px, pz, s2) < 1.5) continue;
          /* Six silhouettes, not one. BODY_TYPES has had a hatch, wagon, suv,
             van and pickup in it the whole time and every parked car in
             Halstead Bay was a sedan -- the colours varied, so the street read
             as one model in eleven paint jobs. */
          const bk = BODY_KEYS[Math.floor(hash(s2.ax + t * 2.3, s2.bz) * BODY_KEYS.length)];
          (parked[bk] ?? (parked[bk] = [])).push(
            mat4(px, 0, pz, -Math.atan2(uz, ux), 1, 1, 1));
          // one shared white material would give us a street of identical
          // ghosts, which is exactly what it did
          (parkedCol[bk] ?? (parkedCol[bk] = [])).push(
            PAINT_COLOURS[Math.floor(hash(s2.az + t, s2.ax) * PAINT_COLOURS.length)]);
          solidParked.push({
            x: px, z: pz,
            yaw: Math.atan2(uz, ux),
            offsets: [-1.45, 0, 1.45], radius: 0.98, reach: 2.9, tag: 'parked',
          });
        }
      }
    }

    /* --- authored dressing ---------------------------------------------
       91 ingested assets, placed from the tables in dressing.js. They go into
       their own child group so the whole lot can be hidden by distance in one
       assignment: props are the bulk of the draw calls and nobody reads a
       parking meter from 400m. */
    if (this.catalogue) {
      const props = new THREE.Group();
      props.name = 'dressing';
      group.add(props);
      this.propGroups.set(k, props);
      const batch = new InstanceBatch(this.catalogue);
      /* record where each breakable prop's triangles land in the merged
         buffers, so world/breakables.js can knock them over (see its header) */
      batch.trackNames = BREAK_CLASS;
      const dressPools = [], dressHeads = [];
      yield;
      dressChunk(batch, {
        segments: segs.map((id) => this.district.segments[id]),
        blocks, district: this.district, solids: solidParked, pools: dressPools,
        heads: dressHeads,
      });
      // emissive caps on the authored lamps, so the heads bloom at night
      for (const hd of dressHeads) heads.push(mat4(hd.x, hd.y, hd.z, -hd.yaw, 1, 1, 1));
      yield;
      dressRoofs(batch, boxes, this.district);
      yield;

      /* Facades are their own batch and their own group. They are far and away
         the most expensive thing in the kit -- a dressed frontage is roughly a
         thousand triangles -- so they get a tighter visibility ring than the
         street furniture, set in update(). */
      const faces = new THREE.Group();
      faces.name = 'facades';
      group.add(faces);
      this.facadeGroups.set(k, faces);
      const fbatch = new InstanceBatch(this.catalogue);
      dressFacades(fbatch, boxes, this.district, roadDepth);
      yield;
      fbatch.emit(faces, { shadow: false })
        .catch((e) => console.warn('facades failed:', e.message));
      // fire and forget: the chunk is usable now, the props land a frame later
      batch.emit(props).then(() => {
        if (batch.tracked.length) {
          this.onBreakables?.(k, batch.tracked, solidParked, this.poolsByChunk.get(k));
        }
      }).catch((e) => console.warn('dressing failed:', e.message));
      for (const p of dressPools) pools.push(flat(p.x, p.y, p.z, p.size));
    }

    const inst = (geo, mat, list, shadow, colours) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => m.setMatrixAt(i, mm));
      m.instanceMatrix.needsUpdate = true;
      if (colours) {
        const c = new THREE.Color();
        colours.forEach((hex, i) => m.setColorAt(i, c.setHex(hex)));
        m.instanceColor.needsUpdate = true;
      }
      m.receiveShadow = true;
      if (shadow) m.castShadow = true;
      m.computeBoundingSphere();          // static for the life of the chunk
      group.add(m);
    };
    inst(slabGeo, A.mat.walkDistrict ?? A.mat.walk, slabs.block);
    inst(slabGeo, A.mat.parkGround ?? A.mat.leaf, slabs.park);
    inst(slabGeo, A.mat.kerb, slabs.lot);
    inst(slabGeo, A.mat.kerb, slabs.vacant);
    yield;
    inst(A.geo.lamp, A.mat.pole, lamps, true);
    /* Two head geometries share one list: the legacy lamp's head is offset to
       sit on its own arm; the authored lamps' cap is origin-centred because
       dressing.js already placed it at the arm tip. Only one is in use per
       world, so pick by whether the catalogue dressed this chunk. */
    inst(dressed ? A.geo.lampCap : A.geo.lampHead, A.mat.lampGlow, heads);
    for (const sp of Object.keys(trees)) {
      inst(A.geo.species[sp].trunk, A.mat.bark, trees[sp], true);
      inst(A.geo.species[sp].canopy, A.mat.leaf, trees[sp], true, leafCol[sp]);
    }
    yield;
    /* No glazing on the parked fleet. There are ~390 of them in the streaming
       radius and nobody ever looks into a parked car; adding their windows
       took the scene from 4.9M triangles to 7.5M. */
    /* Two versions of the kerbside fleet, and the ring decides which you see.
       Both are built once with the chunk; only the instance matrices cost
       anything to keep, and the geometry is shared. */
    const nearParked = [], farParked = [];
    for (const bk of Object.keys(parked)) {
      const kit = A.geo.stunt[bk];
      if (!kit) continue;
      inst(kit.body, A.mat.parked, parked[bk], true, parkedCol[bk]);
      const n = group.children[group.children.length - 1];
      if (n) { n.name = `parkedNear:${bk}`; nearParked.push(n); }
      inst(kit.lodBody ?? kit.body, A.mat.parked, parked[bk], false, parkedCol[bk]);
      const f = group.children[group.children.length - 1];
      if (f && f !== n) { f.name = `parkedFar:${bk}`; f.visible = false; farParked.push(f); }
    }
    if (nearParked.length) this.parkedLod.set(k, { near: nearParked, far: farParked });
    if (pools.length) {
      const pm = new THREE.InstancedMesh(A.geo.plane, A.mat.pool, pools.length);
      pm.frustumCulled = false; pm.renderOrder = 2;
      pools.forEach((m, i) => pm.setMatrixAt(i, m));
      pm.instanceMatrix.needsUpdate = true;
      group.add(pm);
      /* breakables need to find a felled lamp's glow pool, or the sodium
         spill keeps floating over an empty pavement all night */
      this.poolsByChunk.set(k, {
        mesh: pm, at: pools.map((m) => [m.elements[12], m.elements[14]]),
      });
    }
    /* Facade textures tile through a per-instance aUvScale attribute. Without
       it a single 4-storey tile is stretched over a 78m tower, which is exactly
       why every building here used to read as a plain grey box. */
    const tiled = (mat, bucket) => {
      if (!bucket.m.length) return;
      const geo = slabGeo.clone();
      geo.userData.owned = true;
      const m = new THREE.InstancedMesh(geo, mat, bucket.m.length);
      geo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(new Float32Array(bucket.uv), 2));
      bucket.m.forEach((mm, i) => m.setMatrixAt(i, mm));
      m.instanceMatrix.needsUpdate = true;
      /* Culled. InstancedMesh bounds account for instance matrices now, and
         these are built once and never touched again -- which is the whole
         condition for it being safe. Anything whose matrices are rewritten
         per frame (the crowd, the far-city stand-ins) keeps culling off,
         because a cached sphere goes stale the moment the instances move. */
      m.computeBoundingSphere();
      m.receiveShadow = true;
      group.add(m);
    };
    for (const key of Object.keys(facades)) {
      const [arch, v] = key.split('|');
      tiled(A.facades[arch][+v], facades[key]);
    }
    yield;
    for (const key of Object.keys(bases)) tiled(A.base.materials[+key], bases[key]);
    inst(slabGeo, A.mat.roof, roofs);
    inst(slabGeo, A.mat.roofGlass, glassRoofs);
    inst(slabGeo, A.mat.crown, crowns);
    inst(slabGeo, A.mat.pole, masts);
    inst(A.geo.ac, A.mat.plant, plant.ac, true);
    inst(A.geo.tank, A.mat.plant, plant.tank, true);
    inst(A.geo.hut, A.mat.plant, plant.hut, true);

    this.parkedByChunk.set(k, solidParked);
    this.solidsByChunk.set(k, boxes);
    this.scene.add(group);   // the last step: the chunk appears whole
  }

  /** Solid building footprints in the 3x3 chunks around a point. */
  nearbyBuildings(x, z) {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.solidsByChunk.get(ck(ix + dx, iz + dz));
        if (list) for (const b of list) {
          if (Math.abs(b.x - x) < 60 && Math.abs(b.z - z) < 60) out.push(b);
        }
      }
    }
    return out;
  }

  /** Collision bodies for the parked cars and street furniture nearby. */
  nearbyParked(x, z) {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.parkedByChunk.get(ck(ix + dx, iz + dz));
        if (list) for (const p of list) out.push(p);
      }
    }
    return out;
  }
}

const _colour = new THREE.Color();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** a ground-plane quad, laid flat and scaled — light pools, decals */
function flat(x, y, z, size) {
  _e.set(-Math.PI / 2, 0, 0);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z), _q.setFromEuler(_e), _s.set(size, size, 1),
  );
}

/** A ground-plane rectangle, yawed. `flat()` only does squares. */
function flatRect(x, y, z, yaw, len, wid) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -yaw, 0))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
  return new THREE.Matrix4().compose(_v.set(x, y, z), q, _s.set(len, wid, 1));
}

function mat4(x, y, z, angle, sx, sy, sz) {
  _e.set(0, -angle, 0);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz),
  );
}
