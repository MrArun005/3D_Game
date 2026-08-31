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

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Assets are authored Y-up with the origin at the base, so placement is a
 *  position, a yaw and a uniform scale. */
function place(x, y, z, yaw, scale = 1) {
  _e.set(0, yaw, 0);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z), _q.setFromEuler(_e), _s.set(scale, scale, scale),
  );
}

/* ------------------------------------------------------------------ *
 *  Kerbside furniture
 *
 *  `every` is the spacing in metres, `chance` the probability at each
 *  candidate slot, and `on` restricts a row to a class of street. The lamps
 *  are the only mandatory row -- everything else is scattered, or the
 *  pavement turns into a showroom.
 * ------------------------------------------------------------------ */
const KERB_ROWS = [
  { asset: 'props/lamp_arterial', every: 34, chance: 1.00, on: ['arterial', 'boundary'], offset: 1.6 },
  { asset: 'props/lamp_local',    every: 30, chance: 1.00, on: ['street', 'local'],      offset: 1.5 },
  { asset: 'props/bench',         every: 46, chance: 0.34, offset: 3.4 },
  { asset: 'props/bin',           every: 52, chance: 0.34, offset: 1.9 },
  { asset: 'props/bike_rack',     every: 74, chance: 0.26, offset: 3.1 },
  { asset: 'props/parking_meter', every: 26, chance: 0.20, on: ['street', 'local'], offset: 1.7 },
  { asset: 'props/hydrant',       every: 68, chance: 0.30, offset: 1.7 },
  { asset: 'props/post_box',      every: 96, chance: 0.26, offset: 2.0 },
  { asset: 'props/phone_box',     every: 128, chance: 0.22, offset: 2.6 },
  { asset: 'props/bus_shelter',   every: 150, chance: 0.34, on: ['arterial'], offset: 3.6 },
  { asset: 'props/bollard',       every: 12, chance: 0.30, on: ['arterial'], offset: 1.1 },
  { asset: 'props/planter',       every: 58, chance: 0.24, offset: 2.9 },
  { asset: 'props/banner_pole',   every: 88, chance: 0.30, on: ['arterial'], offset: 1.5 },
  { asset: 'props/notice_board',  every: 112, chance: 0.20, offset: 2.6 },
  { asset: 'props/a_frame_sign',  every: 84, chance: 0.26, offset: 3.6 },
  { asset: 'props/cafe_umbrella', every: 92, chance: 0.24, offset: 4.1 },
  { asset: 'props/utility_pole',  every: 64, chance: 0.28, on: ['street', 'local'], offset: 1.3 },
  { asset: 'props/junction_box',  every: 104, chance: 0.22, offset: 2.2 },
  { asset: 'props/street_sign',   every: 70, chance: 0.30, offset: 1.4 },
  { asset: 'props/sign_projecting', every: 78, chance: 0.22, offset: 4.4 },
  { asset: 'props/tree_blockout', every: 40, chance: 0.42, offset: 3.0, scale: [0.85, 1.35] },
  { asset: 'props/shrub_blockout', every: 54, chance: 0.26, offset: 3.8, scale: [0.8, 1.2] },
  { asset: 'props/railing',       every: 8,  chance: 0.14, on: ['arterial'], offset: 2.5, align: true },
  { asset: 'props/hedge_run',     every: 10, chance: 0.10, on: ['street'],   offset: 4.6, align: true },
];

/** Flat things that belong ON the carriageway, not the pavement. */
const ROAD_ROWS = [
  { asset: 'props/manhole',     every: 44, chance: 0.40, lateral: 0.35 },
  { asset: 'props/drain_grate', every: 30, chance: 0.45, lateral: 0.92 },
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

const PARK_KIT = [
  { asset: 'props/park_bench',      weight: 5 },
  { asset: 'props/tree_blockout',   weight: 9, scale: [1.0, 1.8] },
  { asset: 'props/shrub_blockout',  weight: 6, scale: [0.8, 1.4] },
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
  const { segments, blocks, district, solids, pools } = ctx;
  kerbside(batch, segments, district, solids, pools);
  roads(batch, segments, district);
  blockDressing(batch, blocks, district, solids);
}

function kerbside(batch, segments, district, solids, pools) {
  for (const s of segments) {
    if (s.cls === 'freeway' || s.cls === 'ramp') continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 22) continue;
    const ux = dx / L, uz = dz / L;
    const nx = -uz, nz = ux;

    /* One roadworks site per long segment, seeded -- clustered, because a
       single cone on an empty street reads as a mistake rather than as work. */
    const works = hash(s.ax * 0.7, s.bz * 1.3) < 0.08 && L > 70
      ? 24 + hash(s.bx, s.az) * (L - 60) : -1;

    for (const row of KERB_ROWS) {
      if (row.on && !row.on.includes(s.cls)) continue;
      for (let t = 10; t < L - 8; t += row.every) {
        const seed = hash(s.ax + t * 1.31, s.az + t * 0.77);
        if (seed > row.chance) continue;
        const side = hash(s.az + t, s.ax) < 0.5 ? 1 : -1;
        const off = (s.half + row.offset) * side;
        const px = s.ax + ux * t + nx * off;
        const pz = s.az + uz * t + nz * off;
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
                       z: pz - Math.sin(yaw) * 1.4, size: 13 });
        }
        if (row.asset.includes('lamp') || row.asset.includes('tree')
            || row.asset.includes('phone') || row.asset.includes('shelter')) {
          solids.push({ x: px, z: pz, yaw: 0, offsets: [0],
            radius: row.asset.includes('shelter') ? 1.6 : 0.32, reach: 2.0, tag: 'prop' });
        }
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
          const k = pick(PARK_KIT, hash(px * 1.7, pz * 0.3));
          const sc = k.scale
            ? k.scale[0] + hash(pz, px) * (k.scale[1] - k.scale[0]) : 1;
          batch.add(k.asset, place(px, KERB_H + district.elevationAt(px, pz), pz,
            hash(px, pz) * 6.283, sc));
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
          const k = pick(kit, hash(pz, px));
          batch.add(k.asset, place(px, KERB_H + district.elevationAt(px, pz), pz,
            Math.round(hash(px, pz) * 4) * (Math.PI / 2) + bl.angle));
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
      // a fenced perimeter is what makes a lot read as private ground
      if (!harbour) {
        for (let lx = -bl.w / 2; lx < bl.w / 2; lx += 3.2) {
          for (const side of [-1, 1]) {
            const [px, pz] = toWorld(lx, side * (bl.h / 2 - 0.6));
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
    const y = KERB_H + b.height;
    const n = 1 + Math.floor(hash(b.x, b.z) * 3);
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    for (let i = 0; i < n; i++) {
      const r = hash(b.x + i * 3.7, b.z - i * 1.9);
      const k = pick(ROOF_KIT, r);
      const lx = (hash(b.z + i, b.x) - 0.5) * (b.hw * 1.3);
      const lz = (hash(b.x, b.z + i) - 0.5) * (b.hd * 1.3);
      const px = b.x + lx * ca - lz * sa;
      const pz = b.z + lx * sa + lz * ca;
      batch.add(k.asset, place(px, y, pz, b.angle + Math.round(r * 4) * (Math.PI / 2)));
    }
    // a parapet round the edge reads at street level as a real roofline
    if (hash(b.z, b.x) < 0.55) {
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
};

/** Which kit a building wears. Height is the honest proxy for what it is. */
function styleFor(box, r) {
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
export function dressFacades(batch, boxes, district, roadNear) {
  for (const box of boxes) {
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
  }
}
