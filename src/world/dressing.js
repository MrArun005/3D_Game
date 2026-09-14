import * as THREE from 'three';
import { KERB_H } from './metrics.js';

/**
 * Where the catalogue goes.
 *
 * This is the file that answers "we have 91 authored assets, what does the
 * city do with them". It is deliberately a set of TABLES rather than a set of
 * `if` chains: adding a prop to the kit means adding one row, and the rules
 * that decide where a row can stand are written once.
 *
 * Everything here is seeded off world position through `hash`, never
 * Math.random, so the same street dresses identically on every reload -- the
 * same rule the rest of the world generator lives by.
 */

const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

import { tileUv, SIGN_TILES } from './signs.js';

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Assets are authored Y-up with the origin at the base and the outward face
 * looking down +Z, so placing one is a position, a yaw and a uniform scale.
 * Exported because districtWorld places the authored signal mast itself --
 * the lenses on it have to stay an InstancedMesh it can recolour per frame.
 */
export function place(x, y, z, yaw, scale = 1) {
  _e.set(0, yaw, 0);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z), _q.setFromEuler(_e), _s.set(scale, scale, scale),
  );
}

/* Shipping containers are the one prop whose COLOUR is the read: a yard of
   identical grey boxes is a texture, a yard of rust-red, blue, green and white
   boxes is a port. Picked by position hash so a container keeps its colour
   across reloads. Rides InstanceBatch.add's third argument (the batched path's
   per-instance colour); any other asset gets null and stays as authored. */
const CONTAINER_COLOURS = [0x8a3a2a, 0x2a4f8a, 0x2f6b3a, 0xc9a227, 0xd8d8d0, 0x50555a, 0x6b2a3a, 0x2a6b6b, 0x9a4a1e];
export function containerColour(px, pz, asset) {
  if (!/container/.test(asset)) return null;
  const i = Math.floor(hash(px * 0.37, pz * 0.91) * CONTAINER_COLOURS.length) % CONTAINER_COLOURS.length;
  return new THREE.Color(CONTAINER_COLOURS[i]);
}

/** Same, with a width and height: the sign quad is unit-sized and stretched here. */
function placeBoard(x, y, z, yaw, w, h) {
  _e.set(0, yaw, 0);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(w, h, 1));
}

/* ------------------------------------------------------------------ *
 *  Kerbside furniture
 *
 *  `every` is the spacing in metres, `chance` the probability at each
 *  candidate slot, and `on` restricts a row to a class of street. The lamps
 *  are the only mandatory row -- everything else is scattered, or the
 *  pavement turns into a showroom.
 * ------------------------------------------------------------------ */
export const KERB_ROWS = [
  { asset: 'props/lamp_arterial', every: 34, chance: 1.00, on: ['arterial', 'boundary'], offset: 1.6 },
  { asset: 'props/lamp_local',    every: 30, chance: 1.00, on: ['street', 'local'],      offset: 1.5 },
  { asset: 'props/street_sign',   every: 70, chance: 0.30, offset: 1.4 },
];

/**
 * Where a row's first prop goes on a segment.
 *
 * Every row used to start at t = 10, so two rows with the SAME `offset` --
 * bus_shelter and a_frame_sign are both 3.6, phone_box and notice_board both
 * 2.6 -- put their first prop at exactly the same point on every segment that
 * passed both chances. A bus shelter growing out of an A-board. Each row now
 * takes its own seeded phase (capped at 14 m so a long-pitch row is not phased
 * off the end of a short street and lost). farLampHeads() replays this too, or
 * the far glare sprites would sit where the lamps used to be.
 *
 * Measured over the brief's Old Quarter bounds (x 1044-1907, z 960-1845),
 * replaying dressChunk against the real district file: exactly-coincident
 * pairs 20 -> 0, and pairs interpenetrating by more than 15 cm (plan-view
 * footprint radii) 1028 of 1841 props -> 214 of 4223. That de-stacking is the
 * larger visual win here, and it lands district-wide. Side effects, both
 * checked: 273 fewer props city-wide (a phased row can lose its last slot to
 * the `t < L - 8` gate) and 5247 -> 5171 lamps, with farLampHeads still
 * matching every kerbside lamp within 2 m (5171/5171).
 */
const rowStart = (row, s) => 10 + hash(s.ax * 1.7 + row.offset * 13.1, s.az * 0.6 + row.every) * Math.min(row.every, 14);

/* ------------------------------------------------------------------ *
 *  Old Quarter street life  (VISUAL-BRIEF Phase 4, hero block)
 *
 *  KERB_ROWS above is an EVEN sprinkle: every row walks the whole segment at
 *  its own pitch, so what lands is a thin uniform dusting. That reads as
 *  wallpaper on a 14 m street where you pass within three metres of
 *  everything, and it still leaves long blank pavements.
 *
 *  The gate below is districtAt() on the segment MIDPOINT, so the pass runs
 *  on 100 segments -- 25.2 km of centreline, 50.4 km of kerb: 41 `street`,
 *  56 `arterial`, 3 `boundary`. Not just the short interior lanes. Replaying
 *  dressChunk over the brief's bounds: 2487 -> 4851 props, 4.94 -> 9.63 per
 *  100 m of kerb.
 *
 *  COST, measured the same way and stated because hard rule 1 asks for it:
 *  +2421 props / +229,716 lod1 triangles district-wide; worst single chunk
 *  (5,5) +692 props / +64,896 tris; worst 3x3 detailed ring +175,300 tris,
 *  4.4% of the 4.0M budget. Draws are unchanged -- the prop batch buckets by
 *  MATERIAL and the kit's material set stays at 14, so the three assets new
 *  to the kerbside (crates, pallet_stack, litter_bin_park) ride buckets that
 *  already exist. What is NOT free is the build step: kerbside+roads for
 *  chunk 5,5 goes 3.35 -> 7.28 ms, and dressChunk is one un-sliced step
 *  between two yields in districtWorld. OQ_PITCH is the lever if that hitches.
 *
 *  Real pavements CLUMP. A bin, a bike rack and a meter by one doorway, then
 *  twenty metres of nothing, then a stack of delivery crates. So the hero
 *  block gets a second pass on top of the rows: a seeded cluster centre every
 *  OQ_PITCH metres, kept or dropped on a hash (the gaps are the point), 2-4
 *  props each drawn from the weighted table below, laid out shoulder to
 *  shoulder along the kerb by their own width.
 *
 *  Scoped to OLD QUARTER on purpose -- the brief dresses one block, judges
 *  it, and only then scales. The district comes off the nearest BLOCK
 *  (segments carry no district of their own), memoised on the segment.
 *
 *  `offset` is the centre's distance out from the kerb line; the pavement is
 *  4.8 m wide, and what has to fit across it is the prop's authored DEPTH,
 *  not its span -- offset + depth/2 is under 4.2 for every row here except
 *  cafe_umbrella (4.85), whose canopy overhangs the frontage above head
 *  height on purpose. Street trees are the procedural species in
 *  districtWorld, not the kit cube. `span` is the prop's
 *  width ALONG the kerb (its authored X, since a road-facing yaw lays local
 *  +X along the kerb) and is what stops a 3 m bike rack landing inside a
 *  bench. `loose` items are dumped rather than installed, so they get a wide
 *  yaw jitter.
 * ------------------------------------------------------------------ */
const OQ_PITCH = 15;

export const OQ_KIT = [
  { asset: 'props/bin',            weight: 7, offset: 1.2, span: 0.6 },
  { asset: 'props/bike_rack',      weight: 6, offset: 2.4, span: 3.1 },
  { asset: 'props/parking_meter',  weight: 6, offset: 1.1, span: 0.3 },
  { asset: 'props/bollard',        weight: 5, offset: 0.8, span: 0.3 },
  { asset: 'props/planter',        weight: 4, offset: 2.2, span: 1.6 },
  { asset: 'props/bench',          weight: 4, offset: 2.9, span: 1.8 },
  { asset: 'props/junction_box',   weight: 4, offset: 3.6, span: 0.9 },
  { asset: 'props/street_sign',    weight: 4, offset: 1.0, span: 1.1 },
  { asset: 'props/crates',         weight: 4, offset: 3.0, span: 2.4, loose: true },
  { asset: 'props/a_frame_sign',   weight: 4, offset: 3.2, span: 0.7, loose: true },
  { asset: 'props/hydrant',        weight: 3, offset: 1.2, span: 0.5 },
  { asset: 'props/notice_board',   weight: 3, offset: 3.4, span: 1.9 },
  { asset: 'props/post_box',       weight: 3, offset: 1.4, span: 0.7 },
  { asset: 'props/pallet_stack',   weight: 3, offset: 3.3, span: 1.2, loose: true },
  { asset: 'props/shrub_mass',     weight: 3, offset: 3.4, span: 1.1, scale: [0.7, 1.05] },
  { asset: 'props/cafe_umbrella',  weight: 2, offset: 3.3, span: 3.1 },
  { asset: 'props/litter_bin_park', weight: 2, offset: 2.0, span: 0.7 },
  { asset: 'props/barrier',        weight: 2, offset: 1.4, span: 2.0, loose: true },
  { asset: 'props/cone',           weight: 2, offset: 1.1, span: 0.4, loose: true },
];

/**
 * One segment's worth of Old Quarter clusters. Same guards as kerbside():
 * nothing stands on the tarmac of ANY road, everything is seeded off world
 * position, and the one prop big enough to stop a car pushes a solid.
 */
function oldQuarterClusters(batch, s, L, ux, uz, nx, nz, district, solids) {
  for (let t = 12, ci = 0; t < L - 10; t += OQ_PITCH, ci++) {
    if (hash(s.ax + t * 2.17, s.az - t * 1.41) > 0.85) continue;   // the deliberate empty stretch
    /* Successive clusters mostly alternate sides. Picking the side purely at
       random leaves one pavement of a short street bare; alternating keeps
       both sides worked without making the street symmetrical. */
    const side = (ci % 2 ? 1 : -1) * (hash(s.bx + t, s.az - t) < 0.75 ? 1 : -1);
    const n = 2 + Math.floor(hash(s.az + t * 0.3, s.bx + t) * 3);   // 2-4

    const picks = [];
    let width = 0;
    for (let i = 0; i < n; i++) {
      const k = pick(OQ_KIT, hash(s.ax + t * 1.7 + i * 9.13, s.bz + t * 0.9 - i * 4.7));
      picks.push(k);
      width += k.span + 0.45;                                      // 0.45 m of air between neighbours
    }

    let along = t - width / 2;
    for (let i = 0; i < picks.length; i++) {
      const k = picks[i];
      along += k.span / 2;
      const r = hash(t + i * 3.1, s.ax + i);
      const off = (s.half + k.offset + (r - 0.5) * 0.5) * side;
      const px = s.ax + ux * along + nx * off;
      const pz = s.az + uz * along + nz * off;
      along += k.span / 2 + 0.45;
      if (district.tarmacDepth(px, pz) <= 0.2) continue;
      const yaw = Math.atan2(nx * -side, nz * -side)
        + (hash(s.bz + i, t * 1.3) - 0.5) * (k.loose ? 2.4 : 0.5);
      const sc = k.scale ? k.scale[0] + r * (k.scale[1] - k.scale[0]) : 1;
      batch.add(k.asset, place(px, KERB_H + district.elevationAt(px, pz), pz, yaw, sc));
      if (k.solid) solids.push({ x: px, z: pz, yaw: 0, offsets: [0], radius: k.solid, reach: 2.0, tag: 'prop' });
    }
  }
}


/* Is (x, z) within `r` of a junction? Nodes are bucketed once into a coarse
   grid -- 1,789 of them, and a linear scan per candidate prop turned dressing
   into an O(props x nodes) walk. */
let _nodeGrid = null, _nodeGridFor = null;
function nearJunction(district, x, z, r) {
  const nodes = district?.graph?.nodes;
  if (!nodes) return false;
  if (_nodeGridFor !== nodes) {
    _nodeGrid = new Map();
    for (const n of nodes) {
      const k = `${Math.floor(n.x / 64)},${Math.floor(n.y / 64)}`;
      (_nodeGrid.get(k) ?? _nodeGrid.set(k, []).get(k)).push(n);
    }
    _nodeGridFor = nodes;
  }
  const gx = Math.floor(x / 64), gz = Math.floor(z / 64), r2 = r * r;
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (const n of _nodeGrid.get(`${gx + a},${gz + b}`) ?? []) {
        const dx = n.x - x, dz = n.y - z;
        if (dx * dx + dz * dz < r2) return true;
      }
    }
  }
  return false;
}

/** Things in the kerb gutter, away from vehicle tyre paths (no black road patches). */
const ROAD_ROWS = [
  { asset: 'props/drain_grate', every: 32, chance: 0.45, lateral: 0.94 },   // in the gutter, by the kerb
  { asset: 'props/drain_grate', every: 48, chance: 0.40, lateral: 0.95 },
];

/* Roadworks: they cluster, so one seeded site owns a run of the kerb rather
   than scattering a lone cone every 200m. */
const ROADWORKS = ['props/barrier', 'props/cone', 'props/hoarding', 'props/scaffold_bay'];

const ROOF_KIT = [
  { asset: 'props/hvac_unit',       weight: 4 },
  { asset: 'props/vent_stack',      weight: 3 },
  { asset: 'props/skylight',        weight: 3 },
  { asset: 'props/water_tank',      weight: 2 },
  { asset: 'props/plant_enclosure', weight: 2 },
  { asset: 'props/roof_hut',        weight: 2 },
  { asset: 'props/aerial_mast',     weight: 1 },
];

export const PARK_KIT = [
  { asset: 'props/park_bench',      weight: 5 },
  { asset: 'props/shrub_mass',  weight: 6, scale: [0.8, 1.4] },
  { asset: 'props/flower_bed',      weight: 4 },
  { asset: 'props/hedge_run',       weight: 3 },
  { asset: 'props/litter_bin_park', weight: 3 },
  { asset: 'props/picnic_table',    weight: 3 },
  { asset: 'props/planter',         weight: 2 },
  { asset: 'props/lamp_local',      weight: 3 },
];

/** One per park, if the park is big enough to carry it. */
const PARK_LANDMARKS = [
  { asset: 'props/fountain',        min: 42 },
  { asset: 'props/bandstand',       min: 52 },
  { asset: 'props/pond_edge',       min: 60 },
  { asset: 'props/basketball_hoop', min: 34 },
  { asset: 'props/goalposts',       min: 66 },
];

const PLAYGROUND = ['props/swing_set', 'props/slide', 'props/climbing_frame'];

const HARBOUR_KIT = [
  { asset: 'props/container',       weight: 5 },
  { asset: 'props/container_stack', weight: 3 },
  { asset: 'props/crates',          weight: 4 },
  { asset: 'props/pallet_stack',    weight: 4 },
  { asset: 'props/mooring_bollard', weight: 3 },
  { asset: 'props/dock_crane',      weight: 1 },
  { asset: 'props/pontoon',         weight: 2 },
  { asset: 'props/ferry_ramp',      weight: 1 },
  { asset: 'props/quay_ladder',     weight: 2 },
];

const YARD_KIT = [
  { asset: 'props/container',    weight: 4 },
  { asset: 'props/pallet_stack', weight: 4 },
  { asset: 'props/crates',       weight: 3 },
  { asset: 'props/fence_panel',  weight: 5 },
  { asset: 'props/hoarding',     weight: 2 },
  { asset: 'props/junction_box', weight: 2 },
];

/** Pick from a weighted table with a value already in [0,1). */
function pick(kit, r) {
  let total = 0;
  for (const k of kit) total += k.weight;
  let acc = r * total;
  for (const k of kit) { acc -= k.weight; if (acc <= 0) return k; }
  return kit[kit.length - 1];
}

/**
 * Dress one chunk.
 *
 * `ctx` carries the chunk's own slice of the district -- segments, blocks and
 * the elevation sampler -- plus the collision list so a bollard you can drive
 * through does not end up in the middle of the pavement.
 */
export function dressChunk(batch, ctx) {
  const { segments, blocks, district, solids, pools, heads } = ctx;
  kerbside(batch, segments, district, solids, pools, heads);
  // Carriageway clutter/ironwork removed to keep roads 100% clean and unobstructed
  blockDressing(batch, blocks, district, solids);
}

function kerbside(batch, segments, district, solids, pools, heads) {
  for (const s of segments) {
    if (s.cls === 'freeway' || s.cls === 'ramp') continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 22) continue;
    const ux = dx / L, uz = dz / L;
    const nx = -uz, nz = ux;

    /* The hero block's street life, on top of the even rows below. Segments
       carry no district, so it comes from the nearest block; memoised on the
       segment because segments are shared between chunks and never move. */
    if (s._district === undefined) s._district = district.districtAt?.((s.ax + s.bx) / 2, (s.az + s.bz) / 2) ?? null;
    if (s._district === 'OLD QUARTER') oldQuarterClusters(batch, s, L, ux, uz, nx, nz, district, solids);

    /* Clean carriageway: zero roadworks/debris blocking high-speed lanes */
    const works = -1;

    for (const row of KERB_ROWS) {
      if (row.on && !row.on.includes(s.cls)) continue;
      if (row.district && s._district !== row.district) continue;
      for (let t = rowStart(row, s); t < L - 8; t += row.every) {
        const seed = hash(s.ax + t * 1.31, s.az + t * 0.77);
        if (seed > row.chance) continue;
        const side = hash(s.az + t, s.ax) < 0.5 ? 1 : -1;
        const off = (s.half + row.offset) * side;
        const px = s.ax + ux * t + nx * off;
        const pz = s.az + uz * t + nz * off;
        /* Rule: kerbside furniture stands OFF the tarmac — of every road, not
           just its own. Segments run straight through junctions, so an offset
           legal for this street can sit square in the crossing one; before
           this guard 9,447 of 27,825 placements (34%) stood on a road
           somewhere, the worst a lamp 14.9m inside an arterial. */
        if (district.tarmacDepth(px, pz) <= 0.2) continue;
        // face the road; `align` rows run along the kerb instead
        const yaw = row.align
          ? Math.atan2(ux, uz)
          : Math.atan2(nx * -side, nz * -side);
        const y = KERB_H + district.elevationAt(px, pz);
        let sc = 1;
        if (row.scale) sc = row.scale[0] + seed * (row.scale[1] - row.scale[0]);
        batch.add(row.asset, place(px, y, pz, yaw, sc));
        /* The light pool is emitted from the same loop that places the lamp,
           so the two can never drift apart -- which is exactly what happened
           when the pools were generated by a separate pass with its own
           spacing. */
        if (pools && row.asset.includes('lamp')) {
          pools.push({ x: px + Math.cos(yaw) * 1.4, y: y + 0.03,
                       z: pz - Math.sin(yaw) * 1.4, size: 16 });
          // the pavement side gets light too; a lamp does not only face the road
          pools.push({ x: px - Math.cos(yaw) * 1.6, y: y + 0.03,
                       z: pz + Math.sin(yaw) * 1.6, size: 9 });
        }
        /* The glowing head, at the tip of the authored arm. The kit lamps have
           no emissive part of their own, so at night they were dark sticks
           standing over a pool of light with nothing above it to bloom. The
           asset's arm runs along its local +Z, which place() yaws to
           (sin yaw, cos yaw) in world. */
        if (heads && row.asset.includes('lamp')) {
          const arterial = row.asset.includes('arterial');
          const reach = arterial ? 1.55 : 0.30, h = arterial ? 8.2 : 6.02;
          heads.push({ x: px + Math.sin(yaw) * reach, y: y + h,
                       z: pz + Math.cos(yaw) * reach, yaw });
        }
        if (row.asset.includes('lamp') || row.asset.includes('tree')
            || row.asset.includes('phone') || row.asset.includes('shelter')) {
          solids.push({ x: px, z: pz, yaw: 0, offsets: [0],
            radius: row.asset.includes('shelter') ? 1.6 : 0.32, reach: 2.0, tag: 'prop' });
        }
      }
    }

    /* A hoarding on open ground beside a fast road. Sited off the segment
       rather than off a block so it lands on whatever is there -- which is
       what an advertiser does. */
    if (s.cls === 'arterial' && L > 90 && hash(s.ax * 1.9, s.bz) < 0.3) {
      const t = 40 + hash(s.bx, s.ax) * (L - 70);
      const side = hash(s.bz, s.ax + t) < 0.5 ? 1 : -1;
      const off = (s.half + 9) * side;
      const px = s.ax + ux * t + nx * off, pz = s.az + uz * t + nz * off;
      // a billboard is 6m wide; keep the whole face off every carriageway
      if (district.tarmacDepth(px, pz) > 1.0) {
        batch.add('props/billboard_freestanding', place(px,
          KERB_H + district.elevationAt(px, pz), pz,
          Math.atan2(nx * -side, nz * -side)));
      }
    }

    if (works > 0) {
      for (let i = 0; i < 7; i++) {
        const t = works + i * 3.4;
        if (t > L - 6) break;
        const a = ROADWORKS[Math.floor(hash(s.ax + t, s.az + i) * ROADWORKS.length)];
        const side = hash(s.bz + t, s.bx) < 0.5 ? 1 : -1;
        const off = (s.half - 0.7) * side;
        const px = s.ax + ux * t + nx * off, pz = s.az + uz * t + nz * off;
        // roadworks live on their OWN road's edge; never in the crossing one
        if (district.tarmacDepth(px, pz, s) <= 0.3) continue;
        /* AND NEVER AT A JUNCTION (2026-09-14).
           These sit 0.7 m inside their own carriageway edge on purpose -- real
           roadworks take a lane -- and the guard above passes `s` so it only
           rejects them from OTHER roads. Fine down a straight. At a junction it
           is a wall of red-and-white barriers across the one place you need to
           read the road: counted over the district file, 279 roadworks props
           are placed and 105 of them stand within 26 m of a junction node.
           That is the barrier clutter you meet head-on coming off a bridge.
           30 m clears the crossing, the stop line and the approach paint. */
        if (nearJunction(district, px, pz, 30)) continue;
        batch.add(a, place(px, district.elevationAt(px, pz), pz, Math.atan2(ux, uz)));
      }
    }
  }
}

/** Ironwork in the carriageway. Flat, so it never needs collision. */
function roads(batch, segments, district) {
  for (const s of segments) {
    if (s.cls === 'freeway' || s.cls === 'ramp') continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 20) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    for (const row of ROAD_ROWS) {
      for (let t = 12; t < L - 8; t += row.every) {
        const seed = hash(s.bx + t * 0.53, s.bz + t * 1.9);
        if (seed > row.chance) continue;
        const side = seed < row.chance / 2 ? 1 : -1;
        const off = s.half * row.lateral * side;
        const px = s.ax + ux * t + nx * off, pz = s.az + uz * t + nz * off;
        batch.add(row.asset, place(px, district.elevationAt(px, pz) + 0.01, pz,
          hash(t, s.ax) * Math.PI));
      }
    }
  }
}

/**
 * Parks, yards, lots and the harbour.
 *
 * A block's `type` already says what it is, so the kit follows from it. The
 * scatter walks a jittered grid rather than sampling at random: random points
 * clump, and a clumped park looks like a landfill.
 */
function blockDressing(batch, blocks, district, solids) {
  for (const bl of blocks) {
    const ca = Math.cos(bl.angle), sa = Math.sin(bl.angle);
    const toWorld = (lx, lz) => [
      bl.x + lx * ca - lz * sa,
      bl.y + lx * sa + lz * ca,
    ];
    const span = Math.min(bl.w, bl.h);

    if (bl.type === 'park') {
      const step = 9;
      for (let lx = -bl.w / 2 + 6; lx < bl.w / 2 - 6; lx += step) {
        for (let lz = -bl.h / 2 + 6; lz < bl.h / 2 - 6; lz += step) {
          const r = hash(bl.x + lx, bl.y + lz);
          if (r > 0.62) continue;
          const jx = lx + (hash(lz, lx) - 0.5) * step * 0.7;
          const jz = lz + (hash(lx, lz) - 0.5) * step * 0.7;
          const [px, pz] = toWorld(jx, jz);
          if (district.landmarkKeepOut?.(px, pz)) continue;   // world/landmarks.js: the ground a set piece stands on
          const k = pick(PARK_KIT, hash(px * 1.7, pz * 0.3));
          const sc = k.scale
            ? k.scale[0] + hash(pz, px) * (k.scale[1] - k.scale[0]) : 1;
          batch.add(k.asset, place(px, KERB_H + district.elevationAt(px, pz), pz,
            hash(px, pz) * 6.283, sc), containerColour(px, pz, k.asset));
        }
      }
      // paths across the park, and a gate where one meets the kerb
      for (let lx = -bl.w / 2 + 4; lx < bl.w / 2 - 4; lx += 4) {
        const [px, pz] = toWorld(lx, 0);
        batch.add('props/path_segment',
          place(px, KERB_H + district.elevationAt(px, pz) + 0.01, pz, bl.angle));
      }
      const [cx, cz] = toWorld(0, 0);
      batch.add('props/path_junction',
        place(cx, KERB_H + district.elevationAt(cx, cz) + 0.012, cz, bl.angle));
      for (const g of [-1, 1]) {
        const [gx, gz] = toWorld(g * (bl.w / 2 - 1.5), 0);
        batch.add('props/park_gate',
          place(gx, KERB_H + district.elevationAt(gx, gz), gz, bl.angle + Math.PI / 2));
      }
      for (const lm of PARK_LANDMARKS) {
        if (span < lm.min) continue;
        if (hash(bl.x + lm.min, bl.y) > 0.55) continue;
        const [px, pz] = toWorld((hash(bl.y, bl.x) - 0.5) * bl.w * 0.4,
                                 (hash(bl.x, bl.y) - 0.5) * bl.h * 0.4);
        batch.add(lm.asset, place(px, KERB_H + district.elevationAt(px, pz), pz,
          hash(pz, px) * 6.283));
        solids.push({ x: px, z: pz, yaw: 0, offsets: [0], radius: 2.2, reach: 3.0, tag: 'prop' });
      }
      if (span > 30 && hash(bl.x + 3, bl.y + 3) < 0.4) {
        // a row of stalls, because one stall on a green is not a market
        const [mx0, mz0] = toWorld(-bl.w * 0.2, bl.h * 0.22);
        for (let i = 0; i < 5; i++) {
          const sx = mx0 + i * 4.2 * Math.cos(bl.angle);
          const sz = mz0 + i * 4.2 * Math.sin(bl.angle);
          batch.add('props/market_stall',
            place(sx, KERB_H + district.elevationAt(sx, sz), sz, bl.angle));
        }
      }
      if (span > 40 && hash(bl.y, bl.x + 7) < 0.5) {
        const [px, pz] = toWorld(bl.w * 0.24, -bl.h * 0.24);
        PLAYGROUND.forEach((a, i) => {
          const ax = px + (i - 1) * 5.5;
          batch.add(a, place(ax, KERB_H + district.elevationAt(ax, pz), pz, bl.angle));
        });
      }
      continue;
    }

    /* Harbour Point is the only district on the water, and its yards read as
       docks; everywhere else a yard is an industrial lot. */
    const harbour = bl.district === 'HARBOUR POINT' || bl.type === 'quay';
    if (bl.type === 'lot' || bl.type === 'vacant' || bl.type === 'yard' || harbour) {
      const kit = harbour ? HARBOUR_KIT : YARD_KIT;
      const step = 11;
      for (let lx = -bl.w / 2 + 7; lx < bl.w / 2 - 7; lx += step) {
        for (let lz = -bl.h / 2 + 7; lz < bl.h / 2 - 7; lz += step) {
          const r = hash(bl.x + lx * 1.3, bl.y + lz * 0.7);
          if (r > (harbour ? 0.55 : 0.34)) continue;
          const [px, pz] = toWorld(lx, lz);
          if (district.landmarkKeepOut?.(px, pz)) continue;   // world/landmarks.js: the ground a set piece stands on
          const k = pick(kit, hash(pz, px));
          batch.add(k.asset, place(px, KERB_H + district.elevationAt(px, pz), pz,
            Math.round(hash(px, pz) * 4) * (Math.PI / 2) + bl.angle), containerColour(px, pz, k.asset));
          solids.push({ x: px, z: pz, yaw: 0, offsets: [0], radius: 1.5, reach: 2.6, tag: 'prop' });
        }
      }
      if (harbour) {
        // the quay edge itself, run along the seaward face of the block
        for (let lx = -bl.w / 2; lx < bl.w / 2; lx += 4) {
          const [px, pz] = toWorld(lx, bl.h / 2);
          batch.add('props/quay_edge',
            place(px, KERB_H + district.elevationAt(px, pz), pz, bl.angle));
        }
      }
      /* A fenced perimeter is what makes a lot read as private ground -- but
         ONLY where the perimeter is not the road (2026-09-14).
         Block footprints are not inset from the carriageway by any fixed
         amount, so a lot whose edge runs into a street fenced the street.
         Counted over the district file: 195 of 8,258 panels stood ON tarmac,
         the worst 16.3 m inside a carriageway at (2172,325) -- a chain-link
         wall across a road, which is what "some fence, and the road itself is
         blocked" is.
         This is the same guard every kerbside prop got in the 2026-08-31 pass
         (tarmacDepth is the MINIMUM over all nearby segments, so it catches a
         fence standing in a road that is not the lot's own frontage).
         0.2 m, not more: a lot boundary is SUPPOSED to hug the kerb, and the
         clearance is only there to absorb float error at the edge. Swept over
         all 8,258 panels -- 0.0 keeps 98%, 0.2 keeps 86%, 0.8 keeps 29% and
         0.4 keeps 67%; every one of them removes all 195 on-tarmac panels, so
         anything past 0.2 is throwing away good fences for nothing. */
      if (!harbour) {
        for (let lx = -bl.w / 2; lx < bl.w / 2; lx += 3.2) {
          for (const side of [-1, 1]) {
            const [px, pz] = toWorld(lx, side * (bl.h / 2 - 0.6));
            if (district.tarmacDepth(px, pz) < 0.2) continue;
            batch.add('props/fence_panel',
              place(px, KERB_H + district.elevationAt(px, pz), pz, bl.angle));
          }
        }
      }
    }
  }
}

/**
 * Roof clutter, from the building shells the massing pass produced.
 *
 * Takes the solid footprints rather than the block, because that is where the
 * heights live -- and a plant room belongs on a specific roof, not on the
 * block's average height.
 */
export function dressRoofs(batch, boxes, district) {
  for (const b of boxes) {
    if (b.hw < 3.5 || b.hd < 3.5) continue;
    // Suburban residential houses have pitched gables; skip industrial clutter
    if (b.kit && (b.district === 'NORTHLINE' || b.district === 'GREENFELL PARK' || b.district === 'MARROW HILL')) continue;
    if (b.pitched) continue;                         // our own gable roofs (districtWorld #massing): nothing stands on a slope
    const y = KERB_H + b.height;
    // Clutter scales with the roof, 1 unit per ~45 m2, capped at 12 (or 5 for kit roofs)
    const maxClutter = b.kit ? 5 : 12;
    const n = Math.max(1, Math.min(maxClutter, Math.round((b.hw * b.hd * 4) / 45 * (0.7 + hash(b.x, b.z) * 0.6))));
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    const spread = b.kit ? 0.75 : 1.3;
    for (let i = 0; i < n; i++) {
      const r = hash(b.x + i * 3.7, b.z - i * 1.9);
      const k = pick(ROOF_KIT, r);
      const lx = (hash(b.z + i, b.x) - 0.5) * (b.hw * spread);
      const lz = (hash(b.x, b.z + i) - 0.5) * (b.hd * spread);
      const px = b.x + lx * ca - lz * sa;
      const pz = b.z + lx * sa + lz * ca;
      batch.add(k.asset, place(px, y, pz, b.angle + Math.round(r * 4) * (Math.PI / 2)));
    }
    // a parapet round the edge reads at street level as a real roofline on procedural boxes
    if (!b.kit && hash(b.z, b.x) < 0.55) {
      for (let t = -b.hw; t <= b.hw; t += 2.4) {
        for (const side of [-1, 1]) {
          const lx = t, lz = side * b.hd;
          batch.add('props/railing', place(
            b.x + lx * ca - lz * sa, y, b.z + lx * sa + lz * ca, b.angle));
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  The facade kit
 *
 *  22 authored modules on a 3.6m grid. Every one is built to the same
 *  convention -- x spans +/-1.8, y rises from the base, and the WALL PLANE
 *  sits at z = 0 with the body behind it -- so placing one is a position plus
 *  a yaw that points its +Z along the wall's outward normal.
 *
 *  Rule 3 of the contract is "procedural for layout, authored for detail":
 *  the massing stays a box, and this is the detail that goes on the front of
 *  it. Only the frontage is dressed, and only the storeys you can actually
 *  read from a car -- a bay module on the 19th floor is 1400 triangles nobody
 *  will ever resolve.
 * ------------------------------------------------------------------ */

const MODULE_W = 3.6;
const GROUND_H = 4.2;

const STYLES = {
  modern: {
    ground: ['facade/ground_lobby', 'facade/ground_shopfront'],
    bay: ['facade/bay_precast_office', 'facade/bay_glass_office'],
    topper: 'facade/cornice_simple',
    vertical: 'facade/pilaster',
  },
  period: {
    ground: ['facade/ground_shopfront', 'facade/ground_shopfront_awning', 'facade/ground_cafe'],
    bay: ['facade/bay_tenement', 'facade/bay_brick_residential', 'facade/bay_plaster_upper'],
    topper: 'facade/cornice_ornate',
    vertical: 'facade/quoin_corner',
    band: 'facade/string_course',
    balcony: 'facade/balcony',
    mansard: 'facade/mansard',
  },
  industrial: {
    ground: ['facade/ground_garage', 'facade/ground_service'],
    bay: ['facade/bay_warehouse'],
    topper: 'facade/parapet',
    vertical: 'facade/downpipe',
    escape: 'facade/fire_escape',
  },
  tokyo: {
    ground: ['facade/ground_retail', 'facade/ground_cafe'],
    bay: ['facade/bay_modern', 'facade/bay_residential'],
    topper: 'facade/parapet',
    vertical: 'facade/downpipe',
    band: 'facade/string_course',
    balcony: 'facade/balcony',
    escape: 'facade/fire_escape',
  },
};

/** Which kit a building wears. Height is the honest proxy for what it is. */
const DISTRICT_STYLE = {
  KINGSWAY: 'modern', 'THE FLATS': 'modern', STEELGATE: 'industrial', 'HARBOUR POINT': 'industrial',
  'OLD QUARTER': 'period', 'VELLERY ROW': 'period', ASHMOOR: 'period', 'MARROW HILL': 'period',
  NORTHLINE: 'period', 'GREENFELL PARK': 'period', 'LITTLE TOKYO': 'tokyo',
};
function styleFor(box, r) {
  if (box.district === 'LITTLE TOKYO') return 'tokyo';
  // the district sets the character; two in three buildings follow it, the rest keep the height rule
  const bias = DISTRICT_STYLE[box.district];
  if (bias && r < 0.66) return box.height > 30 && bias !== 'modern' ? 'modern' : bias;
  if (box.height > 30) return 'modern';
  if (box.height < 13) return r < 0.55 ? 'industrial' : 'period';
  return r < 0.62 ? 'period' : 'modern';
}

/**
 * Dress the street frontage of every building in a chunk.
 *
 * `roadNear` answers "how far from tarmac is this point" so the frontage can
 * be chosen by measurement rather than by guessing which way a block faces --
 * Halstead Bay's blocks are set at ten different angles and half of them are
 * irregular, so any rule based on the block's own axes picks the back wall
 * about as often as the front.
 */
export function dressFacades(batch, boxes, district, roadNear, signs = null, windows = null) {
  for (const box of boxes) {
    if (box.kit) continue;                         // a whole kit building carries its own detail
    const { x, z, angle, hw, hd, height } = box;
    if (height < 5 || hw < 2.4 || hd < 2.4) continue;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    // local face normals, and the half-extent along each
    const faces = [
      { lx: 0, lz: 1, half: hw, out: hd },
      { lx: 0, lz: -1, half: hw, out: hd },
      { lx: 1, lz: 0, half: hd, out: hw },
      { lx: -1, lz: 0, half: hd, out: hw },
    ];
    let best = null, bestD = Infinity;
    for (const f of faces) {
      const nx = f.lx * ca - f.lz * sa, nz = f.lx * sa + f.lz * ca;
      // sample 7m out from the middle of the face
      const d = roadNear(x + nx * (f.out + 7), z + nz * (f.out + 7));
      if (d < bestD) { bestD = d; best = { ...f, nx, nz }; }
    }
    if (!best) continue;

    const seed = hash(x, z);
    const style = STYLES[styleFor(box, seed)];
    const bays = Math.floor((best.half * 2) / MODULE_W);
    if (bays < 1) continue;
    // the wall plane, pushed out a hair so the modules sit ON the shell
    const px = x + best.nx * (best.out + 0.02);
    const pz = z + best.nz * (best.out + 0.02);
    // along the face, perpendicular to the normal
    const ux = -best.nz, uz = best.nx;
    const yaw = Math.atan2(best.nx, best.nz);
    const base = KERB_H + district.elevationAt(x, z);
    const start = -((bays - 1) * MODULE_W) / 2;

    for (let i = 0; i < bays; i++) {
      const o = start + i * MODULE_W;
      const mx = px + ux * o, mz = pz + uz * o;
      const r = hash(mx * 1.7, mz * 0.9);

      const g = style.ground[Math.floor(r * style.ground.length)];
      batch.add(g, place(mx, base, mz, yaw));

      /* One storey of bays above the shopfront, and only that.
         Two courses looked barely different from one at street level and cost
         exactly as much again. */
      if (height > GROUND_H + 3.4) {
        if (style.band) batch.add(style.band, place(mx, base + GROUND_H, mz, yaw));
        const b = style.bay[Math.floor(hash(mz, mx) * style.bay.length)];
        batch.add(b, place(mx, base + GROUND_H + (style.band ? 0.22 : 0), mz, yaw));
        if (style.balcony && r < 0.34) {
          batch.add(style.balcony, place(mx, base + GROUND_H + 1.0, mz, yaw));
        }
      }

      /* Signage on the wall itself. A blank flank above a shopfront is the
         loudest "this is a box with a texture on it" tell there is. */
      if (r < 0.2 && height > GROUND_H + 4) {
        batch.add('props/billboard_wall', place(mx, base + GROUND_H + 0.4, mz, yaw));
      } else if (r > 0.86) {
        batch.add('props/sign_wall_box', place(mx, base + 3.1, mz, yaw));
      }

      /* Phase 2: window quads on the two storeys above the shopfront, two per
         module, tinted warm/cool or dark by a hash of their position. */
      if (windows && height > GROUND_H + 4) {
        for (let st = 0; st < 2 && GROUND_H + 3.4 * (st + 1) + 1 < height; st++) {
          for (const dx of [-0.9, 0.9]) {
            const wy = base + GROUND_H + 1.9 + st * 3.4;
            const hh = hash(mx * 0.71 + dx, mz * 1.13 + st);
            const tint = hh < 0.42 ? [0, 0, 0] : hh < 0.75 ? [1.0, 0.82, 0.55] : [0.72, 0.86, 1.0];
            const lv = hh < 0.42 ? 0 : 0.45 + hash(mz + st, mx + dx) * 0.55;
            windows.push({ m: placeBoard(mx + ux * dx + best.nx * 0.08, wy, mz + uz * dx + best.nz * 0.08, yaw, 1.1, 1.5), tint: tint.map((c) => c * lv) });
          }
        }
      }

      /* Phase 1: the shop's own name.
         A fascia board over every ground module (industrial stock: half of
         them), 0.14m proud of the wall so it clears the module face, cell
         hashed from the module position so the same shop keeps its sign. A
         projecting sign on every second module and an A-frame on the
         pavement outside the cafes -- the kit already has both, they were
         just never placed. This is the layer Shibuya sells on. */
      const isTokyo = box.district === 'LITTLE TOKYO';
      if (signs && (style !== STYLES.industrial || r < 0.5 || isTokyo)) {
        const [u, v] = tileUv(Math.floor(hash(mx * 0.37, mz * 1.3) * SIGN_TILES), isTokyo);
        signs.push({
          m: placeBoard(mx + best.nx * 0.14, base + 3.55, mz + best.nz * 0.14, yaw, 3.3, 0.85), u, v,
        });
        if ((i % 2 === 1 || isTokyo) && (isTokyo ? r < 0.85 : r < 0.7)) {
          batch.add('props/sign_projecting', place(mx + ux * 1.55, base + 3.0, mz + uz * 1.55, yaw));
        }
        if ((g.includes('cafe') || isTokyo) && (isTokyo ? r < 0.75 : r < 0.6)) {
          batch.add('props/a_frame_sign', place(mx + best.nx * 1.4 + ux * 0.9, base, mz + best.nz * 1.4 + uz * 0.9, yaw));
        }
        // Vertical multi-storey neon banners (Tokyo street life aesthetic) on taller commercial/period/tokyo facades:
        if ((height > 8 || isTokyo) && (i === 0 || i === bays - 1) && (isTokyo ? r < 0.94 : r < 0.6)) {
          const [uVert, vVert] = tileUv(Math.floor(hash(mz * 1.7 + i, mx * 0.8) * SIGN_TILES), isTokyo);
          const edgeOffset = (i === 0 ? -1 : 1) * 1.35;
          const bannerH = isTokyo ? 4.8 : 3.8;
          signs.push({
            m: placeBoard(mx + ux * edgeOffset + best.nx * 0.22, base + (isTokyo ? 6.2 : 7.6), mz + uz * edgeOffset + best.nz * 0.22, yaw, 1.05, bannerH),
            u: uVert,
            v: vVert,
          });
        }
        // Tokyo street-level Japanese details: sidewalk vending machines & illuminated boxes
        if (isTokyo) {
          if (r < 0.55) {
            batch.add('props/sign_wall_box', place(mx + best.nx * 0.25, base + 2.3, mz + best.nz * 0.25, yaw));
          }
          if (i === 0 && r < 0.65) {
            // Sidewalk vending machine / utility fixture
            batch.add('props/junction_box', place(mx + best.nx * 1.6 - ux * 0.5, base, mz + best.nz * 1.6 - uz * 0.5, yaw));
          }
          if (bays >= 3 && i === 1 && r < 0.45) {
            // Outdoor Izakaya / Ramen street stall
            batch.add('props/market_stall', place(mx + best.nx * 1.9, base, mz + best.nz * 1.9, yaw));
          }
        }
      }

      /* Toppers only where the roofline is in shot. Above about 22m you are
         looking at the underside of the building from a car and the cornice
         is off-screen. */
      if (height < 22) {
        const top = style.mansard && r < 0.3 ? style.mansard : style.topper;
        batch.add(top, place(mx, base + height, mz, yaw));
      }
    }

    // corner verticals, and a fire escape on the industrial stock
    if (style.vertical) {
      for (const e of [-1, 1]) {
        const o = e * (best.half - 0.35);
        batch.add(style.vertical,
          place(px + ux * o, base, pz + uz * o, yaw));
      }
    }
    if (style.escape && seed < 0.4 && height > 9) {
      batch.add(style.escape, place(px, base + GROUND_H, pz, yaw));
    }

    /* Side walls: air-con units and junction boxes, the clutter a real flank
       carries. Every 6m along each face that is not the frontage, a little
       under half of the slots, 3-7m up. Kit assets, lod1, one draw each per
       chunk through the same batch. */
    if (signs) {
      for (const f of faces) {
        if (f === best || (f.lx === -best.lx && f.lz === -best.lz)) continue;   // frontage and its back
        const nx = f.lx * ca - f.lz * sa, nz = f.lx * sa + f.lz * ca;
        const sx = -nz, sz = nx;
        const fyaw = Math.atan2(nx, nz);
        const fx = x + nx * (f.out + 0.05), fz = z + nz * (f.out + 0.05);
        for (let o = -f.half + 3; o < f.half - 2; o += 6) {
          const h = hash(fx + o, fz - o);
          if (h > 0.45) continue;
          const asset = h < 0.32 ? 'props/hvac_unit' : 'props/junction_box';
          const hy = asset === 'props/hvac_unit' ? 3 + h * 12 : 1.4 + h * 4;
          if (hy > height - 2) continue;
          batch.add(asset, place(fx + sx * o, base + hy, fz + sz * o, fyaw));
        }
      }
    }
  }
}

/**
 * Every lamp head in the district, from the same rows, seeds and guards
 * kerbside() uses -- so the far glare sprite (world/glare.js) sits exactly
 * where the real lamp will stand when its chunk streams in. Cheap: pure
 * arithmetic over the segment list, run once at load.
 */
export function farLampHeads(district) {
  const out = [];
  for (const s of district.segments) {
    if (s.cls === 'freeway' || s.cls === 'ramp') continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 22) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    for (const row of KERB_ROWS) {
      if (!row.asset.includes('lamp')) continue;
      if (row.on && !row.on.includes(s.cls)) continue;
      const arterial = row.asset.includes('arterial');
      const reach = arterial ? 1.55 : 0.30, h = arterial ? 8.2 : 6.02;
      for (let t = rowStart(row, s); t < L - 8; t += row.every) {
        const seed = hash(s.ax + t * 1.31, s.az + t * 0.77);
        if (seed > row.chance) continue;
        const side = hash(s.az + t, s.ax) < 0.5 ? 1 : -1;
        const off = (s.half + row.offset) * side;
        const px = s.ax + ux * t + nx * off, pz = s.az + uz * t + nz * off;
        if (district.tarmacDepth(px, pz) <= 0.2) continue;
        const yaw = Math.atan2(nx * -side, nz * -side);
        const y = KERB_H + district.elevationAt(px, pz);
        out.push({ x: px + Math.sin(yaw) * reach, y: y + h, z: pz + Math.cos(yaw) * reach });
      }
    }
  }
  return out;
}
