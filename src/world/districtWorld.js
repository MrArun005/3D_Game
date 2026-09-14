import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstanceBatch } from './catalogue.js';
import { dressChunk, dressRoofs, dressFacades, place as placeAsset, farLampHeads } from './dressing.js';
import { KERB_H, roadDepth } from './metrics.js';
import { ARCH, TOWER, MID, LOFT, PODIUM, DECK } from './facades.js';
import { mulberry32 } from '../core/rng.js';
import { SHADOW_FAR_LAYER } from '../core/renderer.js';
import { KIT_DISTRICT, pickKitModel } from './kitBuildings.js';
import { PAINT_COLOURS, BODY_KEYS } from '../vehicle/config.js';
import { signalState, LAMP_COLOURS } from './signals.js';
import { BREAK_CLASS } from './breakables.js';
import { ZEBRA_DEPTH } from '../game/traffic.js';
import { buildTokyoBuilding, frontRotation, tokyoMaterial, buildTokyoStreet, wireMaterial, buildShrine } from './tokyo.js';
import { loadTokyoTowers, towerFor } from './tokyoTowers.js';
import { loadTerraces, terraceFor, TERRACES } from './terraceModels.js';
import { loadIndustrial, industrialYard, INDUSTRIAL } from './industrialYard.js';
import { tileUv, SIGN_TILES } from './signs.js';
import { buildDecals, decalMaterial, decalGeometry } from './decals.js';
import { buildGlare, setGlareRing } from './glare.js';
import { buildSpan, signatureBridge } from './spans.js';
import { skirtFoot } from './district.js';
import { styleFor, buildArt, artMaterial, ART_CAP } from './artBuildings.js';

/**
 * Halstead Bay in three dimensions.
 *
 * The planner exports centrelines and footprints; the volume is built here.
 * Streaming works in 256m chunks: a chunk owns the road quads whose segments
 * fall inside it and the blocks whose centre does, so nothing is built twice
 * and a chunk can be thrown away without consulting its neighbours.
 */
const CHUNK = 256;
const LOG_SLICES = typeof location !== 'undefined' && new URLSearchParams(location.search).has('slices');
const BUILD_MS = 2.0;      // 2.0ms budget prevents micro-stutters and drops below 60fps
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
  /* 1.15 made Little Tokyo a low-rise: `row` blocks came out 9-15 m (three
     storeys) and `mid` 18-35 m, against a 34 m carriageway. That is a
     boulevard with shops on it, not Shibuya. The reference frames are a
     continuous 10-20 storey wall either side of the street, so the land here
     has to work at least as hard as Kingsway's 1.7. tokyo.js caps the result
     (13 storeys on a wide footprint, 20 otherwise, 26 on a landmark), so this
     raises the floor of the street without letting a single slab run away. */
  'LITTLE TOKYO': 2.2,
};
const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

/**
 * The tallest roofs within `radius` of a point, in world space, from the same
 * formula the massing uses -- so a sign placed here lands on a roof that exists.
 * Each: { x, z, h, w, d, angle } (centre, height, footprint, block yaw).
 */
export function roofsNear(district, x, z, radius, n = 6) {
  const out = [];
  for (const bl of district.data.blocks) {
    if (Math.hypot(bl.x - x, bl.y - z) > radius) continue;
    const range = HEIGHT[bl.type];
    if (!range || range[1] === 0) continue;
    const scale = DISTRICT_SCALE[bl.district] ?? 1;
    const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
    for (const g of district.buildingsOf(bl.id)) {
      const h = (range[0] + hash(g.x + bl.x, g.y + bl.y) * (range[1] - range[0])) * scale;
      const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
      out.push({ x: bl.x + lx * ca - lz * sa, z: bl.y + lx * sa + lz * ca, h, w: g.w, d: g.d, angle: bl.angle });
    }
  }
  return out.sort((p, q) => q.h - p.h).slice(0, n);
}
const ARCHETYPE = { tower: TOWER, mid: MID, row: LOFT, yard: DECK, lot: PODIUM };
/* Each district builds differently, not just taller or shorter. `forms` are
   the massing shapes #massing may choose (weights), `style` biases the facade
   kit (dressing.js styleFor). KINGSWAY: podium-and-tower glass; OLD QUARTER
   and VELLERY ROW: narrow period blocks with wings; STEELGATE and the yards:
   long sheds; THE FLATS: stepped residential terraces; NORTHLINE and
   GREENFELL: low suburban rows. Same seed, same city -- these only weight
   the hashed choice. */
/* 2026-09-08: two new forms. 'gable' -- a pitched roof on a low building
   (the suburbs and the period rows had flat slabs everywhere, the single
   loudest "offices, not houses" tell); 'bays' -- full-height projecting bays
   on a period mid-rise, the relief a Victorian terrace is made of. Both fall
   through to the box forms when the footprint does not suit them. */
const DISTRICT_FORM = {
  KINGSWAY:        { forms: { podium: 0.45, setback: 0.35, slab: 0.2 }, style: 'modern' },
  NORTHLINE:       { forms: { gable: 0.45, slab: 0.25, wing: 0.2, terrace: 0.1 }, style: 'period' },
  STEELGATE:       { forms: { shed: 0.55, slab: 0.3, wing: 0.15 }, style: 'industrial' },
  'HARBOUR POINT': { forms: { shed: 0.4, slab: 0.35, wing: 0.25 }, style: 'industrial' },
  'OLD QUARTER':   { forms: { wing: 0.3, bays: 0.3, gable: 0.2, slab: 0.2 }, style: 'period' },
  'VELLERY ROW':   { forms: { bays: 0.35, wing: 0.3, slab: 0.2, setback: 0.15 }, style: 'period' },
  ASHMOOR:         { forms: { slab: 0.3, wing: 0.3, gable: 0.2, bays: 0.2 }, style: 'period' },
  'MARROW HILL':   { forms: { gable: 0.35, terrace: 0.3, slab: 0.2, wing: 0.15 }, style: 'period' },
  'THE FLATS':     { forms: { terrace: 0.4, bays: 0.3, slab: 0.15, setback: 0.15 }, style: 'modern' },
  'GREENFELL PARK': { forms: { gable: 0.55, slab: 0.25, wing: 0.2 }, style: 'period' },
  'LITTLE TOKYO':   { forms: { tokyo_walkup: 0.55, setback: 0.25, slab: 0.20 }, style: 'tokyo' },
};
const pickForm = (forms, r) => { let acc = 0; for (const [k, w] of Object.entries(forms)) { acc += w; if (r < acc) return k; } return 'slab'; };
/* Foliage is never one green. These multiply the leaf material, so they read
   as the same planting in different light rather than as five paint pots. */
const LEAF = [0x3d5a32, 0x4a6338, 0x2f4a28, 0x455c34, 0x3a522e, 0x486438];
/* The canopy tint. LEAF's six greens are right for a plane tree and wrong for a
   cherry, so an AUTHORED species (world/treeModels.js) uses the colour read off
   its own model instead -- sakura stays pink, the maple red -- while a
   procedural one keeps the green it always had. Per instance, so it costs
   nothing: the canopies were already tinted this way. */
const leafTint = (A, sp, fallback) => A?.geo?.species?.[sp]?.authored
  ? (A.geo.species[sp].leaf ?? fallback)
  : fallback;

export class DistrictWorld {
  constructor(scene, assets, district, opts = {}) {
    this.scene = scene;
    this.assets = assets;
    this.district = district;
    this.chunks = new Map();
    /* Arun's authored neon towers, baked once and merged into each Tokyo chunk
       mesh. Async: chunks build from frame one, so until this lands every
       footprint falls through to a generated building, and Tokyo chunks built
       before it are not rebuilt -- the towers simply appear on whatever streams
       in afterwards, which at boot is everything past the spawn ring. */
    this.towers = null;
    loadTokyoTowers().then((t) => { this.towers = t.length ? t : null; })
      .catch((e) => console.warn('tokyo towers:', e?.message ?? e));
    /* Arun's terraces, for the three districts whose brief the procedural
       styles never matched (see terraceModels.js). Async like the towers:
       until it lands those plots build as they always did. */
    this.terraces = null;
    loadTerraces().then((m) => { this.terraces = m.size ? m : null; })
      .catch((e) => console.warn('terraces:', e?.message ?? e));
    /* The five industrial modules. Steelgate, Northline and Harbour Point were
       building on 15-16% of their plots because warehouse caps at 44x40 m and
       those yards run to 197x101; these lay a whole compound out instead. */
    this.industrial = null;
    loadIndustrial().then((m) => { this.industrial = m.size ? m : null; })
      .catch((e) => console.warn('industrial:', e?.message ?? e));
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
    // city-wide BatchedMesh per material (catalogue.js) -- the draw-call fix of 2026-09-02
    if (this.catalogue?.multiDraw) this.catalogue.attach(scene);
    this.propGroups = new Map();
    this.headsByChunk = new Map();
    this.heroLightsByChunk = new Map();
    this.gantryArmByNode = new Map();   // node id -> the edge index that carries its gantry
    this.nodeDegreeById = new Map();    // node id -> how many roads meet there   // chunk key -> [{x,y,z,colour,intensity,range}] block hero lights (game/lighting.js)     // chunk key -> [{x,y,z}] lamp heads (night light pool)
    this.facadeGroups = new Map();
    this.parkedLod = new Map();        // chunk key -> { near, far, byBody } parked-car LOD sets (#cullFar swaps them; #buildSteps sets, releaseChunk deletes). Dropped by the lite/radius constructor edit in 22c1c0c and every chunk build died on .set -- keep it.
    this.isLite = !!opts.lite;
    this.propRadius = opts.lite ? 1 : (opts.propRadius ?? 2);
    this.nodeById = new Map(district.graph.nodes.map((n) => [n.id, n]));
    this.radius = opts.lite ? 1 : (opts.radius ?? 2);   // 3x3 in LITE (9 chunks = 768m) or 5x5 in FULL (25 chunks = 1.28km)

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
  /** How many roads meet at `nodeId`. Cached: a scan per approach is not free. */
  #nodeDegree(nodeId) {
    let n = this.nodeDegreeById.get(nodeId);
    if (n !== undefined) return n;
    n = 0;
    for (const e of this.district.graph.edges) if (e.a === nodeId || e.b === nodeId) n++;
    this.nodeDegreeById.set(nodeId, n);
    return n;
  }

  /** The one approach at `nodeId` that may carry an overhead sign gantry. */
  #gantryArm(nodeId) {
    let arm = this.gantryArmByNode.get(nodeId);
    if (arm !== undefined) return arm;
    arm = -1;
    const edges = this.district.graph.edges;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if ((e.a !== nodeId && e.b !== nodeId) || e.width <= 26) continue;
      if (arm < 0 || i < arm) arm = i;
    }
    this.gantryArmByNode.set(nodeId, arm);
    return arm;
  }

  #buildFarCity(day) {
    const D = this.district;
    const far = new THREE.Group();

    /* The far roads wear the SAME tarmac as the near ones.
       They were a flat Lambert grey with no UVs, so the moment a chunk
       streamed out the road lost its grain, its tone and its normal map and
       became a paint band -- a visible cliff in every establishing shot.
       Same material, same 18.4m tile in metres, and the join disappears; the
       markings alone are absent out there, and at that range they are
       sub-pixel anyway. */
    const pos = [], uvs = [];
    for (const s of D.segments) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * s.half, nz = (dx / L) * s.half;
      pos.push(
        s.ax + nx, 0, s.az + nz, s.bx + nx, 0, s.bz + nz, s.bx - nx, 0, s.bz - nz,
        s.ax + nx, 0, s.az + nz, s.bx - nx, 0, s.bz - nz, s.ax - nx, 0, s.az - nz,
      );
      const v = L / 18.4, u = (s.half * 2) / 18.4;
      uvs.push(0, 0, v, 0, v, u, 0, 0, v, u, 0, u);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    rg.setAttribute('normal', new THREE.BufferAttribute(
      new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    rg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    const roads = new THREE.Mesh(rg, this.assets.mat.tarmac);
    roads.position.y = -0.03;               // always loses to the real tarmac
    roads.frustumCulled = false;
    /* The far city RECEIVES the sun's shadow (2026-09-08). Photo presets that
       stand outside the loaded ring (docks, beach, aerial) see only these
       meshes as ground, and until now nothing there could take a shadow --
       which is what the "no far-cascade shadow lands" hunt was looking at. */
    roads.receiveShadow = true;
    far.add(roads);

    const slabs = [], solids = [], uvScale = [];
    const c = new THREE.Color();
    for (const bl of D.blocks) {
      slabs.push(mat4(bl.x, 0, bl.y, bl.angle, bl.w, KERB_H * 0.9, bl.h));
      const range = HEIGHT[bl.type];
      if (!range || !range[1]) continue;
      const scale = DISTRICT_SCALE[bl.district] ?? 1;
      const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
      /* The stand-in wears the same tiled facade as the near building, so it
         needs the same per-instance UV scale: tiles across = width / tile
         width, tiles up = height / (floors * storey). The near massing does
         exactly this per stage in #massing; a stand-in is one stage. */
      const spec = ARCH[ARCHETYPE[bl.type]] ?? ARCH[MID];
      const tileW = spec.wide, tileH = spec.floors * spec.storey;
      for (const g of D.buildingsOf(bl.id)) {
        const h = (range[0] + hash(g.x + bl.x, g.y + bl.y) * (range[1] - range[0])) * scale;
        const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
        const w = Math.max(1, g.w - 0.3), hh = Math.max(1, h - 0.4);
        solids.push(mat4(bl.x + lx * ca - lz * sa, KERB_H,
                         bl.y + lx * sa + lz * ca, bl.angle,
                         w, hh, Math.max(1, g.d - 0.3)));
        uvScale.push(w / tileW, hh / tileH);
      }
    }
    const box = this.assets.geo.box;
    const slabMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({
      color: day ? 0x9d9a90 : 0x1b2027,
    }), slabs.length);
    slabs.forEach((m, i) => slabMesh.setMatrixAt(i, m));
    slabMesh.instanceMatrix.needsUpdate = true;
    slabMesh.frustumCulled = false;
    slabMesh.receiveShadow = true;
    far.add(slabMesh);

    /* Windows on the skyline.
       Flat PAL-grey Lambert boxes read as nothing against the ground: past two
       blocks the city looked like a plain of roads with three towers on it,
       although all 2,482 stand-ins were there. They now wear the near towers'
       own tiled facade material, driven by the same aUvScale attribute the
       near massing uses -- so from a rooftop the grid is buildings to the
       mountains, and at night they light up with the rest of the city. One
       material, one draw, and #cullFar's matrix bookkeeping is untouched. */
    const farGeo = box.clone();
    farGeo.userData.owned = true;
    farGeo.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(new Float32Array(uvScale), 2));
    const solidMesh = new THREE.InstancedMesh(farGeo, this.assets.facades[TOWER][0], solids.length);
    /* Where detail exists the far copy has to get out of the way: a stand-in
       box is full width to the top, so it burst out of every setback and
       crown as a pale cube sitting on the real building. */
    this.farSolids = solids;
    this.farAt = solids.map((m) => [m.elements[12], m.elements[14]]);
    this.farMesh = solidMesh;
    this.farHidden = new Set();
    solids.forEach((m, i) => solidMesh.setMatrixAt(i, m));
    solidMesh.instanceMatrix.needsUpdate = true;
    /* Skyline (item 5): every stand-in over 45m gets a mast and a red beacon,
       so the far city has a roofline and, at night, the blinking-red horizon
       every real city has. Two instanced draws for the whole map. */
    const tall = solids.filter((m) => m.elements[5] > 45);
    if (tall.length) {
      const masts = new THREE.InstancedMesh(box, this.assets.mat.pole, tall.length);
      const beacons = new THREE.InstancedMesh(this.assets.geo.lampCap, this.assets.mat.beacon, tall.length);
      tall.forEach((m, i) => {
        const e = m.elements, top = e[13] + e[5], mh = 6 + (e[5] % 7);
        masts.setMatrixAt(i, mat4(e[12], top + mh / 2, e[14], 0, 0.5, mh, 0.5));
        beacons.setMatrixAt(i, mat4(e[12], top + mh + 0.3, e[14], 0, 1.6, 1.6, 1.6));
      });
      masts.instanceMatrix.needsUpdate = beacons.instanceMatrix.needsUpdate = true;
      masts.frustumCulled = beacons.frustumCulled = false;
      far.add(masts, beacons);
    }
    // matrices are rewritten by #cullFar as you move, so the sphere would go
    // stale -- this one genuinely has to opt out
    solidMesh.frustumCulled = false;
    /* No shadows from the far stand-ins. With frustumCulled off, all 2,482 of
       them are submitted to the shadow pass every frame, and every one of
       them is outside the sun's 120m shadow frustum by construction. */
    solidMesh.castShadow = false;
    far.add(solidMesh);
    /* Every lamp in the district as a glare sprite (GTA's distant-light quads,
       docs/GTA-VISUALS-RESEARCH.md item 2): one instanced draw, night-faded,
       zero-scaled inside the detailed ring where the chunk's own glare sits. */
    { const fl = buildGlare(farLampHeads(this.district), 17, true); if (fl) { fl.renderOrder = 2; far.add(fl); this.farGlareCount = fl.count; } }

    this.scene.add(far);
    this.far = far;
  }

  /** Zero-scale the far stand-ins that the detailed chunks now cover. */
  #cullFar(x, z) {
    const R = (this.radius + 0.5) * CHUNK;
    setGlareRing(x, z, R);
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
  update(x, z, vx = 0, vz = 0) {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const speed = Math.hypot(vx, vz);
    if (this.farAt && (this.lastCull === undefined
        || Math.abs(x - this.lastCull[0]) > 48 || Math.abs(z - this.lastCull[1]) > 48)) {
      this.#cullFar(x, z);
      this.lastCull = [x, z];
    }

    // what is missing, prioritised by distance ahead of the car's velocity vector
    const wasPrimed = this.primed;
    const sameChunk = this._lastScanIx === ix && this._lastScanIz === iz;
    if (!sameChunk || this.queue.length === 0 || !wasPrimed) {
      this._lastScanIx = ix;
      this._lastScanIz = iz;
      const want = [];
      const hasVel = speed > 1.5;
      const normVx = hasVel ? vx / speed : 0;
      const normVz = hasVel ? vz / speed : 0;
      // Pre-warm one ring ahead at low priority while stationary
      const scanRadius = (wasPrimed && speed < 1.0) ? this.radius + 1 : this.radius;

      for (let dx = -scanRadius; dx <= scanRadius; dx++) {
        for (let dz = -scanRadius; dz <= scanRadius; dz++) {
          const k = ck(ix + dx, iz + dz);
          if (this.chunks.has(k) || this.pending.has(k)) continue;
          const d2 = dx * dx + dz * dz;
          // Chunks ahead in velocity vector get higher priority (lower effective d)
          const dotAhead = hasVel ? (dx * normVx + dz * normVz) : 0;
          const priority = (Math.abs(dx) > this.radius || Math.abs(dz) > this.radius)
            ? d2 + 500 // pre-warm outer ring at lowest priority
            : d2 - dotAhead * 2.2;
          want.push({ k, cx: ix + dx, cz: iz + dz, d: d2, priority });
        }
      }
      want.sort((a, b) => a.priority - b.priority);
      for (const w of want) { this.queue.push(w); this.pending.add(w.k); }
    }

    /* The first frame has to be complete -- streaming the world in around a
       stationary player at the start looks like a bug, not like streaming.
       After that, a build is a GENERATOR pumped for at most BUILD_MS a frame:
       the queue kept five chunks from landing on one frame, but a single
       chunk was still 40-70ms of roads, massing, dressing and instancing in
       one gulp — a felt steering hitch at exactly the moment you cross a
       boundary at speed. The group only enters the scene when its generator
       finishes, so nobody ever sees half a chunk. */
    const budget = wasPrimed ? BUILD_MS : Infinity;
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      if (!this.building) {
        const w = this.queue.shift();
        if (!w) break;
        // it may have gone out of range while it sat in the queue
        const maxR = wasPrimed ? this.radius + 1 : this.radius;
        if (Math.abs(w.cx - ix) > maxR || Math.abs(w.cz - iz) > maxR) {
          this.pending.delete(w.k);
          continue;
        }
        // stays in `pending` until the build completes, or the rescan re-queues it
        /* A chunk is a RENDER BUNDLE (three BundleGroup). Its contents are
           static, so the renderer records their draws once and replays the
           recording every frame -- the CPU stops re-walking, re-culling and
           re-binding ~40 meshes per chunk. */
        this.building = {
          k: w.k, cx: w.cx, cz: w.cz,
          group: USE_BUNDLES ? new THREE.BundleGroup() : new THREE.Group(),
          gen: null,
        };
        this.building.gen = this.#buildSteps(w.cx, w.cz, this.building.group, w.d ?? 0);
      }
      const b = this.building;
      const t1 = performance.now();
      const done = b.gen.next().done;
      b.ms = (b.ms || 0) + performance.now() - t1;   // whole-chunk cost, across frames
      if (done) {
        if (wasPrimed && this.onChunkDone) this.onChunkDone(b.ms);
        // bundle rule: nothing inside a bundle is culled per object
        b.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        b.group.needsUpdate = true;
        this.chunks.set(b.k, b.group);
        this.pending.delete(b.k);
        this.building = null;
        // Hard cap of 1 chunk build in flight/completed per frame when primed to prevent burst overruns
        if (wasPrimed) break;
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
      const maxAbandonR = (wasPrimed && speed < 1.0) ? this.radius + 1 : this.radius;
      if (Math.abs(b.cx - ix) > maxAbandonR || Math.abs(b.cz - iz) > maxAbandonR) {
        b.group.traverse((o) => {
          if (o.userData?.batched) this.catalogue.releaseBatched(o.userData.batched);
          if (!o.isMesh) return;
          if (o.isInstancedMesh) o.dispose();
          if (o.geometry?.userData?.owned) o.geometry.dispose();
        });
        for (const m of [this.propGroups, this.facadeGroups, this.parkedLod,
                         this.parkedByChunk, this.signalsByChunk,
                         this.solidsByChunk, this.poolsByChunk]) m.delete(b.k);
        this.pending.delete(b.k);
        this.building = null;
        this.#rerecordAll();
      }
    }

    /* Dressing is visible only in the near ring. Props are small, numerous and
       the single biggest contributor to the draw count; at 400m they are a few
       pixels each and cost exactly as much as they do at 10m. One boolean per
       chunk is the whole LOD system for them. */
    /* Chunk-level frustum culling, because the meshes inside a bundle are not
       culled per object any more. The 3x3 ring around the player is always
       drawn -- it casts the shadows that fall into view from behind the camera
       -- and rings beyond it are drawn only when their box meets the frustum. */
    if (this.camera) {
      _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
      for (const [k, g] of this.chunks) {
        const [a, b] = k.split(',').map(Number);
        const d = Math.max(Math.abs(a - ix), Math.abs(b - iz));
        if (d <= 1) { g.visible = true; continue; }
        _box.min.set(a * CHUNK, -6, b * CHUNK); _box.max.set((a + 1) * CHUNK, 140, (b + 1) * CHUNK);
        g.visible = _frustum.intersectsBox(_box);
      }
    }
    for (const [key, g] of this.propGroups) {
      const [a, b] = key.split(',').map(Number);
      const d = Math.max(Math.abs(a - ix), Math.abs(b - iz));
      const wasVisible = g.visible;
      g.visible = d <= this.propRadius;
      if (g.visible !== wasVisible) g.parent.needsUpdate = true;      // re-record the chunk's bundle
      if (g.userData.batched && g.userData.batchedVisible !== g.visible) {
        g.userData.batchedVisible = g.visible;
        this.catalogue.setBatchedVisible(g.userData.batched, g.visible);
      }
      const fg = this.facadeGroups.get(key);
      if (fg) {
        if (fg.visible !== (d <= 1)) fg.parent.needsUpdate = true;
        fg.visible = d <= 1;
        if (fg.userData.batched && fg.userData.batchedVisible !== fg.visible) {
          fg.userData.batchedVisible = fg.visible;
          this.catalogue.setBatchedVisible(fg.userData.batched, fg.visible);
        }
      }
      const pl = this.parkedLod.get(key);
      if (pl) {
        if (pl.ring !== d) { pl.ring = d; (pl.near[0] ?? pl.far[0])?.parent && ((pl.near[0] ?? pl.far[0]).parent.needsUpdate = true); }
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
        g.needsUpdate = true;                                            // casters changed: re-record
        const cast = d === 0;
        /* Building shells are the exception: they are what the far cascade
           exists for (a tower's shadow falls across the next street), so they
           cast from the neighbouring ring too. They are the only meshes on
           SHADOW_FAR_LAYER, so this is all the far map draws. */
        for (const m of g.children) m.castShadow = m.userData.shell ? d <= 1 : cast;
      }
    }
    const maxReleaseR = (this.primed && speed < 1.0) ? this.radius + 1 : this.radius;
    for (const [k, g] of [...this.chunks]) {
      const [a, b] = k.split(',').map(Number);
      if (Math.abs(a - ix) > maxReleaseR || Math.abs(b - iz) > maxReleaseR) {
        this.scene.remove(g);
        /* Only geometry this chunk built. The old sweep disposed shared
           assets.geo.* buffers that 24 other live chunks were still drawing
           from, forcing a silent GPU re-upload at every chunk boundary. */
        this.propGroups.delete(k);
        this.facadeGroups.delete(k);
        this.parkedLod.delete(k);
        g.traverse((o) => {
          if (o.userData?.batched) this.catalogue.releaseBatched(o.userData.batched);   // city-wide batches: free the ids
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
        this.headsByChunk.delete(k);
        this.heroLightsByChunk.delete(k);
        this.onBreakablesGone?.(k);
        this.#rerecordAll();
      }
    }
  }

  /**
   * One building, as a stack of volumes rather than a single extrusion: a
   * shopfront base, a shaft that may step back once or twice, a cornice
   * capping every step, and a crown on the towers. This is the difference
   * between a skyline and a bar chart.
   */
  #massing(arch, wx, wz, angle, w, d, h, out, district = null, chunkDist2 = 0) {
    const A = this.assets;
    const rand = mulberry32(Math.floor(hash(wx, wz) * 2147483647) >>> 0);
    const dform = DISTRICT_FORM[district] ?? DISTRICT_FORM.ASHMOOR;
    const form = pickForm(dform.forms, rand());
    // local (along, across) offsets on the block's own axes
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const at = (ox, oz) => [wx + ox * ca - oz * sa, wz + ox * sa + oz * ca];
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
      relief(y, hh, w * k, d * k);
    };
    // a stage of its own footprint (sw x sd), offset (ox, oz) on the block axes
    const stageAt = (y, hh, sw, sd, ox, oz) => {
      const [px, pz] = at(ox, oz);
      fb.m.push(mat4(px, y, pz, angle, sw, hh, sd));
      fb.uv.push(sw / tileW, hh / tileH);
      (glassTop ? out.glassRoofs : out.roofs).push(mat4(px, y + hh - SINK, pz, angle, sw + 0.1, 0.7 + SINK, sd + 0.1));
      relief(y, hh, sw, sd, ox, oz);
    };
    const cap = (y, hh, k, pad) =>
      (glassTop ? out.glassRoofs : out.roofs).push(
        mat4(wx, y, wz, angle, w * k + pad, hh, d * k + pad));

    /* Relief: the shells were one scaled box wearing a tiled canvas facade, so
       a 60 m wall took ONE light value and cast no shadow on itself -- the
       "extruded cardboard" look. Belt courses every few storeys and pilasters
       at the corners give the sun something to catch: crisp horizontal and
       vertical shadow lines down the face. They ride the roof/trim bucket,
       which is already instanced, so the draw count does not move; the cost is
       ~10 boxes (120 triangles) a building. Self-built styles (world/buildings)
       carry their own relief and never come through here. */
    const relief = (y, hh, sw, sd, ox = 0, oz = 0) => {
      if (hh < 6 || sw < 5 || sd < 5) return;                   // a shed gets none
      const band = hh > 40 ? 12 : hh > 20 ? 9 : 6.5;            // a tower's courses sit further apart
      const [cx, cz] = at(ox, oz);
      for (let by = y + band; by < y + hh - 1.2; by += band) {
        out.roofs.push(mat4(cx, by, cz, angle, sw + 0.34, 0.26, sd + 0.34));   // belt course, 0.17 m proud
      }
      const pw = Math.min(1.1, sw * 0.12), pd = Math.min(1.1, sd * 0.12), pr = 0.16;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {     // corner pilasters, full height
        const [px, pz] = at(ox + sx * (sw / 2 - pw / 2 + pr * 0.5), oz + sz * (sd / 2 - pd / 2 + pr * 0.5));
        out.roofs.push(mat4(px, y, pz, angle, pw + pr, hh, pd + pr));
      }
    };
    let topK = 1, pitched = false;
    /* A parapet lip round a flat roof: 0.6 m up, 0.3 m thick, four boxes in
       the roof bucket. From the street it IS the roofline; without it the top
       of every box was a knife edge against the sky. */
    const lip = (y, sw, sd) => {
      const t = 0.3, hh = 0.6;
      for (const s of [-1, 1]) {
        let [px, pz] = at(0, s * (sd / 2 - t / 2)); out.roofs.push(mat4(px, y, pz, angle, sw, hh, t));
        [px, pz] = at(s * (sw / 2 - t / 2), 0);     out.roofs.push(mat4(px, y, pz, angle, t, hh, sd));
      }
    };
    const lipY = KERB_H + h + 0.7 - 0.05;          // on top of the final cap (cap() stands 0.7 above h)
    /* District forms first; the old tower/mid setbacks remain as 'setback'
       and the plain box as 'slab'. Every form is still a few instanced boxes
       in the same facade bucket, so the draw count does not move. */
    if (form === 'gable' && out.gables && shaft <= 13 && w <= 24 && d <= 24) {
      /* A pitched roof: the shell stops at the eaves and a prism (A.geo.gable,
         ridge along its local X) sits on it with a 0.45 m overhang, ridge
         along the longer side, pitch ~35 degrees, capped at 4.5 m tall. The
         ridge overshoots the planning height by a storey; h stays the
         collision height, and dressRoofs leaves the slope alone (pitched). */
      const rh = Math.min(4.5, Math.min(w, d) * 0.36);
      const wallH = Math.max(3.0, shaft - rh * 0.5);
      stage(y0, wallH, 1);
      const along = w >= d;
      out.gables.push(mat4(wx, y0 + wallH - SINK, wz, angle + (along ? 0 : Math.PI / 2), (along ? w : d) + 0.9, rh, (along ? d : w) + 0.9));
      pitched = true;
    } else if (form === 'bays' && w > 9 && shaft > 7) {
      /* Projecting bays: two or three full-height oriels on both long faces,
         each its own capped box in the SAME facade bucket, so the window
         rhythm continues round the bay. Four to six boxes of relief per
         building -- the cheapest thing a flat period wall can carry. */
      stage(y0, shaft, 1);
      cap(KERB_H + h - SINK, 0.7 + SINK, 1, 0.1);
      const n = w > 18 ? 3 : 2, pitch = w / n, bw = Math.min(3.0, pitch * 0.45), bd = 0.75, bh = shaft - 1.2;
      for (let i = 0; i < n; i++) {
        const ox = -w / 2 + pitch * (i + 0.5);
        for (const side of [-1, 1]) {
          const [px, pz] = at(ox, side * (d / 2 + bd / 2 - 0.05));
          fb.m.push(mat4(px, y0, pz, angle, bw, bh, bd));
          fb.uv.push(bw / tileW, bh / tileH);
          out.roofs.push(mat4(px, y0 + bh - SINK, pz, angle, bw + 0.3, 0.4 + SINK, bd + 0.3));
        }
      }
      lip(lipY, w + 0.1, d + 0.1);
    } else if (form === 'wing' && w > 15 && d > 11 && shaft > 6) {
      // an L: the main block along the frontage, a lower wing back on one side
      const side = rand() < 0.5 ? -1 : 1, wingW = w * (0.34 + rand() * 0.12), wingH = shaft * (0.55 + rand() * 0.25);
      stageAt(y0, shaft, w, d * 0.58, 0, -d * 0.21);
      stageAt(y0, wingH, wingW, d * 0.42, side * (w / 2 - wingW / 2), d * 0.29);
    } else if (form === 'podium' && shaft > 20) {
      // a two-storey podium the full footprint, a slimmer tower off-centre on top
      const podH = Math.min(shaft * 0.28, 8.5), k = 0.5 + rand() * 0.14, side = rand() < 0.5 ? -1 : 1;
      stage(y0, podH, 1);
      cap(y0 + podH - SINK, 0.5 + SINK, 1, 0.1);
      stageAt(y0 + podH - SINK, shaft - podH + SINK, w * k, d * k, side * w * (0.5 - k / 2) * 0.8, 0);
      topK = k;
    } else if (form === 'tokyo_walkup' && shaft > 8) {
      // Tokyo commercial street walk-up: narrow multi-tiered street building with stacked shops and setback upper floors
      const podH = Math.min(shaft * 0.45, 12.0);
      const k = 0.82 + rand() * 0.10;
      stage(y0, podH, 1);
      cap(y0 + podH - SINK, 0.5 + SINK, 1, 0.1);
      stageAt(y0 + podH - SINK, shaft - podH + SINK, w * k, d * k, (rand() - 0.5) * w * 0.08, 0);
      topK = k;
    } else if (form === 'terrace' && w > 12 && shaft > 9) {
      // stepped: three bands of the frontage at falling heights
      const n = 3, bw = w / n;
      for (let i = 0; i < n; i++) {
        const hh = shaft * (1 - 0.18 * ((i + Math.floor(rand() * 2)) % n));
        stageAt(y0, hh, bw + 0.02, d, -w / 2 + bw * (i + 0.5), 0);
      }
    } else if (form === 'shed' && w > 10) {
      // long low sheds: a wide body with a raised spine and roof huts
      const bodyH = Math.min(shaft, 9 + rand() * 3);
      stage(y0, bodyH, 1);
      stageAt(y0 + bodyH - SINK, 1.6 + rand(), w * 0.32, d * 1.02, 0, 0);
      cap(KERB_H + Math.min(h, baseH - SINK + bodyH) - SINK, 0.7 + SINK, 1, 0.1);
      for (let i = 0, k = 2 + Math.floor(rand() * 3); i < k; i++) {
        const [px, pz] = at((rand() - 0.5) * w * 0.7, (rand() - 0.5) * d * 0.6);
        out.plant.hut.push(mat4(px, KERB_H + baseH - SINK + bodyH + 0.6, pz, angle, 1, 1, 1));
      }
    } else if (arch === TOWER && shaft > 36) {
      // Elegant 3-stage neo-futurist stepped setback tower (consistent silhouette at all distances)
      const a = shaft * 0.40, b = shaft * 0.32;
      const k1 = 0.82 + rand() * 0.06, k2 = 0.62 + rand() * 0.06;
      stage(y0, a, 1);
      stage(y0 + a - SINK, b, k1);
      stage(y0 + a + b - SINK * 2, shaft - a - b + SINK * 2, k2);
      cap(y0 + a - SINK, 0.5 + SINK, 1, 0.12);
      cap(y0 + a + b - SINK * 2, 0.5 + SINK, k1, 0.12);
      cap(KERB_H + h - SINK, 0.7 + SINK, k2, 0.12);
      topK = k2;
    } else if (arch === TOWER || (arch === MID && shaft > 22)) {
      const split = shaft * (0.55 + rand() * 0.10);
      const k = 0.78 + rand() * 0.06;
      const shiftX = (rand() - 0.5) * w * 0.10;
      stage(y0, split, 1);
      stageAt(y0 + split - SINK, shaft - split + SINK, w * k, d * k, shiftX, 0);
      cap(y0 + split - SINK, 0.6 + SINK, 1, 0.12);
      topK = k;
    } else if (shaft > 14) {
      const split = shaft * 0.65;
      const k = 0.84 + rand() * 0.06;
      stage(y0, split, 1);
      stage(y0 + split - SINK, shaft - split + SINK, k);
      cap(y0 + split - SINK, 0.5 + SINK, 1, 0.12);
      cap(KERB_H + h - SINK, 0.7 + SINK, k, 0.12);
      lip(lipY, w * k + 0.12, d * k + 0.12);
      // a plant room, the way every office slab has one
      if (rand() < 0.6) {
        const [px, pz] = at((rand() - 0.5) * w * k * 0.3, (rand() - 0.5) * d * k * 0.3);
        out.roofs.push(mat4(px, lipY - 0.05, pz, angle, Math.max(3, w * k * 0.35), 3.0, Math.max(3, d * k * 0.35)));
      }
      topK = k;
    } else {
      stage(y0, shaft, 1);
      cap(KERB_H + h - SINK, 0.7 + SINK, 1, 0.1);
      lip(lipY, w + 0.1, d + 0.1);
    }

    if (arch === TOWER) {
      // Illuminated crown with spire for tall towers
      const ch1 = 2.0 + rand() * 1.5;
      out.crowns.push(mat4(wx, KERB_H + h + 0.6, wz, angle,
        w * topK * 0.60, ch1, d * topK * 0.60));

      if (shaft > 45 && rand() < 0.65) {
        const spireH = 12 + rand() * 14;
        out.masts.push(mat4(wx, KERB_H + h + ch1 + spireH / 2, wz, 0,
          0.22, spireH, 0.22));
      }
    } else if (!pitched && w > 12 && rand() < 0.4) {
      // Roof clutter on commercial mid-rises
      for (let i = 0, n = 1 + Math.floor(rand() * 2); i < n; i++) {
        const r = rand();
        out.plant[r < 0.5 ? 'ac' : r < 0.8 ? 'tank' : 'hut'].push(
          mat4(wx + (rand() - 0.5) * w * 0.5, KERB_H + h + 0.8,
               wz + (rand() - 0.5) * d * 0.5, rand() * 6.28, 1, 1, 1));
      }
    }
    return pitched;
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

        /* Edge line, then the kerb it runs alongside, then the pavement --
           but the kerb and the pavement are CLIPPED where they would land on
           another road's carriageway.

           Both used to be one unconditional ribbon per side, laid at a fixed
           offset from this edge's centreline with no idea what else was there.
           Wherever two roads run close and parallel -- which in a city grid is
           everywhere, and on the lift bridge is the deck beside its own
           approach -- one road's footpath was drawn straight over the other's
           lanes. Measured across the bridge deck at z=2450: tarmac from
           x=1917 to 1960 (two overlapping carriageways), and the pavement
           tiles sitting at x=1946 where tarmacDepth reads -12.8. You drove on
           the footpath while the physics said road. This is the same class of
           bug, and the same fix, as the 2026-08-31 pass that stopped props and
           parked cars standing in the road: ask tarmacDepth, which is the
           minimum over ALL nearby segments.

           No `exclude` is needed. The probe sits at half + 2.4, which is
           outside THIS edge's own half-width, so our own segment contributes
           +2.4 there; only another road's tarmac can drive it negative.

           Walked in 6 m steps and emitted as CONTIGUOUS RUNS, so a segment
           with nothing in the way still costs the single quad it always did
           and only a clipped one pays for extra geometry. */
        const STEP = 6;
        const clear = (o, t0, t1) => {
          const [cx, cz] = at(o, (t0 + t1) / 2);
          return this.district.tarmacDepth(cx, cz) > 0.2;
        };
        for (const side of [-1, 1]) {
          const o = side * (half - 0.45);
          ribbon(white, px0 + nx * o, pz0 + nz * o, px1 + nx * o, pz1 + nz * o, 0.15, 0.02);
          const kx = side * half, w = side * (half + 2.4);
          // the slab texture is 2.4m; without UVs the pavement is flat colour
          const u = 4.8 / 2.4;
          let runStart = null;
          const flush = (t1) => {
            if (runStart === null) return;
            const [qx, qz] = at(w, runStart), [rx, rz] = at(w, t1);
            ribbon(walk, qx, qz, rx, rz, 4.8, KERB_H, walkN);
            const v = (t1 - runStart) / 2.4;
            walkUv.push(0, 0, v, 0, v, u, 0, 0, v, u, 0, u);
            // the kerb face looks back at the road it edges; it runs with its pavement
            const [ka, kb] = at(kx, runStart), [kc, kd] = at(kx, t1);
            wall(kerb, kerbN, ka, kb, kc, kd, 0, KERB_H, -nx * side, -nz * side);
            runStart = null;
          };
          for (let t = s0; t < s1; t += STEP) {
            const t2 = Math.min(s1, t + STEP);
            if (clear(w, t, t2)) { if (runStart === null) runStart = t; }
            else flush(t);
          }
          flush(s1);
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
    const seen = new Set(), scrambled = new Set();
    const sigBatch = this.catalogue ? new InstanceBatch(this.catalogue) : null;
    const ly = (x, z) => this.district.elevationAt(x, z);

    /* Which approach at a junction carries the overhead gantry.
       The LOWEST-numbered wide edge at the node, cached. Lowest rather than a
       hash so it cannot depend on which chunk reached the node first: a node on
       a chunk seam is built from either side and must choose the same arm both
       times, or the board appears and disappears as you drive past. */
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

        /* Little Tokyo's four-way junctions are SCRAMBLE crossings, Shibuya's
           signature: two diagonal zebra rows through the junction centre on
           top of the four approach crossings. Once per node. */
        if (node.kind === 'cross' && !scrambled.has(end) && this.district.districtAt?.(node.x, node.y) === 'LITTLE TOKYO') {
          scrambled.add(end);
          /* Same convention as the approach zebra: a stripe's run direction
             (ddx, ddz) becomes yaw = atan2(-ddz, ddx) and the row steps along
             its perpendicular (-ddz, ddx). Built from the approach direction
             turned 45 degrees either way -- a yaw offset alone put the 26 m run
             across the row and the stripes merged into two white wedges. */
          /* Shibuya's diagonals are striped CROSSWALKS: a 4 m wide band along
             each diagonal whose stripes run across it (perpendicular to the
             walking direction), stepping along the band every 1.45 m. The
             first cut ran the stripes along the diagonal and they merged into
             solid wedges. */
          const c45 = Math.SQRT1_2, reach = half * 1.05;
          for (const sgn of [1, -1]) {
            const ddx = dx * c45 - sgn * dz * c45, ddz = dz * c45 + sgn * dx * c45;   // the walking direction
            const sx = -ddz, sz = ddx;                                             // the stripe runs across it
            const ys = Math.atan2(-sz, sx);
            // flatRect's first extent runs ACROSS the yaw direction here (measured: the 4 m run merged the row into a band), so the stripe's 0.62 goes first
            for (let k = -reach; k <= reach; k += 1.45) zebra.push(flatRect(node.x + ddx * k, 0.022, node.y + ddz * k, ys, 0.62, 4.0));
          }
        }

        /* WHERE FIVE OR MORE ROADS MEET, PAINT NOTHING (2026-09-14).
           Every marking below -- crossing, stop line, lane arrows -- is built
           from ONE approach and laid on the tarmac in front of it. That is
           right for a crossroads and nonsense past it: counted over the
           district file, 83 nodes have five or more roads meeting (50 five-way,
           29 six-way, one seven-way, three eight-way), so a six-way node drew
           SIX sets of crossing, stop line and arrows across the same few metres
           of asphalt, overlapping at every angle. That is the "road paintings
           colliding each other, you cannot tell which road goes where" report,
           and no amount of nudging the offsets fixes it -- the shapes are
           correct, there are just too many of them on one piece of ground.

           Bare asphalt reads as an open junction, which is honest. The real
           answer for these is a roundabout with an island and a circulating
           lane; until that exists, clean tarmac beats a white scribble. */
        if (this.#nodeDegree(end) >= 5) continue;

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
        /* Only the turn lanes and ONE through lane carry an arrow. A 34 m
           arterial derives four lanes an approach, so four approaches painted
           sixteen 5 m arrows into a junction that already carries four zebra
           crossings, four stop lines and (in Little Tokyo) two diagonal
           scramble crosswalks -- the tarmac disappeared under white paint.
           Real arterials mark the turn lanes and leave the through lanes bare. */
        for (let i = 0; i < lanes; i++) {
          const isTurn = (lanes > 1 && i === lanes - 1) || (lanes > 2 && i === 0);
          if (!isTurn && i !== 1) continue;
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
          /* ONE gantry per junction, on ONE approach (2026-09-14).
             This used to run per approach, so a wide crossroads got a board on
             every arm. Counted over the district file: 620 gantries across 337
             junctions, and 200 of those junctions carried TWO OR MORE -- 138
             with two, 42 with three, 19 with four, one with five. Standing at
             such a junction you are looking at a wall of identical boards
             facing different ways, which is what "so many boards on the road,
             next to each other, of no use" means.
             `gantryArm` is chosen once per NODE, so exactly one approach can
             carry it and the choice is stable per city seed. */
          if (e.width > 26 && ei === this.#gantryArm(end)) {
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
        /* Little Tokyo: a pedestrian lamp pair beside the mast -- stop over
           walk -- lit from this approach's own phase: walk when its cars are
           red. Two more lens instances, recoloured in updateSignals. */
        if (this.district.districtAt?.(node.x, node.y) === 'LITTLE TOKYO') {
          for (let k = 0; k < 2; k++) lens.push(mat4(px - dz * 0.36 + dx * 0.12, KERB_H + 2.45 - k * 0.3, pz + dx * 0.36 + dz * 0.12, -yaw, 0.8, 0.8, 0.8));
          meta.push({ node: node.id, axis, base: lens.length - 2, ped: true });
        }
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
    if (sigBatch) sigBatch.emit(group, { shadow: false, lod: 1 }).then(() => { group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); group.needsUpdate = true; })   // late-landing signal masts join the bundle too
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
        if (m.ped) {   // pedestrian pair: red man while cars flow, green man while they are held
          const walk = state === 'red';
          mesh.setColorAt(m.base, c.setHex(walk ? 0x2a0a08 : 0xff2a1c));
          mesh.setColorAt(m.base + 1, c.setHex(walk ? 0x2bd85a : 0x0a1408));
          continue;
        }
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
  *#buildSteps(ix, iz, group, chunkDist2 = 0) {
    const A = this.assets;
    const k = ck(ix, iz);
    let tLast = performance.now();
    /* A slice is the work BETWEEN two yields, and the budget only holds if
       every step calls tick(). `label` names the step so the worst slice can
       be attributed instead of guessed at: districtWorld.worstSlice keeps the
       longest one seen, and `?slices` logs anything over 8 ms as it happens.
       Costs one string compare per tick. */
    const self = this;
    let tLabel = 'start';
    /* A hard break between phases. It must reset the clock too: a bare `yield`
       left tLast pointing at the previous frame, so the next slice measured the
       time the generator sat PARKED and every worst-slice number was fiction. */
    const brk = function* (label) {
      const now = performance.now();
      const slice = now - tLast;
      if (slice > (self.worstSlice?.ms ?? 0)) self.worstSlice = { ms: slice, step: tLabel, chunk: k };
      if (LOG_SLICES && slice > 8) console.info(`[slice] ${slice.toFixed(1)}ms after ${tLabel} (chunk ${k})`);
      if (label) tLabel = label;
      yield;
      tLast = performance.now();
    };
    const tick = function* (label) {
      const now = performance.now();
      const slice = now - tLast;
      if (slice > (self.worstSlice?.ms ?? 0)) self.worstSlice = { ms: slice, step: tLabel, chunk: k };
      if (LOG_SLICES && slice > 8) console.info(`[slice] ${slice.toFixed(1)}ms after ${tLabel} (chunk ${k})`);
      if (label) tLabel = label;
      if (slice >= 1.8) {
        yield;
        tLast = performance.now();
      }
    };

    /* --- carriageway: one quad per segment, all merged into one mesh ---
       Overlaps at junctions are coplanar and the same colour, so the depth
       fight they provoke is invisible — far cheaper than mitring every join. */
    const D = this.district;
    const boxes = [];              // solid obstacles and footprints in this chunk
    const spanParts = new Map(), spanHeads = [];   // world/spans.js: pier/fascia/railing/soffit geo by material key, and its lamp heads
    const segs = this.segByChunk.get(k) ?? [];
    if (segs.length) {
      const pos = [], nor = [], uv = [];
      /* Structure under and beside any road that leaves the ground.
         Sampling deck height per corner made a bridge a ramp rather than a
         decal -- but only the top surface. From the bank you looked straight
         under the approach to the ground: no side faces, and the parapet in
         water.js sits at the fixed span height, so it neither follows the
         ramp nor exists on it. Both are emitted HERE, per segment, from the
         same corner heights the tarmac uses, so they cannot disagree with it. */
      const sk = [], skN = [], skUv = [];      // skirt: deck edge down to ground
      /* Every quad here is emitted through `face`, which checks the geometric
         normal of the first triangle against the normal the caller INTENDS and
         reverses the corner order if they disagree. The two edges of a road
         face opposite ways but are built by the same code, so hand-ordering
         the corners gets exactly one side back-culled -- the junction paint
         hit the identical trap (see tri() in #signals). Correct once, here. */
      const face = (out, nrm, uvs, c0, c1, c2, c3, n, uvq) => {
        const e1 = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
        const e2 = [c2[0] - c0[0], c2[1] - c0[1], c2[2] - c0[2]];
        const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const flip = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0;
        const [p0, p1, p2, p3] = flip ? [c0, c3, c2, c1] : [c0, c1, c2, c3];
        const [t0, t1, t2, t3] = flip ? [uvq[0], uvq[3], uvq[2], uvq[1]] : uvq;
        out.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
        for (let i = 0; i < 6; i++) nrm.push(n[0], n[1], n[2]);
        uvs.push(...t0, ...t1, ...t2, ...t0, ...t2, ...t3);
      };
      const wall = (out, nrm, uvs, ax, ay, az, bx, by, bz, y0a, y0b, ox, oz) => {
        // a vertical quad from (a,b) at heights [y0..ay],[y0..by], facing (ox,oz)
        const L = Math.hypot(bx - ax, bz - az) / 2.4;
        const ha = (ay - y0a) / 2.4, hb = (by - y0b) / 2.4;
        face(out, nrm, uvs, [ax, y0a, az], [bx, y0b, bz], [bx, by, bz], [ax, ay, az],
             [ox, 0, oz], [[0, 0], [L, 0], [L, hb], [0, ha]]);
      };
      const top = (out, nrm, uvs, ax, ay, az, bx, by, bz, ox, oz, t) => {
        // the parapet's cap, `t` thick, spanning from the edge inward
        const ix = -ox * t, iz = -oz * t;
        const L = Math.hypot(bx - ax, bz - az) / 2.4;
        face(out, nrm, uvs, [ax, ay, az], [bx, by, bz], [bx + ix, by, bz + iz], [ax + ix, ay, az + iz],
             [0, 1, 0], [[0, 0], [L, 0], [L, t / 2.4], [0, t / 2.4]]);
      };
      for (const id of segs) {
        yield* tick('roads+spans');
        const s = this.district.segments[id];
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const L = Math.hypot(dx, dz) || 1;
        const nx = (-dz / L) * s.half, nz = (dx / L) * s.half;
        const q = [
          [s.ax + nx, s.az + nz], [s.bx + nx, s.bz + nz],
          [s.bx - nx, s.bz - nz], [s.ax - nx, s.az - nz],
        ];
        const tri = [q[0], q[1], q[2], q[0], q[2], q[3]];
        /* Deck height: sampled at the two END CENTRES, then applied flat across
           the width. Sampling each CORNER instead made a road ramp along AND
           bank across, and spanHeight is a cliff -- full height inside a band
           of half+5.5 about the bridge polyline, zero outside it. Where the
           road graph does not sit exactly on that polyline (on HALSTEAD LIFT
           BRIDGE it runs ~16 m west of it) one kerb landed inside the band and
           the other outside, so the signature bridge was banked 7.6 m across
           its 28 m width for 480 m, with one kerb on the ground. 51 of the
           163 elevated segments had their two long edges more than a metre
           apart. A real deck is flat across and ramped along, which is exactly
           what sampling the centreline gives. */
        const decA = D.elevationAt(s.ax, s.az), decB = D.elevationAt(s.bx, s.bz);
        const deckY = (px, pz) => {
          const t = L > 0.001 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / (L * L))) : 0;
          return decA + (decB - decA) * t;
        };
        for (const [px, pz] of tri) {
          pos.push(px, deckY(px, pz), pz);
          nor.push(0, 1, 0);
        }
        // the tile is 18.4m square; stretching one across a 34m carriageway is
        // what turned every arterial into a car park with faint stripes on it
        const v = L / 18.4, u = (s.half * 2) / 18.4;
        uv.push(0, 0, v, 0, v, u, 0, 0, v, u, 0, u);

        // elevated? then this segment gets sides
        const e0 = deckY(q[0][0], q[0][1]), e1 = deckY(q[1][0], q[1][1]);
        const e3 = deckY(q[3][0], q[3][1]), e2 = deckY(q[2][0], q[2][1]);
        if (Math.max(e0, e1, e2, e3) > 0.12) {
          /* Piers, fascia, railing, soffit, lamps, joints, abutment --
             world/spans.js. Clipped to this chunk so the neighbour builds the
             other half. NOT on the signature bridge: world/liftBridge.js
             builds that one whole, its own piers and railings included. */
          const sp = signatureBridge(s, D) ? null : buildSpan(s, D, {
            bounds: { x0: ix * CHUNK, z0: iz * CHUNK, x1: (ix + 1) * CHUNK, z1: (iz + 1) * CHUNK },
          });
          if (sp) {
            for (const p of sp.parts) (spanParts.get(p.mat) ?? spanParts.set(p.mat, []).get(p.mat)).push(p.geo);
            for (const lp of sp.lamps) spanHeads.push(lp);
            for (const b of sp.solids) boxes.push(b);
          }
          const ground = (px, pz) => (D.inWater && D.inWater(px, pz) ? -2.6 : 0);
          for (const [a, b, ox, oz] of [
            [q[0], q[1],  nx / s.half,  nz / s.half],   // one edge, facing out
            [q[3], q[2], -nx / s.half, -nz / s.half],   // the other
          ]) {
            const ya = deckY(a[0], a[1]), yb = deckY(b[0], b[1]);   // the deck's own height, so the skirt and parapet cannot disagree with the tarmac
            /* Over water, or wherever spans.js carries this deck on piers, the
               skirt is the 0.9 m soffit band those piers hold up -- not a dam to
               the riverbed, and not a wall with the piers hidden inside it. On a
               land embankment it stays a wall. `carried` is the UNCLIPPED answer,
               so every chunk drawing this segment's skirt agrees which it is. */
            const carried = !!(sp && sp.carried);
            wall(sk, skN, skUv, a[0], ya, a[1], b[0], yb, b[1],
                 skirtFoot(ya, carried || D.inOpenWater?.(a[0], a[1]), s.cls),
                 skirtFoot(yb, carried || D.inOpenWater?.(b[0], b[1]), s.cls), ox, oz);
            /* The parapet used to be a blank 1 m wall along this edge -- the
               single worst thing about a bridge here. world/spans.js builds a
               low upstand and a post-and-rail railing you can see the water
               through, and returns the matching collision boxes in sp.solids,
               so both the geometry and the barrier come from one place. */
          }
        }
      }
      const concrete = this.catalogue?.materials.get('concrete_cast') ?? A.mat.kerbFace;
      for (const [arr, nrm, uvs] of [[sk, skN, skUv]]) {
        if (!arr.length) continue;
        const sg = new THREE.BufferGeometry();
        sg.userData.owned = true;
        sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
        sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
        sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        const sm = new THREE.Mesh(sg, concrete);
        sm.castShadow = true; sm.receiveShadow = true;
        group.add(sm);
      }
      const g = new THREE.BufferGeometry();
      g.userData.owned = true;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      const road = new THREE.Mesh(g, A.mat.tarmac);
      road.receiveShadow = true;
      group.add(road);
      /* Road wear (world/decals.js): repairs, oil, rubber, kerb salt, gully
         stains -- ONE instanced draw a chunk. Seeded per road SEGMENT and per
         junction NODE, so the chunk next door generates the identical stream and
         `bounds` keeps only its own half: no doubled wear at a seam. Built inside
         the generator, so it lands before the bundle records. Measured district
         wide: mean 111 a chunk, worst 308, cap 400, ~0.6 ms. */
      const wear = buildDecals(segs.map((id) => this.district.segments[id]), this.district, 0x5ea1,
        { bounds: { x0: ix * CHUNK, z0: iz * CHUNK, x1: (ix + 1) * CHUNK, z1: (iz + 1) * CHUNK } });
      if (wear.count) {
        const dg = decalGeometry();
        dg.userData.owned = true;
        const dm = new THREE.InstancedMesh(dg, decalMaterial(), wear.count);
        wear.matrices.forEach((m, i) => dm.setMatrixAt(i, m));
        dg.setAttribute('aTile', new THREE.InstancedBufferAttribute(wear.tiles, 2));
        dg.setAttribute('aFade', new THREE.InstancedBufferAttribute(wear.fades, 1));
        dm.instanceMatrix.needsUpdate = true;
        dm.computeBoundingSphere();
        dm.receiveShadow = true;       // no cast: a 12 mm quad's shadow is the road's own
        group.add(dm);
      }
    }
    yield* brk('blocks');

    /* --- blocks: a raised slab is its own kerb, and buildings stand on it --- */
    const blocks = this.blkByChunk.get(k) ?? [];
    const kitPlaced = {};          // kit -> [geometry with matrix applied] (whole Kenney buildings)
    const tokyoParts = [], tokyoBoards = [], tokyoProps = [], tokyoHeads = [];   // Little Tokyo: our own buildings (world/tokyo.js), one mesh per chunk
    const artParts = new Map();    // the self-built styles (world/artBuildings.js): material key -> [geo], one mesh per key per chunk; boards and lamps ride tokyoBoards / tokyoHeads
    const slabs = { block: [], park: [], lot: [], vacant: [] };
    const facades = {}, bases = {};
    const roofs = [], glassRoofs = [], crowns = [], masts = [], gables = [];
    const plant = { ac: [], tank: [], hut: [] };
    const slabGeo = A.geo.box;

    let massed = 0;
    for (const bl of blocks) {
      const kind = bl.type === 'park' ? 'park'
                 : bl.type === 'lot' ? 'lot'
                 : bl.type === 'vacant' ? 'vacant' : 'block';
      slabs[kind].push(mat4(bl.x, 0, bl.y, bl.angle, bl.w, KERB_H, bl.h));

      // Little Tokyo's park block carries a small shrine at its centre, in the Tokyo mesh
      if (bl.district === 'LITTLE TOKYO' && bl.type === 'park' && !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('notokyo'))) {
        const sh = buildShrine(bl.id);
        const shM = mat4(bl.x, KERB_H, bl.y, bl.angle, 1, 1, 1);
        sh.geo.applyMatrix4(shM);
        tokyoParts.push(sh.geo);
        // the two stone lanterns are warm night-light candidates (the same pool the kanban and lamp heads feed)
        for (const side of [-1, 1]) { const lp = new THREE.Vector3(-2.5, 2.55, side * 3.6).applyMatrix4(shM); tokyoHeads.push({ x: lp.x, y: lp.y, z: lp.z, colour: 0xffb060 }); }
        // the hall is solid (the torii you may drive through, as in life): its centre is 5.2 m behind the apron centre, in the block's frame
        const hca = Math.cos(bl.angle), hsa = Math.sin(bl.angle);
        boxes.push({ x: bl.x + (-5.2) * hca, z: bl.y + (-5.2) * hsa, angle: bl.angle, hw: 1.6, hd: 1.8, height: 3.0, district: bl.district, tokyo: true });
      }
      const arch = ARCHETYPE[bl.type];
      if (!arch) continue;
      const range = HEIGHT[bl.type] || [10, 20];
      for (const g of this.district.buildingsOf(bl.id)) {
        yield* tick('massing/art/tokyo');
        const scale = DISTRICT_SCALE[bl.district] ?? 1;
        const h = (range[0] + hash(g.x + bl.x, g.y + bl.y) * (range[1] - range[0])) * scale;
        // local footprint -> world, through the block's own transform
        const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
        const lx = g.x + g.w / 2, lz = g.y + g.d / 2;
        const wx = bl.x + lx * ca - lz * sa;
        const wz = bl.y + lx * sa + lz * ca;
        /* A whole kit building instead of the box, where the district builds that
           way (kitBuildings.js). Height stays in the model's proportion to its
           footprint, so a scaled house is house-height and a skyscraper towers. */
        /* Little Tokyo builds its own (world/tokyo.js): no kit, no generic
           massing, no kit facade dressing. The footprint's street side is found
           by probing tarmac depth around it; the building is built facing +X and
           turned onto that side, then through the block's transform. Its sign
           boards join the chunk's atlas quads. ?notokyo restores the old massing. */
        const noTokyo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('notokyo');
        /* Hoisted: the Tokyo branch below runs FIRST and used to take every
           Little Tokyo footprint, so a style the art router claims (glass
           towers, since 2026-09-13) could never land there. Same roll the art
           branch uses further down, so a footprint resolves to exactly one. */
        /* An authored terrace wins the row plots of its own district, ahead of
           the procedural style. These are the districts artBuildings.js flags
           as a language mismatch -- gable-ended hill terraces for MARROW HILL,
           inter-war render for ASHMOOR -- and at 308-636 triangles against
           brickRow's 1,207 mean they cost a third as much. They go into
           artParts by material key like any other art building, so they merge
           per key per chunk: real library textures, no extra draws. */
        /* A big industrial yard becomes a compound rather than one capped
           warehouse on an empty plot. Same artParts merge as the terraces. */
        if (this.industrial && INDUSTRIAL.has(bl.district) && bl.type === 'yard' && g.w >= 60 && g.d >= 50) {
          const yard = industrialYard(this.industrial, wx * 13.7 + wz * 5.1, g.w / 2, g.d / 2);
          if (yard) {
            const My = new THREE.Matrix4().makeRotationY(-bl.angle);
            My.setPosition(wx, KERB_H, wz);
            for (const p of yard.parts) { p.geo.applyMatrix4(My); (artParts.get(p.mat) ?? artParts.set(p.mat, []).get(p.mat)).push(p.geo); }
            boxes.push({ x: wx, z: wz, angle: bl.angle, hw: g.w / 2, hd: g.d / 2, height: yard.height, district: bl.district, art: true });
            continue;
          }
        }

        if (this.terraces && TERRACES[bl.district] && g.w >= 6 && g.d >= 6) {
          const toWorldT = (lx, lz) => [wx + lx * ca - lz * sa, wz + lx * sa + lz * ca];
          const rotT = frontRotation((x, z) => this.district.tarmacDepth(x, z), toWorldT, g.w / 2, g.d / 2);
          const swapT = Math.abs(rotT) > Math.PI / 4 && Math.abs(Math.abs(rotT) - Math.PI) > 1e-6;
          const tr = terraceFor(this.terraces, bl.district, wx * 7.31 + wz * 3.17,
            swapT ? g.d / 2 : g.w / 2, swapT ? g.w / 2 : g.d / 2, h);
          if (tr) {
            const Mt = new THREE.Matrix4().makeRotationY(-bl.angle).multiply(new THREE.Matrix4().makeRotationY(rotT));
            Mt.setPosition(wx, KERB_H, wz);
            for (const p of tr.parts) { p.geo.applyMatrix4(Mt); (artParts.get(p.mat) ?? artParts.set(p.mat, []).get(p.mat)).push(p.geo); }
            boxes.push({ x: wx, z: wz, angle: bl.angle, hw: swapT ? g.d / 2 : g.w / 2, hd: swapT ? g.w / 2 : g.d / 2, height: tr.height, district: bl.district, art: true });
            continue;
          }
        }

        const artStyle = styleFor(bl, g, hash(wx * 0.53, wz * 0.91));
        if (bl.district === 'LITTLE TOKYO' && !noTokyo && !artStyle && g.w >= 4 && g.d >= 4) {
          const toWorld = (lx, lz) => [wx + lx * ca - lz * sa, wz + lx * sa + lz * ca];
          const rot = frontRotation((x, z) => this.district.tarmacDepth(x, z), toWorld, g.w / 2, g.d / 2);
          const swap = Math.abs(rot) > Math.PI / 4 && Math.abs(Math.abs(rot) - Math.PI) > 1e-6;   // a +/-90 turn swaps the footprint axes
          const fhw = swap ? g.d / 2 : g.w / 2, fhd = swap ? g.w / 2 : g.d / 2;

          /* One footprint in three gets one of Arun's authored neon towers
             instead of a generated building, wherever one fits the plot without
             being stretched (towerFor refuses past 1.6x/0.5x -- past that the
             signage smears and it reads worse than a built one). They are baked
             into the same color/emit/flick vertex format as the rest of this
             mesh, so they MERGE into it and cost no extra draw; drawn as they
             ship, 13 materials a building would be 13 draws each. Falls through
             to the generated building when the GLBs have not landed yet (the
             load is async and chunks build from frame one) or none fits. */
          if (this.towers && hash(wx * 0.19, wz * 0.83) < 0.08) {
            // the plot's own world position is the seed, so the choice is stable per building
            const tw = towerFor(this.towers, wx * 7.31 + wz * 3.17, fhw, fhd, h);
            if (tw) {
              const Mt = new THREE.Matrix4().makeRotationY(-bl.angle).multiply(new THREE.Matrix4().makeRotationY(rot));
              Mt.setPosition(wx, KERB_H, wz);
              tw.geo.applyMatrix4(Mt);
              tokyoParts.push(tw.geo);
              boxes.push({ x: wx, z: wz, angle: bl.angle, hw: swap ? fhd : fhw, hd: swap ? fhw : fhd, height: tw.height, district: bl.district, tokyo: true });
              continue;
            }
          }

          const b = buildTokyoBuilding(Math.floor(hash(wx * 0.71, wz * 0.29) * 1e9), fhw, fhd, h);
          // local (front +X) -> footprint local (turned onto the street side) -> world (the block's frame), same rotation sense as mat4()
          const M = new THREE.Matrix4().makeRotationY(-bl.angle).multiply(new THREE.Matrix4().makeRotationY(rot));
          /* Image 11 shops sit ON the kerb. Footprints are inset in the block,
             so the camera saw a 26 m void and a blank lot wall. Walk the front
             face to the pavement: retreat while it is in the road, advance
             while it is too far back, and stop in the 0.5-1.15 m dead band
             (which is why this cannot oscillate).

             BOTH directions loop. Measured over all 219 Little Tokyo
             footprints: 95 of them ship with the front face ALREADY inside the
             carriageway -- median 3.8 m in, worst 12.7 m -- so a single 0.45 m
             step back left a shopfront standing in the road. Retreat needs the
             full 14 m; the advance is capped at 6 m so an interior plot with no
             street in front of it stays where the planner put it instead of
             drifting 15 m into its neighbour. */
          const dir = new THREE.Vector3(1, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(-bl.angle).multiply(new THREE.Matrix4().makeRotationY(rot)));
          const MAX_OUT = 6.0, MAX_BACK = 14.0;
          let sx = wx, sz = wz, out = 0, back = 0;
          for (let i = 0; i < 48; i++) {
            const d = this.district.tarmacDepth(sx + dir.x * fhw, sz + dir.z * fhw);
            if (d < 0.5) {
              if (back >= MAX_BACK) break;
              sx -= dir.x * 0.45; sz -= dir.z * 0.45; back += 0.45; out -= 0.45;
              continue;
            }
            if (d < 1.15 || out >= MAX_OUT) break;
            sx += dir.x * 0.55; sz += dir.z * 0.55; out += 0.55;
          }
          M.setPosition(sx, KERB_H, sz);
          b.geo.applyMatrix4(M);
          tokyoParts.push(b.geo);
          const _p = new THREE.Vector3();
          for (const lp of b.lamps ?? []) { _p.set(lp.x, lp.y, lp.z).applyMatrix4(M); tokyoHeads.push({ x: _p.x, y: _p.y, z: _p.z, colour: lp.colour, neon: lp.neon, intensity: lp.intensity, range: lp.range, glare: lp.glare }); }   // the kanban as candidates for the real night lights
          for (const bd of b.boards) {
            _p.set(bd.x, bd.y, bd.z).applyMatrix4(M);
            const yaw = bd.yaw + rot - bl.angle;   // the same two turns, applied to the board's facing
            const [u, v] = tileUv(Math.floor(hash(_p.x * 0.37 + bd.y, _p.z * 1.3) * SIGN_TILES), true);
            if (bd.vertical) {
              // roll the quad a quarter turn about its normal: the tile's long axis runs up the column
              const m = new THREE.Matrix4().compose(_p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ')), new THREE.Vector3(bd.h, bd.w, 1));
              tokyoBoards.push({ m, u, v });
            } else tokyoBoards.push({ m: mat4(_p.x, _p.y, _p.z, -yaw, bd.w, bd.h, 1), u, v });
          }
          boxes.push({ x: sx, z: sz, angle: bl.angle, hw: g.w / 2, hd: g.d / 2, height: b.height, district: bl.district, tokyo: true });
          // kerbside life in front of it (kit props, placed by us): a vending machine at one corner, sometimes an A-frame or a stall
          {
            const fw = swap ? g.w / 2 : g.d / 2, fhw = swap ? g.d / 2 : g.w / 2;   // the built building's half sizes
            const q = new THREE.Vector3(), r0 = hash(wz * 0.53, wx * 0.11);
            const put = (name, lx, lz) => { q.set(lx, 0, lz).applyMatrix4(M); tokyoProps.push({ name, x: q.x, z: q.z, yaw: rot - bl.angle }); };
            if (r0 < 0.45) put('props/a_frame_sign', fhw + 1.3, -fw * 0.3);
            if (r0 > 0.7 && fw > 3) put('props/market_stall', fhw + 1.9, 0.6);
          }
          continue;
        }
        /* The self-built styles (world/buildings/*, dispatched by
           world/artBuildings.js) take the Tokyo route: built facing +X, turned
           onto the street side, then through the block's frame. Parts are kept
           per material key so a wall can wear the library's brick PBR; boards
           and lamps join the chunk's atlas quads and light heads like the
           kanban. A plot bigger than the style's envelope is clipped to it
           with the street face left where it is (the rest of the plot is
           apron); the collision box is the built footprint. ?noart / ?artall. */
        const style = artStyle;
        if (style) {
          const toWorld = (lx, lz) => [wx + lx * ca - lz * sa, wz + lx * sa + lz * ca];
          const rot = frontRotation((x, z) => this.district.tarmacDepth(x, z), toWorld, g.w / 2, g.d / 2);
          const swap = Math.abs(rot) > Math.PI / 4 && Math.abs(Math.abs(rot) - Math.PI) > 1e-6;   // a +/-90 turn swaps the footprint axes
          const [cw, cd] = ART_CAP[style];
          const fhw = swap ? g.d / 2 : g.w / 2, fhd = swap ? g.w / 2 : g.d / 2;   // the plot's half sizes in the building's frame (+X street)
          const bhw = Math.min(fhw, cw), bhd = Math.min(fhd, cd);
          const b = buildArt(style, Math.floor(hash(wx * 0.71, wz * 0.29) * 1e9), bhw, bhd, h, { rgb: bl.district === 'LITTLE TOKYO' });
          const M = new THREE.Matrix4().makeRotationY(-bl.angle).multiply(new THREE.Matrix4().makeRotationY(rot));
          M.setPosition(wx, KERB_H, wz);
          if (fhw > bhw) M.multiply(new THREE.Matrix4().makeTranslation(fhw - bhw, 0, 0));   // clipped: slide the building up to the street edge
          for (const p of b.parts) { p.geo.applyMatrix4(M); (artParts.get(p.mat) ?? artParts.set(p.mat, []).get(p.mat)).push(p.geo); }
          const _p = new THREE.Vector3();
          for (const lp of b.lamps ?? []) { _p.set(lp.x, lp.y, lp.z).applyMatrix4(M); tokyoHeads.push({ x: _p.x, y: _p.y, z: _p.z, colour: lp.colour, neon: lp.neon, intensity: lp.intensity, range: lp.range, glare: lp.glare }); }
          for (const bd of b.boards ?? []) {   // same as the Tokyo branch above
            _p.set(bd.x, bd.y, bd.z).applyMatrix4(M);
            const yaw = bd.yaw + rot - bl.angle;
            const [u, v] = tileUv(Math.floor(hash(_p.x * 0.37 + bd.y, _p.z * 1.3) * SIGN_TILES), true);
            if (bd.vertical) {
              const m = new THREE.Matrix4().compose(_p.clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ')), new THREE.Vector3(bd.h, bd.w, 1));
              tokyoBoards.push({ m, u, v });
            } else tokyoBoards.push({ m: mat4(_p.x, _p.y, _p.z, -yaw, bd.w, bd.h, 1), u, v });
          }
          _p.set(0, 0, 0).applyMatrix4(M);   // the built footprint's centre (moved if clipped), half sizes back in the block's frame
          boxes.push({ x: _p.x, z: _p.z, angle: bl.angle, hw: swap ? bhd : bhw, hd: swap ? bhw : bhd, height: b.height, district: bl.district, art: true });
          continue;
        }
        const noKit = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nokit');
        const kd = noKit ? null : KIT_DISTRICT[bl.district];
        const kits = this.assets.kitBuildings;
        const kit = kd && kits?.[kd[0]];
        if (kit && hash(wx * 0.37, wz * 0.61) < kd[1] && g.w > 6 && g.d > 6) {
          const wantTall = bl.type === 'tower' || (bl.type === 'mid' && h > 30);
          const m = pickKitModel(kit, g.w, g.d, wantTall, hash(wz, wx));
          const sx = g.w / m.w, sz = g.d / m.d;
          const minS = Math.min(sx, sz);
          const sy = wantTall ? Math.max(minS * 1.25, Math.min(minS * 3.2, h / m.h)) : minS;
          const geo = m.geo.clone().applyMatrix4(new THREE.Matrix4().compose(
            new THREE.Vector3(wx, KERB_H, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bl.angle, 0)), new THREE.Vector3(sx, sy, sz)));
          (kitPlaced[kd[0]] ??= []).push(geo);
          boxes.push({ x: wx, z: wz, angle: bl.angle, hw: g.w / 2, hd: g.d / 2, height: m.h * sy, district: bl.district, kit: true });
          continue;
        }
        const pitched = this.#massing(arch, wx, wz, bl.angle, g.w, g.d, h,
                      { bases, facades, roofs, glassRoofs, crowns, masts, plant, gables }, bl.district, chunkDist2);
        boxes.push({ x: wx, z: wz, angle: bl.angle, hw: g.w / 2, hd: g.d / 2, height: h, district: bl.district, pitched });
      }
    }

    yield* brk('streetFurniture');
    this.#streetFurniture(this.edgeByChunk.get(k) ?? [], group);
    yield* brk('signals');
    this.#signals(this.edgeByChunk.get(k) ?? [], group, k);
    yield* brk('lamps');

    /* Lamps every 30m down each segment, alternating sides. The old procedural
       city got all its night light from these; the district world shipped
       without a single one, which is why Halstead Bay looked like a dark plain
       rather than a lit street. */
    const lamps = [], heads = [], pools = [], solidParked = [];
    const parked = {}, parkedCol = {};       // keyed by silhouette
    const dressed = !!this.catalogue;
    // one bucket per species, so a street never plants the same tree twice over
    const trees = { plane: [], pine: [], poplar: [], palm: [], sakura: [], ginkgo: [], willow: [], red_maple: [], autumn_oak: [], cypress: [], magnolia: [] };
    const leafCol = { plane: [], pine: [], poplar: [], palm: [], sakura: [], ginkgo: [], willow: [], red_maple: [], autumn_oak: [], cypress: [], magnolia: [] };
    for (const id of segs) {
      yield* tick('lamp rows');
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
        const onTarmac = this.district.tarmacDepth(px, pz) <= 0.2;
        /* With a catalogue loaded the authored lamp and its light pool come
           from dressing.js instead, placed by the same loop -- keeping both
           would stand a box lamp inside every real one. Trees used to ride
           that continue, so a dressed city only had the kit cube canopy. */
        if (!dressed && !onTarmac) {
          lamps.push(mat4(px, KERB_H + ly, pz, -yaw, 1, 1, 1));
          solidParked.push({ x: px, z: pz, yaw: 0, offsets: [0],
                             radius: 0.22, reach: 0.6, tag: 'prop' });
          heads.push(mat4(px, KERB_H + ly, pz, -yaw, 1, 1, 1));
          const hx = px + Math.cos(yaw) * 1.42, hz = pz - Math.sin(yaw) * 1.42;
          pools.push(flat(hx, 0.03 + ly, hz, 13));
        }
        if (!onTarmac && hash(px, pz) < 0.35) {
          /* 10 Masterpiece Species follow the district and street class:
             - Little Tokyo: Sakura (Cherry blossom), Ginkgo, Japanese Red Maple, Weeping Willow
             - Marrow Hill / Suburbs: Magnolia, Autumn Oak, London Plane
             - Waterfront / Boundary: Royal Palm, Coastal Pine
             - Arterials & Avenues: Italian Cypress, Poplar, Plane */
          const r = hash(pz * 1.7, px * 0.9);
          const isTokyo = this.district.name === 'LITTLE TOKYO' || (px > 1950 && px < 2400 && pz > 1300 && pz < 1850);
          const isWater = s2.cls === 'boundary' || Math.hypot(px - 1850, pz - 2150) < 500;
          const sp = isTokyo ? (r < 0.45 ? 'sakura' : r < 0.70 ? 'ginkgo' : r < 0.88 ? 'red_maple' : 'willow')
                   : isWater ? (r < 0.65 ? 'palm' : 'pine')
                   : s2.cls === 'arterial' ? (r < 0.40 ? 'cypress' : r < 0.70 ? 'poplar' : 'plane')
                   : r < 0.30 ? 'magnolia' : r < 0.55 ? 'autumn_oak' : r < 0.80 ? 'plane' : 'pine';
          const sc = 0.85 + hash(px, pz) * 0.45;
          const tx = px + nx * 2.2 * side, tz = pz + nz * 2.2 * side;
          if (this.district.tarmacDepth(tx, tz) > 0.2) {
            const ty = KERB_H + this.district.elevationAt(tx, tz);
            trees[sp].push(mat4(tx, ty, tz, hash(pz, px) * 6.28, sc, sc * (0.9 + hash(px, pz) * 0.3), sc));
            solidParked.push({ x: tx, z: tz, yaw: 0, offsets: [0],
                               radius: 0.34, reach: 0.7, tag: 'prop' });
            const col = sp === 'sakura' ? 0xffb7c5
                      : sp === 'ginkgo' ? 0xe5cc28
                      : sp === 'red_maple' ? 0xd61c28
                      : sp === 'willow' ? 0x6bb854
                      : sp === 'autumn_oak' ? 0xe67e22
                      : sp === 'magnolia' ? 0x27ae60
                      : sp === 'cypress' ? 0x1e5631
                      : LEAF[Math.floor(r * LEAF.length)];
            leafCol[sp].push(leafTint(A, sp, col));
          }
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
            // enough to find and hide this exact instance when it gets stolen
            body: bk, index: parked[bk].length - 1, chunk: k,
            colour: parkedCol[bk][parkedCol[bk].length - 1],
          });
        }
      }
    }

    /* Parks: the kit tree_broadleaf is a chamfered box (lod1 reads as a cube).
       Same species instances as the kerb, so a park does not add a draw. */
    for (const bl of blocks) {
      if (bl.type !== 'park') continue;
      const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
      const step = 11;
      for (let lx = -bl.w / 2 + 7; lx < bl.w / 2 - 7; lx += step) {
        for (let lz = -bl.h / 2 + 7; lz < bl.h / 2 - 7; lz += step) {
          const r = hash(bl.x + lx, bl.y + lz);
          if (r > 0.55) continue;
          const jx = lx + (hash(lz, lx) - 0.5) * step * 0.6;
          const jz = lz + (hash(lx, lz) - 0.5) * step * 0.6;
          const px = bl.x + jx * ca - jz * sa;
          const pz = bl.y + jx * sa + jz * ca;
          if (this.district.tarmacDepth(px, pz) <= 0.5) continue;
          if (this.district.landmarkKeepOut?.(px, pz)) continue;   // not inside the bandstand or the palm house
          const sp = r < 0.55 ? 'plane' : r < 0.78 ? 'poplar' : 'pine';
          const sc = 1.05 + hash(pz, px) * 0.55;
          const py = KERB_H + this.district.elevationAt(px, pz);
          trees[sp].push(mat4(px, py, pz, hash(px, pz) * 6.28, sc, sc * (0.9 + hash(px, pz) * 0.25), sc));
          leafCol[sp].push(leafTint(A, sp, LEAF[Math.floor(hash(px * 1.3, pz) * LEAF.length)]));
          solidParked.push({ x: px, z: pz, yaw: 0, offsets: [0], radius: 0.38, reach: 0.8, tag: 'prop' });
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
      yield* brk('dressChunk');
      dressChunk(batch, {
        segments: segs.map((id) => this.district.segments[id]),
        blocks, district: this.district, solids: solidParked, pools: dressPools,
        heads: dressHeads,
      });
      // emissive caps on the authored lamps, so the heads bloom at night
      for (const hd of dressHeads) heads.push(mat4(hd.x, hd.y, hd.z, -hd.yaw, 1, 1, 1));
      // lamp-head positions for game/lighting.js: the pool of real lights follows the nearest
      this.headsByChunk.set(k, [...dressHeads.map((hd) => ({ x: hd.x, y: hd.y, z: hd.z })), ...tokyoHeads, ...spanHeads]);
      // glare sprites on every head (GTA-style; world/glare.js): one instanced Sprite per chunk, fades in with the night
      { const gl = buildGlare([...dressHeads, ...tokyoHeads, ...spanHeads], ix * 31 + iz); if (gl) group.add(gl); }
      yield* brk('dressRoofs');
      // sliced: one big dressRoofs was a 10+ ms step against a 4 ms budget
      const dressable = boxes.filter((b) => !b.tokyo && !b.art);   // Little Tokyo and the self-built styles dress themselves (tokyo.js, artBuildings.js)
      /* One building at a time, yielding on the CLOCK rather than on a count.
         A fixed batch cannot know what it is about to cost: measured, 10
         buildings of facade dressing took 25 ms in a single slice -- a dropped
         frame every time you crossed into a dense chunk. tick() yields only
         once 1.8 ms has actually gone, so cheap buildings still batch up and
         an expensive one yields immediately. Same total work, spread. */
      for (let i = 0; i < dressable.length; i++) { dressRoofs(batch, dressable.slice(i, i + 1), this.district); yield* tick('dressRoofs'); }

      /* Facades are their own batch and their own group. They are far and away
         the most expensive thing in the kit -- a dressed frontage is roughly a
         thousand triangles -- so they get a tighter visibility ring than the
         street furniture, set in update(). */
      const faces = new THREE.Group();
      faces.name = 'facades';
      group.add(faces);
      this.facadeGroups.set(k, faces);
      const fbatch = new InstanceBatch(this.catalogue);
      const signs = [...tokyoBoards], windows = [];   // Little Tokyo's kanban and fascias ride the same atlas quads
      for (const p of tokyoProps) fbatch.add(p.name, placeAsset(p.x, KERB_H, p.z, p.yaw));   // and its kerbside props
      // sliced: the frontage walk (modules, signs, windows, side walls) was the worst step
      for (let i = 0; i < dressable.length; i++) { dressFacades(fbatch, dressable.slice(i, i + 1), this.district, roadDepth, signs, windows); yield* tick('dressFacades'); }   // see dressRoofs above: yield on the clock, not on a count
      /* Phase 1: the shop signs, one instanced draw per chunk. Per-instance
         atlas cell in aTile; the quad's width/height ride the matrix. They
         live in the facade group so they share its tighter visibility ring.
         No shadow: a 0.85m board's shadow is a smear on the wall behind it. */
      if (signs.length) {
        const sg = A.geo.sign.clone();
        sg.userData.owned = true;
        const tiles = new Float32Array(signs.length * 2);
        const sm = new THREE.InstancedMesh(sg, A.mat.sign, signs.length);
        signs.forEach((s, i) => { sm.setMatrixAt(i, s.m); tiles[i * 2] = s.u; tiles[i * 2 + 1] = s.v; });
        sg.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
        sm.instanceMatrix.needsUpdate = true;
        sm.computeBoundingSphere();
        sm.receiveShadow = true;
        /* Phase 5: one warm doorway per ~12 shopfronts, pooled by game/lighting.js.
           The sign boards ARE the shopfronts, so they are the cheapest honest
           source of "a lit door someone walks out of". */
        { const hero = this.heroLightsByChunk.get(k) ?? [];
          for (let i = 3; i < signs.length; i += 12) {
            const p = new THREE.Vector3().setFromMatrixPosition(signs[i].m);
            hero.push({ x: p.x, y: Math.max(2.4, p.y - 1.0), z: p.z, colour: 0xffc07a, intensity: 26, range: 13 });
          }
          this.heroLightsByChunk.set(k, hero); }
        faces.add(sm);
      }
      if (windows.length) {
        const wg = A.geo.sign.clone();
        wg.userData.owned = true;
        const tints = new Float32Array(windows.length * 3);
        const wm = new THREE.InstancedMesh(wg, A.mat.windowQuad, windows.length);
        windows.forEach((w, i) => { wm.setMatrixAt(i, w.m); tints.set(w.tint, i * 3); });
        wg.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
        wm.instanceMatrix.needsUpdate = true;
        wm.computeBoundingSphere();
        faces.add(wm);
      }
      /* The batches land AFTER the chunk's bundle was recorded, and nothing
         re-recorded it until a ring change -- so at the spawn every facade and
         prop mesh was a direct draw (~450 of them at kingsway). Each landing
         now applies the bundle rule (no per-object culling inside a recording)
         and bumps the bundle once. */
      const landed = (g) => {
        g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        /* The shadow ring gate in update() only re-applies when a chunk's ring
           changes; a batch landing after it ran kept the emit's default
           castShadow = true in EVERY chunk until you crossed a boundary --
           measured 1161 casters at the spawn, ~700 of them prop batches.
           Forget the ring so the next frame re-applies the rule. */
        props.userData.shadowRing = undefined;
        group.needsUpdate = true;
      };
      fbatch.emit(faces, { shadow: false, lod: 1 }).then(() => landed(faces))
        .catch((e) => console.warn('facades failed:', e.message));
      // fire and forget: the chunk is usable now, the props land a frame later
      /* lod1 throughout. The re-ingested kit is 5.7x heavier at lod0 (31k triangles
         across the placed assets against 9k for the blockouts it replaced) and its
         LOD chains are finally real -- tree 964/280/272 -- so lod1 lands the kit back
         at the old cost with better geometry. A 3.6m bay's lod0 detail is sub-pixel
         past fifteen metres anyway. */
      batch.emit(props, { lod: 1 }).then(() => {
        landed(props);
        if (batch.tracked.length) {
          this.onBreakables?.(k, batch.tracked, solidParked, this.poolsByChunk.get(k));
        }
      }).catch((e) => console.warn('dressing failed:', e.message));
      for (const p of dressPools) pools.push(flat(p.x, p.y, p.z, p.size));
    }

    // Little Tokyo: every building in the chunk in one mesh, one material (tokyo.js)
    if (tokyoParts.length) {
      // the street's overhead: poles join the building mesh, the wires are one LineSegments
      const tBoxes = boxes.filter((b) => b.tokyo);
      const near = (x, z) => tBoxes.some((b) => Math.hypot(b.x - x, b.z - z) < Math.max(b.hw, b.hd) + 14);
      const street = buildTokyoStreet(segs.map((id) => this.district.segments[id]).filter((s) => s && s.cls !== 'freeway' && s.cls !== 'ramp'), near, Math.floor(hash(tBoxes[0].x * 0.13, tBoxes[0].z * 0.47) * 1e9));   // seeded by the chunk's first building, not a chunk coordinate this scope does not have
      tokyoParts.push(...street.parts);
      if (street.lines.length) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(street.lines, 3));
        lg.userData.owned = true;
        const wires = new THREE.LineSegments(lg, wireMaterial());
        wires.frustumCulled = false;
        group.add(wires);
      }
      const merged = mergeGeometries(tokyoParts, false);
      for (const g of tokyoParts) g.dispose();
      if (merged) {
        merged.userData.owned = true;
        merged.computeBoundingSphere();
        const tm = new THREE.Mesh(merged, tokyoMaterial());
        tm.castShadow = true; tm.receiveShadow = true;
        tm.userData.shell = true;
        tm.layers.enable(SHADOW_FAR_LAYER);
        group.add(tm);
      }
    }
    /* The self-built styles: one mesh per material key per chunk (<= 8), the
       textured keys on the library PBR sets, 'emit' on the Tokyo material so
       their windows light with the same night factor. Every part carries the
       same attribute set (artKit paint: position/normal/uv/color/emit/flick),
       which mergeGeometries needs. */
    // span structure rides the self-built styles' per-key meshes: 0 extra draws
    for (const [key, geos] of spanParts) (artParts.get(key) ?? artParts.set(key, []).get(key)).push(...geos);
    for (const [key, geos] of artParts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.userData.owned = true;
      merged.computeBoundingSphere();
      const am = new THREE.Mesh(merged, artMaterial(key));
      am.castShadow = true; am.receiveShadow = true;
      am.frustumCulled = false;                       // bundle contents are culled at record time (see the header)
      am.userData.shell = true;                       // casts into the far cascades like a shell
      am.layers.enable(SHADOW_FAR_LAYER);
      group.add(am);
    }
    // one merged mesh per kit per chunk: the whole Kenney buildings placed above
    for (const [kitName, geos] of Object.entries(kitPlaced)) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.userData.owned = true;
      merged.computeBoundingSphere();
      const km = new THREE.Mesh(merged, this.assets.kitBuildings[kitName].mat);
      km.castShadow = true; km.receiveShadow = true;
      km.userData.shell = true;                       // casts into the far cascades like a shell
      km.layers.enable(SHADOW_FAR_LAYER);
      group.add(km);
    }
    yield* brk('instancing');
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
    /* Block slabs with radiused corners.
       A block slab IS the pavement and its kerb, and as an instanced unit box
       every corner in the city met at a hard 90 degrees -- a tell you see at
       every junction, because that is where you look. Each block becomes a
       rounded rectangle (3.5m kerb return, or a third of the short side on a
       small block) extruded to KERB_H, merged per kind per chunk, so the draw
       count is unchanged and the top carries UVs in metres for the slabs. */
    const roundedSlab = (list) => {
      if (!list.length) return null;
      const geos = [];
      for (const m of list) {
        const e = m.elements;
        const w = Math.hypot(e[0], e[2]), d = Math.hypot(e[8], e[10]);   // scale x, z
        const r = Math.min(3.5, Math.min(w, d) / 3);
        const shape = new THREE.Shape();
        const hw = w / 2, hd = d / 2;
        shape.moveTo(-hw + r, -hd);
        shape.lineTo(hw - r, -hd); shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
        shape.lineTo(hw, hd - r); shape.quadraticCurveTo(hw, hd, hw - r, hd);
        shape.lineTo(-hw + r, hd); shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
        shape.lineTo(-hw, -hd + r); shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
        const g = new THREE.ExtrudeGeometry(shape, { depth: KERB_H, bevelEnabled: false, curveSegments: 6 });
        // Extrude builds in XY and extrudes +Z; stand it up so the slab lies in XZ with its top at KERB_H
        g.rotateX(-Math.PI / 2);
        g.translate(0, KERB_H, 0);
        // UVs in metres: the extrude writes shape-space XY into uv, so scale to the slab tile
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.4, uv.getY(i) / 2.4);
        // the instance matrix carried the block's yaw and centre; apply it minus the scale
        const yaw = Math.atan2(e[8] / d, e[10] / d);
        const place = new THREE.Matrix4().makeRotationY(yaw).setPosition(e[12], e[13], e[14]);
        g.applyMatrix4(place);
        geos.push(g);
      }
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) return null;
      merged.userData.owned = true;
      merged.computeBoundingSphere();
      return merged;
    };
    const slabMesh = (list, mat) => {
      const g = roundedSlab(list);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      group.add(m);
    };
    slabMesh(slabs.block, A.mat.walkDistrict ?? A.mat.walk);
    yield* tick('slabs-park');
    slabMesh(slabs.park, A.mat.parkGround ?? A.mat.leaf);
    yield* tick('slabs-lot');
    slabMesh(slabs.lot, A.mat.kerb);
    yield* tick('slabs-vacant');
    slabMesh(slabs.vacant, A.mat.kerb);
    yield* brk('lamp inst');
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
    yield* brk('parked fleet');
    /* No glazing on the parked fleet. There are ~390 of them in the streaming
       radius and nobody ever looks into a parked car; adding their windows
       took the scene from 4.9M triangles to 7.5M. */
    /* Two versions of the kerbside fleet, and the ring decides which you see.
       Both are built once with the chunk; only the instance matrices cost
       anything to keep, and the geometry is shared. */
    const nearParked = [], farParked = [], byBody = {};
    for (const bk of Object.keys(parked)) {
      const kit = A.geo.stunt[bk];
      if (!kit) continue;
      inst(kit.body, A.mat.parked, parked[bk], true, parkedCol[bk]);
      const n = group.children[group.children.length - 1];
      if (n) { n.name = `parkedNear:${bk}`; nearParked.push(n); }
      /* Vendor kits split paint from detail (glass, tyres, trim in the kit's
         own palette); the detail rides the near ring with the paint. */
      let dm = null;
      if (kit.detail && kit.detailMat) {
        inst(kit.detail, kit.detailMat, parked[bk], true);
        dm = group.children[group.children.length - 1];
        if (dm && dm !== n) { dm.name = `parkedNearDetail:${bk}`; nearParked.push(dm); } else dm = null;
      }
      inst(kit.lodBody ?? kit.body, A.mat.parked, parked[bk], false, parkedCol[bk]);
      const f = group.children[group.children.length - 1];
      if (f && f !== n && f !== dm) { f.name = `parkedFar:${bk}`; f.visible = false; farParked.push(f); }
      byBody[bk] = { near: n, detail: dm, far: f !== n && f !== dm ? f : null };
    }
    if (nearParked.length) this.parkedLod.set(k, { near: nearParked, far: farParked, byBody });
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
      /* A building shell: the one kind of mesh the far shadow cascade draws
         (see renderer.js SHADOW_FAR_LAYER), and the one kind that keeps
         casting from the neighbouring ring in update(). */
      m.userData.shell = true;
      m.layers.enable(SHADOW_FAR_LAYER);
      /* Set here, not left to the ring gate in update(): the gate runs on the
         frame the chunk group is added, before this generator has emitted the
         shells, and re-runs only when the ring changes -- so shells built at
         the spawn never cast until you crossed a chunk boundary. */
      m.castShadow = true;
      group.add(m);
    };
    for (const key of Object.keys(facades)) {
      const [arch, v] = key.split('|');
      tiled(A.facades[arch][+v], facades[key]);
    }
    yield* brk('tiled bases');
    for (const key of Object.keys(bases)) tiled(A.base.materials[+key], bases[key]);
    inst(slabGeo, A.mat.roof, roofs);
    inst(A.geo.gable, A.mat.roofPitch, gables, true);   // pitched roofs cast: their shadow is half of what says "roof"
    inst(slabGeo, A.mat.roofGlass, glassRoofs);
    inst(slabGeo, A.mat.crown, crowns);
    inst(slabGeo, A.mat.pole, masts);
    // Phase 5: a red beacon on every mast tip
    inst(A.geo.lampCap, A.mat.beacon, masts.map((m) => { const e = m.elements; return mat4(e[12], e[13] + e[5] / 2 + 0.2, e[14], 0, 1.2, 1.2, 1.2); }));
    inst(A.geo.ac, A.mat.plant, plant.ac, true);
    inst(A.geo.tank, A.mat.plant, plant.tank, true);
    inst(A.geo.hut, A.mat.plant, plant.hut, true);

    this.parkedByChunk.set(k, solidParked);
    this.solidsByChunk.set(k, boxes);
    this.scene.add(group);   // the last step: the chunk appears whole
  }

  /**
   * A parked car gets stolen: hide its instance on both LOD meshes and drop
   * its collision body, so the space it stood in is empty and nothing else
   * changes. The chunk still owns the buffers; the instance is just scaled to
   * nothing, which is how #cullFar hides the far stand-ins too. Returns the
   * paint so the hero can take it.
   */
  /**
   * Re-record every live chunk's render bundle.
   *
   * Measured 2026-09-02 on a 600m out-and-back at the spawn: bundles on,
   * 392 WebGPU "buffer used in submit while destroyed" errors; bundles off,
   * 3; bundles on but re-recorded every frame, 1. So a released chunk's
   * teardown destroys a GPU buffer that some LIVE chunk's recording still
   * points at (a buffer the renderer shares between render objects), and
   * the stale recording submits it. Re-recording once per streaming event
   * -- 24 bundles, a few milliseconds, only when a chunk leaves -- is the
   * cheap, complete answer; chasing the exact shared buffer through three's
   * backend is not.
   */
  #rerecordAll() {
    for (const g of this.chunks.values()) g.needsUpdate = true;
  }

  /**
   * What the chunk bundles replay in the main pass. renderer.info counts only
   * the draws the CPU issues; a replayed render bundle is invisible to it, so
   * after 2026-09-02 the HUD's own figure would have read 211 draws for a
   * frame that really drew ~1,000. Summed over visible chunks, visible meshes.
   */
  bundleStats() {
    let draws = 0, tris = 0;
    for (const g of this.chunks.values()) {
      if (!g.visible) continue;
      g.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        for (let p = o; p && p !== g; p = p.parent) if (!p.visible) return;
        const geo = o.geometry;
        const n = (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
        const k = o.isInstancedMesh ? o.count : 1;
        if (k === 0) return;
        draws++; tris += n * k;
      });
    }
    return { draws, tris };
  }

  takeParked(solid) {
    const lod = this.parkedLod.get(solid.chunk);
    const meshes = lod?.byBody?.[solid.body];
    if (meshes) {
      for (const m of [meshes.near, meshes.detail, meshes.far]) {
        if (!m) continue;
        m.setMatrixAt(solid.index, _zero);
        m.instanceMatrix.needsUpdate = true;
      }
    }
    const list = this.parkedByChunk.get(solid.chunk);
    if (list) { const i = list.indexOf(solid); if (i >= 0) list.splice(i, 1); }
    return solid.colour;
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
  nearbyParked(x, z, target = null) {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    if (!target && this._parkedCache && this._lastParkedIx === ix && this._lastParkedIz === iz) {
      return this._parkedCache;
    }
    const out = target || [];
    if (!target) out.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.parkedByChunk.get(ck(ix + dx, iz + dz));
        if (list) {
          for (let i = 0; i < list.length; i++) out.push(list[i]);
        }
      }
    }
    if (!target) {
      this._parkedCache = out;
      this._lastParkedIx = ix;
      this._lastParkedIz = iz;
    }
    return out;
  }
}

const _colour = new THREE.Color();
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _box = new THREE.Box3();
/* Render bundles are ON by default (2026-09-02, after the fix in
   core/renderer.js:patchNestedRenderInBundle). They cut render CPU
   11.6 -> 8.8 ms. The ghosts (a building at the player's transform, cars in
   the sky) were truncated recordings: a nested shadow-map render inside a
   recording cleared three's current-bundle pointer, so the spawn chunk's
   recording held 1 of 81 objects. Fixed at the renderer; verified 76/76
   recorded afterwards. ?nobundles turns them off for A/B. */
const USE_BUNDLES = typeof location !== 'undefined' ? !new URLSearchParams(location.search).has('nobundles') : false;
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);   // hides an instance in place
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
