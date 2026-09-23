import * as THREE from 'three';
import { texture, uv, attribute, vec2, materialReference } from 'three/tsl';
import { cv, toTex } from './textures.js';
import { mulberry32 } from '../core/rng.js';

/**
 * Wear decals -- Phase 3 of the visual brief. "Materials create age", and a
 * tileable material alone cannot: a road only looks used where something used
 * it. Repaired patches, oil where cars stand, rubber where they pull away,
 * salt and grime along the kerb, runoff under a ledge.
 *
 * Built exactly like world/signs.js: ONE seeded canvas atlas (4 x 4 tiles of
 * 256 px), one node material whose colour and opacity sample the atlas through
 * a per-instance cell in `aTile`, one unit quad. A chunk's worth of wear is a
 * single instanced draw.
 *
 * Placement is seeded PER SEGMENT, not per chunk, so a road that crosses a
 * chunk boundary lays the same decals from either side and `bounds` can throw
 * away the ones that belong to the neighbour -- no doubles at the seam, no
 * reshuffle when the ring changes.
 *
 * The quad lies 12 mm above the carriageway AND carries a small polygon offset
 * (-1, the tarmac is 0 and the road paint is -2, so a repair patch sits over
 * the asphalt and UNDER the white line, which is the order it happens in).
 * Not additive, so no MRT normal guard: the quad's normal is the road's normal
 * and alpha-blending it into the normal target changes nothing.
 */
export const DECAL_COLS = 4, DECAL_ROWS = 4, DECAL_TILES = DECAL_COLS * DECAL_ROWS;
const TILE = 256;

/* Atlas cells by kind. A caller dressing a wall picks RUNOFF or SALT itself. */
export const KIND = {
  PATCH: [0, 1, 2, 3],      // repaired asphalt: saw-cut reinstatements and a pothole fill
  OIL: [4, 5],              // drips where traffic stands
  TYRE: [6, 7],             // wheel tracks and one lock-up skid
  SCRUB: [8],               // rubber scrubbed round a turn
  SALT: [9, 10],            // pale efflorescence / salt wash at the kerb
  RUNOFF: [11, 12],         // dark streaks below a ledge (walls)
  DRAIN: [13],              // stain fanning out of a gully
  CRACK: [14],              // tar-sealed crack network
  GRIME: [15],              // generic dirt wash
};

/** Atlas offset for a tile index, in UV. Canvas row 0 is the top, so v flips. */
export function decalUv(tile) {
  const t = ((tile % DECAL_TILES) + DECAL_TILES) % DECAL_TILES;
  return [(t % DECAL_COLS) / DECAL_COLS, 1 - (Math.floor(t / DECAL_COLS) + 1) / DECAL_ROWS];
}

// ---------------------------------------------------------------- the atlas

const soft = (g, x, y, r, a, col = '0,0,0') => {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, `rgba(${col},${a})`);
  grd.addColorStop(0.55, `rgba(${col},${a * 0.55})`);
  grd.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grd;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
};

/** A ragged closed path -- a saw-cut reinstatement is never a clean rectangle. */
const ragged = (g, rnd, x0, y0, w, h, jitter) => {
  g.beginPath();
  const pt = (px, py) => [px + (rnd() - 0.5) * jitter, py + (rnd() - 0.5) * jitter];
  const n = 5;
  let p = pt(x0, y0); g.moveTo(p[0], p[1]);
  for (let i = 1; i <= n; i++) { p = pt(x0 + (w * i) / n, y0); g.lineTo(p[0], p[1]); }
  for (let i = 1; i <= n; i++) { p = pt(x0 + w, y0 + (h * i) / n); g.lineTo(p[0], p[1]); }
  for (let i = 1; i <= n; i++) { p = pt(x0 + w - (w * i) / n, y0 + h); g.lineTo(p[0], p[1]); }
  for (let i = 1; i <= n; i++) { p = pt(x0, y0 + h - (h * i) / n); g.lineTo(p[0], p[1]); }
  g.closePath();
};

/** A wandering line -- a crack, a tar seal, a drip. */
const wander = (g, rnd, x, y, len, step, spread, angle) => {
  g.beginPath(); g.moveTo(x, y);
  let a = angle;
  for (let i = 0; i < len; i++) {
    a += (rnd() - 0.5) * spread;
    x += Math.cos(a) * step; y += Math.sin(a) * step;
    g.lineTo(x, y);
  }
  g.stroke();
  return [x, y, a];
};

export function texDecalAtlas() {
  const c = cv(TILE * DECAL_COLS, TILE * DECAL_ROWS), g = c.getContext('2d');
  const rnd = mulberry32(1907);
  const M = 10;                                   // transparent margin: mip bleed between cells
  for (let t = 0; t < DECAL_TILES; t++) {
    const x0 = (t % DECAL_COLS) * TILE, y0 = Math.floor(t / DECAL_COLS) * TILE;
    g.save();
    g.beginPath(); g.rect(x0 + M, y0 + M, TILE - 2 * M, TILE - 2 * M); g.clip();
    g.translate(x0, y0);
    const S = TILE;

    if (t <= 2) {
      // saw-cut reinstatement: fresh dark asphalt, a sealed lip, coarse grain
      g.fillStyle = 'rgba(22,22,25,0.80)';
      ragged(g, rnd, 22 + rnd() * 20, 30 + rnd() * 24, S - 70 - rnd() * 30, S - 90 - rnd() * 40, 13);
      g.fill();
      g.strokeStyle = 'rgba(12,12,14,0.85)'; g.lineWidth = 5 + rnd() * 4; g.stroke();
      g.strokeStyle = 'rgba(60,58,55,0.35)'; g.lineWidth = 1.6; g.stroke();
      for (let i = 0; i < 420; i++) {              // grain, so the patch is not a flat slab
        g.fillStyle = `rgba(${90 + rnd() * 60 | 0},${88 + rnd() * 60 | 0},${84 + rnd() * 55 | 0},${rnd() * 0.16})`;
        g.fillRect(30 + rnd() * (S - 70), 34 + rnd() * (S - 80), 1 + rnd() * 3, 1 + rnd() * 3);
      }
    } else if (t === 3) {
      // pothole fill: a blob of cold-lay, proud and gritty
      g.fillStyle = 'rgba(16,16,18,0.86)';
      g.beginPath();
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2, r = 58 + rnd() * 34;
        const px = S / 2 + Math.cos(a) * r, py = S / 2 + Math.sin(a) * r * 0.8;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${120 + rnd() * 70 | 0},${118 + rnd() * 70 | 0},${112 + rnd() * 65 | 0},${rnd() * 0.22})`;
        g.fillRect(S / 2 - 80 + rnd() * 160, S / 2 - 70 + rnd() * 140, 1 + rnd() * 3, 1 + rnd() * 3);
      }
    } else if (t <= 5) {
      // oil: a few overlapping pools with a rainbow-free dark core and drips
      for (let i = 0; i < 4; i++) soft(g, S * (0.32 + rnd() * 0.36), S * (0.3 + rnd() * 0.4), 34 + rnd() * 44, 0.42 + rnd() * 0.25, '10,9,8');
      for (let i = 0; i < 26; i++) soft(g, S * (0.2 + rnd() * 0.6), S * (0.15 + rnd() * 0.7), 3 + rnd() * 8, 0.45, '10,9,8');
    } else if (t <= 7) {
      // wheel tracks / a lock-up skid: rubber laid down the tile
      const lanes = t === 6 ? [S * 0.34, S * 0.66] : [S * 0.5];
      for (const lx of lanes) {
        const w = t === 6 ? 26 : 40;
        for (let i = 0; i < 170; i++) {
          const y = M + rnd() * (S - 2 * M);
          const fade = t === 6 ? 1 : Math.sin((y / S) * Math.PI);       // a skid starts hard and dies
          g.fillStyle = `rgba(14,13,13,${(0.05 + rnd() * 0.10) * fade})`;
          g.fillRect(lx - w / 2 + (rnd() - 0.5) * 8, y, w * (0.6 + rnd() * 0.5), 2 + rnd() * 5);
        }
      }
    } else if (t === 8) {
      // rubber scrubbed round a turn
      g.strokeStyle = 'rgba(16,15,15,0.16)'; g.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        g.lineWidth = 4 + rnd() * 12;
        g.beginPath();
        g.moveTo(M, S * (0.55 + rnd() * 0.3));
        g.quadraticCurveTo(S * 0.5, S * (0.75 + rnd() * 0.2), S - M, S * (0.15 + rnd() * 0.3));
        g.stroke();
      }
    } else if (t <= 10) {
      // salt / efflorescence wash: pale, wispy, runs downhill
      for (let i = 0; i < 22; i++) {
        const x = M + rnd() * (S - 2 * M);
        const grd = g.createLinearGradient(0, 0, 0, S);
        grd.addColorStop(0, 'rgba(226,224,214,0.00)');
        grd.addColorStop(0.35, `rgba(226,224,214,${0.10 + rnd() * 0.14})`);
        grd.addColorStop(1, 'rgba(226,224,214,0.00)');
        g.fillStyle = grd;
        g.fillRect(x, M, 4 + rnd() * 22, S - 2 * M);
      }
      for (let i = 0; i < 10; i++) soft(g, M + rnd() * (S - 2 * M), S * (0.3 + rnd() * 0.5), 18 + rnd() * 30, 0.10, '230,228,218');
    } else if (t <= 12) {
      // runoff under a ledge: darkest at the top edge, streaky, fading down
      const grd = g.createLinearGradient(0, M, 0, S - M);
      grd.addColorStop(0, 'rgba(18,18,20,0.55)');
      grd.addColorStop(0.25, 'rgba(20,20,22,0.30)');
      grd.addColorStop(1, 'rgba(22,22,24,0.00)');
      g.fillStyle = grd; g.fillRect(M, M, S - 2 * M, S - 2 * M);
      g.strokeStyle = 'rgba(14,14,16,0.30)'; g.lineCap = 'round';
      for (let i = 0; i < 20; i++) {
        g.lineWidth = 2 + rnd() * 9;
        g.beginPath();
        const x = M + rnd() * (S - 2 * M);
        g.moveTo(x, M);
        g.lineTo(x + (rnd() - 0.5) * 14, M + (0.3 + rnd() * 0.6) * (S - 2 * M));
        g.stroke();
      }
    } else if (t === 13) {
      // gully stain: a fan spreading out of the grating
      const grd = g.createRadialGradient(S / 2, M, 4, S / 2, M, S * 0.9);
      grd.addColorStop(0, 'rgba(14,14,15,0.55)');
      grd.addColorStop(1, 'rgba(16,16,18,0.00)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(S * 0.5, M);
      g.lineTo(S - M, S - M); g.lineTo(M, S - M); g.closePath(); g.fill();
    } else if (t === 14) {
      // crack network, sealed with tar: black snakes with a grey halo
      for (let i = 0; i < 7; i++) {
        const sx = M + rnd() * (S - 2 * M), sy = M + rnd() * (S - 2 * M), a = rnd() * 7;
        g.strokeStyle = 'rgba(40,39,38,0.35)'; g.lineWidth = 9 + rnd() * 6; g.lineCap = 'round';
        wander(g, mulberry32(1000 + i), sx, sy, 16, 11, 0.7, a);
        g.strokeStyle = 'rgba(10,10,11,0.85)'; g.lineWidth = 3 + rnd() * 3;
        wander(g, mulberry32(1000 + i), sx, sy, 16, 11, 0.7, a);
      }
    } else {
      // generic grime wash for a kerb line or the base of a wall
      for (let i = 0; i < 7; i++) soft(g, S * (0.2 + rnd() * 0.6), S * (0.2 + rnd() * 0.6), 50 + rnd() * 60, 0.16, '26,25,23');
    }
    g.restore();
  }
  const tex = toTex(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

let MAT = null;
/**
 * The shared material. Every property is read through a reference PINNED to
 * this material (third argument) -- the shadow pass compiles a colorNode
 * inside its own depth material, where an unpinned reference has no `.color`
 * (see city.js:makeTileable).
 */
export function decalMaterial() {
  if (MAT) return MAT;
  const atlas = texDecalAtlas();
  const m = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff, roughness: 0.94, metalness: 0,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  m.name = 'wear_decal';
  const cell = uv().mul(vec2(1 / DECAL_COLS, 1 / DECAL_ROWS)).add(attribute('aTile', 'vec2'));
  const s = texture(atlas, cell);
  m.colorNode = s.rgb.mul(materialReference('color', 'color', m));
  m.opacityNode = s.a.mul(attribute('aFade', 'float')).mul(materialReference('opacity', 'float', m));
  MAT = m;
  return m;
}

/** One quad, +Z out of the face, unit size: the instance matrix carries metres. */
export function decalGeometry() {
  return new THREE.PlaneGeometry(1, 1);
}

// ---------------------------------------------------------------- placement

const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(RIGHT, -Math.PI / 2);   // quad -> lies in XZ, normal up

/** Stable per-segment seed: the same road seeds the same wear from any chunk. */
function segSeed(s, salt) {
  const q = (v, k) => Math.imul(Math.round(v * 8) | 0, k);
  return (q(s.ax, 374761393) ^ q(s.az, 668265263) ^ q(s.bx, 2246822519) ^ q(s.bz, 3266489917) ^ Math.imul(salt | 0, 2654435761)) >>> 0;
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

/**
 * Wear for a set of road segments.
 *
 * @param segments  district.segments entries ({ax,az,bx,bz,half,cls}). Hand in
 *                  EVERY segment near the window, not the chunk's own list:
 *                  districtWorld's segByChunk owns a segment by its MIDPOINT,
 *                  and 66% of the district's road length lies outside its
 *                  owner chunk, so feeding that list leaves two thirds of the
 *                  city unworn. `district.segmentsNear(centre, CHUNK)` is the
 *                  right feed -- the per-segment seed makes the overlap free.
 * @param district  needs tarmacDepth() (is this ON the road) and elevationAt()
 * @param seed      salt; the per-decal seed comes from the segment itself
 * @param opts      { bounds:{x0,z0,x1,z1}, max=400, spacing=17, y=0.012 }
 * @returns { count, matrices: Matrix4[], tiles: Float32Array(2n), fades: Float32Array(n) }
 *
 * Budget: one instanced draw per chunk, capped at `max` (400) instances.
 */
export function buildDecals(segments, district, seed = 0, opts = {}) {
  const max = opts.max ?? 400;
  const spacing = opts.spacing ?? 17;
  const lift = opts.y ?? 0.012;
  const b = opts.bounds ?? null;
  /* The junction pass reads the nav graph, not the segment list, so without a
     window it would wear every junction in the district. Fall back to the
     bounding box of the segments we were actually given. */
  let jb = segments.length ? b : null;          // no roads handed in, no wear at all
  if (segments.length && !jb) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const s of segments) {
      if (!s) continue;
      x0 = Math.min(x0, s.ax, s.bx); x1 = Math.max(x1, s.ax, s.bx);
      z0 = Math.min(z0, s.az, s.bz); z1 = Math.max(z1, s.az, s.bz);
    }
    jb = x0 <= x1 ? { x0, z0, x1, z1 } : null;
  }
  const matrices = [], tiles = [], fades = [];
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), quat = new THREE.Quaternion();

  const put = (x, z, yaw, w, h, tile, fade) => {
    if (matrices.length >= max) return;
    if (b && (x < b.x0 || x >= b.x1 || z < b.z0 || z >= b.z1)) return;
    /* ON the tarmac: tarmacDepth is SIGNED and negative on the road, and it is
       the distance to the nearest road EDGE -- so asking for w/2 of clearance
       is exactly "no part of this quad hangs over the kerb", for free, in the
       call we were making anyway. The centre test alone put 4.7% of the
       district's wear partly on the pavement (a kerb decal sits 0.45 m inside
       the kerb and is up to 1.3 m wide). tarmacDepth is 3.7 us a call -- by
       far the most expensive thing here -- so this does NOT become four. */
    if (district.tarmacDepth(x, z) > -Math.max(0.15, w * 0.5)) return;
    /* The quad is also FLAT, and one laid across a bridge approach sat on
       ground that rose 9.4 m end to end (1.7% of the wear): a plate standing
       out of the road. elevationAt is 0.2 us, so that one IS worth four. */
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const ax = ca * w * 0.5, az = -sa * w * 0.5;       // half the width, across the road
    const bx = sa * h * 0.5, bz = ca * h * 0.5;        // half the length, along it
    let top = -Infinity, bot = Infinity;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1;
      const e = district.elevationAt?.(x + ax * sx + bx * sz, z + az * sx + bz * sz) ?? 0;
      if (e > top) top = e;
      if (e < bot) bot = e;
    }
    if (top - bot > lift) return;                      // the ground under it is not flat
    pos.set(x, top + lift, z);
    quat.setFromAxisAngle(UP, yaw).multiply(FLAT);
    scl.set(w, h, 1);
    const m = new THREE.Matrix4().compose(pos, quat, scl);
    matrices.push(m);
    const [u, v] = decalUv(tile);
    tiles.push(u, v);
    fades.push(fade);
  };

  for (const s of segments) {
    if (!s) continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    if (len < 4) continue;
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;                       // road normal, in plan
    const yaw = Math.atan2(dx, dz);                // the quad's long axis runs with the road
    const half = s.half ?? 4;
    const rnd = mulberry32(segSeed(s, seed));
    const at = (t, off) => [s.ax + ux * t + nx * off, s.az + uz * t + nz * off];

    /* Down the run: wheel tracks, oil, patches, cracks. The lateral offset is
       the wheel track (0.45 of the half width), which is where a road wears. */
    const n = Math.floor(len / spacing);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.15 + rnd() * 0.7) * spacing;
      const side = rnd() < 0.5 ? -1 : 1;
      const r = rnd();
      const track = side * half * (0.28 + rnd() * 0.36);
      if (r < 0.30) {
        const [x, z] = at(t, track);
        put(x, z, yaw, 0.55 + rnd() * 0.35, 3.0 + rnd() * 3.5, pick(rnd, KIND.TYRE), 0.35 + rnd() * 0.35);
      } else if (r < 0.55) {
        const [x, z] = at(t, side * half * rnd() * 0.6);
        const w = 1.6 + rnd() * 2.2;
        put(x, z, yaw + (rnd() - 0.5) * 0.12, w, w * (0.7 + rnd() * 0.9), pick(rnd, KIND.PATCH), 0.55 + rnd() * 0.4);
      } else if (r < 0.72) {
        const [x, z] = at(t, track);
        put(x, z, rnd() * 6.28, 0.8 + rnd() * 1.3, 0.8 + rnd() * 1.3, pick(rnd, KIND.OIL), 0.3 + rnd() * 0.35);
      } else if (r < 0.86) {
        const [x, z] = at(t, side * half * rnd() * 0.8);
        put(x, z, rnd() * 6.28, 2.0 + rnd() * 2.4, 2.0 + rnd() * 2.4, KIND.CRACK[0], 0.25 + rnd() * 0.3);
      } else {
        /* Kerb line: salt, grime and the stain out of a gully. Just inside the
           kerb, where the sweeper never reaches. */
        const [x, z] = at(t, side * (half - 0.45));
        const gully = rnd() < 0.25;
        put(x, z, yaw, 0.7 + rnd() * 0.6, gully ? 1.6 + rnd() * 1.4 : 3.0 + rnd() * 4.0,
          gully ? KIND.DRAIN[0] : (rnd() < 0.5 ? pick(rnd, KIND.SALT) : KIND.GRIME[0]), 0.25 + rnd() * 0.35);
      }
    }

    if (matrices.length >= max) break;
  }

  /* Junctions: cars stop, turn and pull away here, so this is where the road
     is worst. Taken from the nav graph's own junction NODES, not from segment
     endpoints -- road polylines run straight THROUGH a junction, so a segment
     end is usually just a polyline joint mid-block (measured: zero of the 55
     segments around a downtown chunk ended at one). Seeded by node id, so a
     junction on a chunk seam belongs to exactly one chunk. */
  for (const nd of (district.fullGraph ?? district.graph)?.nodes ?? []) {   // the whole graph: the compact city clips district.graph to gameplay
    if (matrices.length >= max) break;
    if (nd.kind !== 'cross' && nd.kind !== 'tee') continue;
    if (!jb) break;
    if (nd.x < jb.x0 - 16 || nd.x >= jb.x1 + 16 || nd.y < jb.z0 - 16 || nd.y >= jb.z1 + 16) continue;
    const rnd = mulberry32((Math.imul(nd.id | 0, 2654435761) ^ Math.imul(seed | 0, 374761393)) >>> 0);
    const R = 7 + rnd() * 9;
    const k = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < k; i++) {
      const a = rnd() * 6.28318, d = R * (0.25 + rnd() * 0.85);
      const x = nd.x + Math.cos(a) * d, z = nd.y + Math.sin(a) * d;
      const yaw = a + Math.PI / 2 + (rnd() - 0.5) * 0.6;     // wear runs across the turn
      const r = rnd();
      if (r < 0.40) put(x, z, yaw, 1.8 + rnd() * 2.2, 2.4 + rnd() * 3.0, KIND.SCRUB[0], 0.30 + rnd() * 0.35);
      else if (r < 0.70) put(x, z, rnd() * 6.28, 1.0 + rnd() * 1.4, 1.0 + rnd() * 1.4, pick(rnd, KIND.OIL), 0.35 + rnd() * 0.40);
      else if (r < 0.88) put(x, z, yaw, 0.6 + rnd() * 0.4, 2.6 + rnd() * 2.6, pick(rnd, KIND.TYRE), 0.30 + rnd() * 0.30);
      else put(x, z, rnd() * 6.28, 1.8 + rnd() * 1.6, 1.8 + rnd() * 1.6, pick(rnd, KIND.PATCH), 0.45 + rnd() * 0.35);
    }
  }

  return {
    count: matrices.length,
    matrices,
    tiles: new Float32Array(tiles),
    fades: new Float32Array(fades),
  };
}
