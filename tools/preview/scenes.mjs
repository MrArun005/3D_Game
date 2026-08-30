/**
 * Worked examples: how the kit assembles into things.
 *
 * These are the reference for how districtWorld should consume the catalogue.
 * Note what they never do: name an asset where a tag would work, or await a
 * GLB to find out how big it is.
 */
import * as THREE from 'three';
import { asset, size, byTags, place, human, ground } from './lib.mjs';

const rnd = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

/* ------------------------------------------------------------- building -- */
/**
 * A building is a mass box with facade modules hung on its faces. The mass is
 * still one box; the bays are instanced. A 6-storey block costs one box plus a
 * handful of InstancedMesh draws, which is the whole reason the kit is modular.
 */
export async function building(m, {
  bays = 5, storeys = 5, style = 'period', seed = 7, corner = true,
} = {}) {
  const g = new THREE.Group();
  const r = rnd(seed);

  const bayKeys = byTags(m, 'bay', style).length ? byTags(m, 'bay', style) : byTags(m, 'bay');
  const groundKeys = byTags(m, 'ground', 'retail');
  const topKeys = byTags(m, 'topper');

  const BAY_W = size(m, bayKeys[0])[0];
  const H_GROUND = size(m, groundKeys[0])[1];
  const bayKey = pick(bayKeys, r);
  const H_BAY = size(m, bayKey)[1];
  const width = bays * BAY_W;
  const height = H_GROUND + storeys * H_BAY;
  const depth = 12;

  // the mass. Facade modules are a shell in front of this, not a replacement.
  const mass = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: 0x6a6560, roughness: 0.92 }));
  mass.position.set(0, height / 2, -depth / 2 - 0.4);
  mass.castShadow = mass.receiveShadow = true;
  g.add(mass);

  for (let b = 0; b < bays; b++) {
    const x = b * BAY_W - width / 2 + BAY_W / 2;

    // ground floor: mostly shops, a lobby somewhere in the middle
    const isLobby = b === Math.floor(bays / 2);
    const gk = isLobby ? byTags(m, 'ground', 'commercial')[0] : pick(groundKeys, r);
    place(g, await asset(m, gk), { x });

    // signage over the shopfronts
    if (!isLobby && r() > 0.35) {
      const sk = pick(byTags(m, 'signage', 'retail'), r);
      const sy = H_GROUND - 0.9;
      place(g, await asset(m, sk), { x: x + (r() > 0.5 ? 1.1 : -1.1), y: sy });
    }

    for (let s = 0; s < storeys; s++) {
      const y = H_GROUND + s * H_BAY;
      place(g, await asset(m, bayKey), { x, y });
      // a balcony here and there breaks the grid
      if (style !== 'modern' && s > 0 && r() > 0.72) {
        place(g, await asset(m, 'facade/balcony'), { x, y: y + 0.9 });
      }
    }
  }

  // downpipes on the bay joins, not centred on a bay
  for (let b = 1; b < bays; b++) {
    if (r() > 0.6) continue;
    place(g, await asset(m, 'facade/downpipe'),
      { x: b * BAY_W - width / 2, y: H_GROUND });
  }

  if (corner) for (const sx of [-1, 1]) {
    place(g, await asset(m, 'facade/quoin_corner'),
      { x: sx * (width / 2 - 0.31) * (sx > 0 ? 1 : 1), y: 0, ry: 0, s: 1 });
  }

  // cornice, then parapet on top of it
  const topKey = pick(topKeys.filter((k) => !k.includes('mansard')), r);
  for (let b = 0; b < bays; b++) {
    const x = b * BAY_W - width / 2 + BAY_W / 2;
    place(g, await asset(m, topKey), { x, y: height });
  }

  // roof plant, set back so the parapet hides its base from the street
  const roofY = height + size(m, topKey)[1];
  const plant = byTags(m, 'roof', 'plant');
  for (let i = 0; i < 3; i++) {
    const k = pick(plant, r);
    place(g, await asset(m, k), {
      x: (r() - 0.5) * (width - 4),
      y: roofY,
      z: -depth * 0.35 - r() * 3,
      ry: r() * Math.PI,
    });
  }
  if (r() > 0.5) place(g, await asset(m, 'props/roof_hut'), { x: width * 0.25, y: roofY, z: -depth * 0.6 });

  return g;
}

/* --------------------------------------------------------------- street -- */
/**
 * Street dressing driven entirely by tags. Nothing here names a bin.
 */
export async function street(m, { length = 46, seed = 3, side = 1 } = {}) {
  const g = new THREE.Group();
  const r = rnd(seed);
  const KERB = 5.2;                       // kerb line offset from centreline

  const road = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.1, KERB * 2),
    new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.72 }));
  road.position.y = 0.05; road.receiveShadow = true; g.add(road);

  for (const sz of [-1, 1]) {
    const pave = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.24, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x63656a, roughness: 0.95 }));
    pave.position.set(0, 0.12, sz * (KERB + 2.1));
    pave.receiveShadow = pave.castShadow = true;
    g.add(pave);
  }

  const kerbZ = side * (KERB + 0.5);
  const paveZ = side * (KERB + 2.6);

  // lighting on a fixed rhythm — lamps are not scattered, they are spaced
  const lampKey = byTags(m, 'lighting', 'arterial')[0];
  for (let x = -length / 2 + 6; x < length / 2; x += 22) {
    place(g, await asset(m, lampKey), { x, y: 0.24, z: kerbZ, ry: side > 0 ? Math.PI : 0 });
  }

  // everything else is jittered clutter drawn from the kerb tag pool
  // walk the pool rather than sampling it: with 6 items in the tag, random
  // picking visibly repeats over a 46 m run
  const clutter = byTags(m, 'kerb', 'clutter');
  let ci = Math.floor(r() * clutter.length);
  for (let x = -length / 2 + 3; x < length / 2 - 2; x += 3.4 + r() * 3) {
    if (r() > 0.7) continue;
    place(g, await asset(m, clutter[ci++ % clutter.length]),
      { x, y: 0.24, z: paveZ + (r() - 0.5) * 1.2, ry: r() * Math.PI * 2 });
  }

  place(g, await asset(m, 'props/bus_shelter'), { x: -6, y: 0.24, z: paveZ + 0.4, ry: side > 0 ? Math.PI : 0 });
  place(g, await asset(m, 'props/bench'), { x: 8, y: 0.24, z: paveZ, ry: side > 0 ? Math.PI : 0 });
  place(g, await asset(m, 'props/planter'), { x: 12.5, y: 0.24, z: paveZ });
  place(g, await asset(m, 'props/bike_rack'), { x: 17, y: 0.24, z: paveZ, ry: Math.PI / 2 });
  place(g, await asset(m, 'props/traffic_signal'), { x: length / 2 - 3, y: 0.24, z: kerbZ, ry: Math.PI });
  place(g, await asset(m, 'props/utility_pole'), { x: -length / 2 + 4, y: 0.24, z: -paveZ });
  place(g, await asset(m, 'props/manhole'), { x: 2, y: 0.1, z: 1.5 });
  for (const x of [-14, 6, 20]) place(g, await asset(m, 'props/drain_grate'), { x, y: 0.1, z: kerbZ - 0.35 });

  // cafe spill-out belongs with the cafe frontage, so it is placed, not scattered
  place(g, await asset(m, 'props/cafe_umbrella'), { x: 22.5, y: 0.24, z: paveZ - 1.1 });
  place(g, await asset(m, 'props/a_frame_sign'), { x: 24.4, y: 0.24, z: paveZ - 1.9, ry: 0.4 });

  // roadworks, because a street with nothing wrong with it looks generated
  for (let i = 0; i < 6; i++) {
    place(g, await asset(m, 'props/cone'), { x: -20 + i * 1.9, y: 0.1, z: kerbZ - 1.1 - i * 0.22 });
  }
  place(g, await asset(m, 'props/barrier'), { x: -17.5, y: 0.1, z: kerbZ - 2.4, ry: 0.06 });
  place(g, await asset(m, 'props/barrier'), { x: -13.5, y: 0.1, z: kerbZ - 2.6, ry: -0.04 });
  place(g, await asset(m, 'props/railing'), { x: 1, y: 0.24, z: kerbZ + 0.55, ry: 0 });
  place(g, await asset(m, 'props/railing'), { x: 3.4, y: 0.24, z: kerbZ + 0.55, ry: 0 });

  return g;
}

/* ----------------------------------------------------------------- park -- */
export async function park(m, { seed = 11 } = {}) {
  const g = new THREE.Group();
  const r = rnd(seed);

  g.add(ground(70, 0x5c6b4e));

  const pathKey = 'props/path_segment';
  const PL = size(m, pathKey)[0];
  for (let i = -5; i <= 5; i++) place(g, await asset(m, pathKey), { x: i * PL, z: 0 });
  for (let i = 1; i <= 4; i++) place(g, await asset(m, pathKey), { x: 0, z: i * PL, ry: Math.PI / 2 });
  place(g, await asset(m, 'props/path_junction'), { x: 0, z: 0 });

  place(g, await asset(m, 'props/bandstand'), { x: -13, z: -11 });
  place(g, await asset(m, 'props/fountain'), { x: 12, z: -9 });
  place(g, await asset(m, 'props/park_gate'), { x: 0, z: 19, ry: 0 });

  for (const [x, z, ry] of [[-6, 2.1, Math.PI], [5, 2.1, Math.PI], [-2.4, -2.2, 0], [9, -2.2, 0]]) {
    place(g, await asset(m, 'props/park_bench'), { x, z, ry });
  }
  place(g, await asset(m, 'props/picnic_table'), { x: 16, z: 5 });
  place(g, await asset(m, 'props/litter_bin_park'), { x: -8.4, z: 2.2 });
  place(g, await asset(m, 'props/notice_board'), { x: 2.6, z: 14, ry: Math.PI });

  // playground cluster
  place(g, await asset(m, 'props/swing_set'), { x: -17, z: 8, ry: 0.2 });
  place(g, await asset(m, 'props/slide'), { x: -11, z: 10, ry: -0.6 });
  place(g, await asset(m, 'props/climbing_frame'), { x: -16, z: 15 });
  place(g, await asset(m, 'props/basketball_hoop'), { x: 20, z: 15, ry: Math.PI });

  const HL = size(m, 'props/hedge_run')[0];
  for (let i = -4; i <= 4; i++) place(g, await asset(m, 'props/hedge_run'), { x: i * HL, z: -18 });
  for (const [x, z] of [[-9, -6], [7, 6], [-20, -3]]) {
    place(g, await asset(m, 'props/flower_bed'), { x, z, ry: r() * 0.4 });
  }

  // PLACEHOLDER planting — the weakest thing in the kit, and it shows
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    place(g, await asset(m, 'props/tree_broadleaf'), {
      x: Math.cos(a) * (17 + r() * 8), z: Math.sin(a) * (15 + r() * 7),
      ry: r() * Math.PI * 2, s: 0.85 + r() * 0.45,
    });
  }
  for (let i = 0; i < 14; i++) {
    place(g, await asset(m, 'props/shrub_mass'), {
      x: (r() - 0.5) * 52, z: (r() - 0.5) * 44, ry: r() * Math.PI * 2, s: 0.8 + r() * 0.6,
    });
  }
  return g;
}

/* -------------------------------------------------------------- harbour -- */
export async function harbour(m, { seed = 5 } = {}) {
  const g = new THREE.Group();
  const r = rnd(seed);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 90),
    new THREE.MeshStandardMaterial({ color: 0x1d2f38, roughness: 0.14, metalness: 0 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.35, 26);
  g.add(water);

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(80, 1.8, 34),
    new THREE.MeshStandardMaterial({ color: 0x6b6d70, roughness: 0.95 }));
  apron.position.set(0, 0.9, -17); apron.receiveShadow = true; g.add(apron);

  const QW = size(m, 'props/quay_edge')[0];
  for (let i = -9; i <= 9; i++) place(g, await asset(m, 'props/quay_edge'), { x: i * QW, z: -0.6 });
  for (let i = -8; i <= 8; i += 2) place(g, await asset(m, 'props/mooring_bollard'), { x: i * QW * 0.5, y: 1.82, z: -1.0 });
  for (const x of [-14, 12]) place(g, await asset(m, 'props/quay_ladder'), { x, y: -0.78, z: -0.02 });

  place(g, await asset(m, 'props/dock_crane'), { x: -18, y: 1.8, z: -9, ry: Math.PI });
  place(g, await asset(m, 'props/ferry_ramp'), { x: 24, y: 1.8, z: -3, ry: Math.PI });
  place(g, await asset(m, 'props/pontoon'), { x: 6, y: 0.2, z: 8, ry: 0.05 });

  for (let i = 0; i < 4; i++) {
    place(g, await asset(m, 'props/container_stack'),
      { x: -30 + i * 9.5, y: 1.8, z: -24 - (i % 2) * 6, ry: (i % 2) * 0.04 });
  }
  for (let i = 0; i < 5; i++) {
    place(g, await asset(m, 'props/container'),
      { x: 6 + (i % 3) * 7, y: 1.8, z: -19 - Math.floor(i / 3) * 3.4, ry: Math.PI / 2 + (r() - 0.5) * 0.1 });
  }
  for (const [x, z] of [[16, -8], [-6, -6], [30, -12]]) place(g, await asset(m, 'props/crates'), { x, y: 1.8, z, ry: r() * 2 });
  for (const [x, z] of [[20, -14], [-2, -11]]) place(g, await asset(m, 'props/pallet_stack'), { x, y: 1.8, z, ry: r() * 2 });

  const FW = size(m, 'props/fence_panel')[0];
  for (let i = -6; i <= 6; i++) place(g, await asset(m, 'props/fence_panel'), { x: i * FW, y: 1.8, z: -32 });

  return g;
}

export { human, ground };
