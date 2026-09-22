import * as THREE from 'three';
import { M4, mergeGeos } from '../core/geometry.js';
import { InstanceBatch } from './catalogue.js';
import { SHADOW_FAR_LAYER } from '../core/renderer.js';

/**
 * The river's edge.
 *
 * The Halstead river is 110 m wide and runs the full 3 km height of the map,
 * and until now it was a HOLE: water.js cuts it out of the ground plate and
 * fills it, and nothing else in the project touched it. No wall, no coping, no
 * trees, no lamps. Measured along THE EMBANKMENT -- the 28 m arterial that
 * follows it for 1,281 m and is the spine of the scenic route -- the road sits
 * 57 to 190 m back from the water with nothing in between, so the longest,
 * most-driven stretch of the route was a road through a field with a blue strip
 * somewhere off to one side.
 *
 * This gives the river two banks: a concrete wall from the waterline up to the
 * land plate, a stone coping along its top, and a row of plane trees, lamps and
 * benches behind it. The wall is procedural and merged (one draw per material,
 * ~10 tris per 6 m panel), because 3 km of authored balustrade at 708 triangles
 * a section is 650,000 triangles for something you mostly see from 100 m away;
 * the authored balustrade stays on the promenade, where you stand next to it.
 *
 * Built once and static, like beach.js and surrounds.js -- it is a 3 km line,
 * not a chunk.
 */

const WATER_Y = -2.6;          // water.js's plane
const BANK_Y = 0.18;           // the land plate at the river's edge
const WALL_FOOT = -3.6;        // the wall continues below the water so there is no gap in swell
const COPING = 0.42;           // height of the coping above the bank
const PANEL = 6;               // wall panel length: the merge step along the bank

const hash = (x, z) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/**
 * Build both banks of the river.
 *
 * @param scene      the scene to add to
 * @param district   a District (reads water.river and tarmacDepth)
 * @param day        unused for now; kept to match beach/port signatures
 * @param catalogue  the asset catalogue. Without one the authored row (trees,
 *                   lamps, benches) is skipped and you get the wall only --
 *                   these are authored assets or nothing, not boxes.
 */
export function buildRiverside(scene, district, day = true, catalogue = null) {
  const group = new THREE.Group();
  group.name = 'riverside';
  const river = district?.data?.water?.river ?? district?.water?.river;
  if (!river?.points?.length) { scene.add(group); return { group }; }

  const pts = river.points;
  const HALF = river.width / 2;
  const B = district.bounds ?? { w: 4200, h: 3000 };

  /* Walk the polyline once and keep a frame at every panel: the point, the
     unit direction, and the unit normal. Both banks are this frame offset by
     +/- HALF, so they cannot drift apart the way two independent walks would. */
  const frames = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const n = Math.max(1, Math.round(L / PANEL));
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * L, t1 = ((k + 1) / n) * L;
      frames.push({
        x0: ax + dx * t0, z0: az + dz * t0,
        x1: ax + dx * t1, z1: az + dz * t1,
        dx, dz, nx: dz, nz: -dx,
      });
    }
  }

  const lib = (name, tint = null, fallback = 0x9a9a9a) => {
    const m = catalogue?.materials?.get?.(name);
    if (!m) return new THREE.MeshLambertMaterial({ color: tint ?? fallback });
    if (tint === null) return m;
    const c = m.clone(); c.color = new THREE.Color(tint); c.name = `${name}:${tint.toString(16)}`;
    return c;
  };
  const solid = (parts, mat) => {
    if (!parts.length) return null;
    const m = new THREE.Mesh(mergeGeos(parts), mat);
    m.castShadow = false;              // a 3 km wall in every cascade is not worth its shadow
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.layers.enable(SHADOW_FAR_LAYER);
    group.add(m);
    return m;
  };

  const inMap = (x, z) => x > 8 && z > 8 && x < B.w - 8 && z < B.h - 8;

  /* ---- the wall and its coping, both banks ---- */
  const wallParts = [], copeParts = [];
  for (const f of frames) {
    for (const side of [-1, 1]) {
      const ox = f.nx * HALF * side, oz = f.nz * HALF * side;
      const mx = (f.x0 + f.x1) / 2 + ox, mz = (f.z0 + f.z1) / 2 + oz;
      if (!inMap(mx, mz)) continue;
      const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) + 0.05;   // overlap: no hairline seams
      const yaw = Math.atan2(f.dx, f.dz);

      // wall face: waterline to the land plate
      const h = BANK_Y - WALL_FOOT;
      const g = new THREE.BoxGeometry(0.9, h, len);
      g.applyMatrix4(M4(mx, WALL_FOOT + h / 2, mz, 0, yaw, 0, 1, 1, 1));
      wallParts.push(g);

      // coping: a proud stone lip, the line that reads as an embankment at distance
      const c = new THREE.BoxGeometry(1.25, COPING, len);
      c.applyMatrix4(M4(mx, BANK_Y + COPING / 2, mz, 0, yaw, 0, 1, 1, 1));
      copeParts.push(c);
    }
  }
  solid(wallParts, lib('concrete_precast', 0x8e8a82));
  solid(copeParts, lib('stone_dressed', 0xb4ada1));

  /* ---- the authored row behind the coping ----
     Trees, lamps and benches, on an InstanceBatch so the whole 3 km is a
     handful of draws. Spacings are deliberately coarse: a plane tree is
     ~1.3k triangles and the river is long, so every 26 m on each bank is
     ~230 trees, and that is already a third of a million triangles. */
  if (catalogue) {
    const batch = new InstanceBatch(catalogue);
    const props = new THREE.Group();
    props.name = 'riverside-props';
    group.add(props);

    const put = (name, f, side, back, turn = 0, sc = 1) => {
      const ox = f.nx * (HALF + back) * side, oz = f.nz * (HALF + back) * side;
      const x = (f.x0 + f.x1) / 2 + ox, z = (f.z0 + f.z1) / 2 + oz;
      if (!inMap(x, z)) return false;
      // never put a tree or a lamp in a carriageway: the river passes under ten
      // bridges and their approaches come right down to the bank
      if (district.tarmacDepth(x, z) < 1.5) return false;
      batch.add(name, M4(x, BANK_Y, z, 0, Math.atan2(f.dx, f.dz) + turn, 0, sc, sc, sc));
      return true;
    };

    const TREES = ['vegetation/tree_plane', 'vegetation/tree_willow', 'vegetation/tree_plane', 'vegetation/tree_ginkgo'];
    let step = 0;
    for (const f of frames) {
      step++;
      for (const side of [-1, 1]) {
        const s = step * 2 + (side > 0 ? 1 : 0);
        /* A plane-tree row, the London embankment cue, 4.5 m behind the coping.
           Every 7th panel = ~42 m, not every 4th. Measured: at 24 m spacing the
           riverside cost 338k triangles and tipped the Old Quarter river
           junction from 4.03M to 4.37M, over the 4.0M budget, for a row that is
           60-190 m from the road you drive. Spacing is the cheapest lever --
           the wall and coping are only ~40k of the total. */
        if (step % 7 === 0) {
          const sp = TREES[Math.floor(hash(s, 11) * TREES.length) % TREES.length];
          put(sp, f, side, 4.5 + hash(s, 13) * 1.2, hash(s, 17) * 6.28, 0.9 + hash(s, 19) * 0.35);
        }
        // lamps: sparser than the tree row and offset from it, so the two
        // rhythms do not beat against each other
        if (step % 7 === 3) put('props/double_lantern_lamp', f, side, 2.4);
        // a bench facing the water every so often
        if (step % 13 === 6) put('props/park_bench', f, side, 3.2, Math.PI / 2);
      }
    }
    batch.emit(props, { lod: 1 }).then(() => {
      // culled like the beach props: not a bundle, and 194k tris of trees were casting from across the map
      props.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.geometry?.computeBoundingSphere?.(); } });
    });
  }

  scene.add(group);
  return { group };
}
