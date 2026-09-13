import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildLandmark } from './skyline.js';
import { tokyoMaterial } from './tokyo.js';
import { buildLiftBridge, LIFT_BRIDGE } from './liftBridge.js';
import { artMaterial } from './artBuildings.js';
import { SHADOW_FAR_LAYER } from '../core/renderer.js';

/**
 * Poly Haven's modular tenement facade is a PARTS LIBRARY laid out on a display
 * grid, not a wall (measured 2026-09-10: 3 m wide x 3 m tall modules whose
 * origin is their right edge on the wall plane z=0, front facing +Z; the
 * window and door inserts share the wall module's origin; dado and cornice
 * are 3 m mouldings, crown is the 0.75 m parapet; *_end and pier pieces close
 * the ends). This assembles a tenement of `bays` x `floors` from it: each bay
 * keeps one window type up its full height (tenements stack their openings),
 * every fourth bay is a doorway, the dado moulding runs along the base with
 * the door cut-outs, cornice and crown finish the top, piers close both ends.
 * ~140 module clones are merged per material (5 materials -> 5 draws).
 */
const KIT_BAY = 3, KIT_STOREY = 3;
export function assembleTenement(gltf, bays = 17, floors = 4, seed = 7) {
  const lib = new Map();                                   // family -> first node of that family
  gltf.scene.traverse((o) => { const fam = (o.name || '').replace(/_\d+$/, ''); if (fam && !lib.has(fam) && o !== gltf.scene) lib.set(fam, o); });
  const parts = [];                                        // { node, x, y, mirror }
  const put = (fam, x, y, mirror = false) => { const n = lib.get(fam); if (n) parts.push({ node: n, x, y, mirror }); else console.warn('tenement kit: no part', fam); };
  let st = seed >>> 0; const rnd = () => { st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0; return st / 4294967296; };
  const WINDOWS = ['centered_large', 'centered_small', 'offset_small', 'centered_double'];
  const DOORS = ['door_window_small', 'door_centered_small', 'door_offset_small', 'door_centered_large'];
  for (let b = 0; b < bays; b++) {
    const x = -KIT_BAY * b;                                // this bay's right edge
    const col = WINDOWS[Math.floor(rnd() * WINDOWS.length)];
    const door = b % 4 === 2 ? DOORS[Math.floor(rnd() * DOORS.length)] : null;
    for (let f = 0; f < floors; f++) {
      const y = KIT_STOREY * f;
      if (f === 0 && door) { put(`wall_${door}`, x, y); put(door, x, y); }
      else { put(`wall_window_${col}`, x, y); put(`window_${col}`, x, y); }
    }
    put(door ? `dado_${door}` : 'dado_standard_standard', x, 0);
    put('cornice_standard_standard', x, KIT_STOREY * floors);
    put('crown_standard_standard', x, KIT_STOREY * floors + 0.2);
  }
  const left = -KIT_BAY * bays;
  for (const [x, mirror] of [[0, false], [left, true]]) {
    for (let f = 0; f < floors; f++) put('wall_pier_standard', x, KIT_STOREY * f, mirror);
    put('dado_end', x, 0, mirror); put('cornice_end', x, KIT_STOREY * floors, mirror); put('crown_end', x, KIT_STOREY * floors + 0.2, mirror);
  }
  // bake: every part's meshes into one geometry per material
  const byMat = new Map();
  const m4 = new THREE.Matrix4(), place = new THREE.Matrix4();
  for (const p of parts) {
    p.node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(p.node.matrixWorld).invert();   // strip the display-grid placement
    place.compose(new THREE.Vector3(p.x, p.y, 0), new THREE.Quaternion(), new THREE.Vector3(p.mirror ? -1 : 1, 1, 1));
    p.node.traverse((o) => {
      if (!o.isMesh) return;
      const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);   // never alias the target of multiplyMatrices
      m4.multiplyMatrices(place, rel);
      let g = o.geometry.clone().applyMatrix4(m4);
      if (p.mirror) { const idx = g.index; if (idx) { for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, t); } } }   // a mirrored part flips its winding
      const keep = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) if (g.attributes[k]) keep.setAttribute(k, g.attributes[k]);
      if (g.index) keep.setIndex(g.index);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const mat = mats[0];
      (byMat.get(mat) ?? byMat.set(mat, []).get(mat)).push(keep.index ? keep.toNonIndexed() : keep);
    });
  }
  const group = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.tenement = { bays, floors, width: KIT_BAY * bays, height: KIT_STOREY * floors + 0.95, draws: group.children.length, parts: parts.length };
  return group;
}

/**
 * Landmarks: one-off set pieces the owner brought in (Sketchfab), placed on
 * the empty lot that fits them best in the district they belong to. Whole
 * textured models, drawn once, so a city of repeating kit gets a few places
 * you recognise: the gun shop, the supermarket, the street corner set.
 * Scaled by footprint fit (uniform), base on the kerb, faced to the block.
 * No collision yet: the hull collider only knows footprints from the file.
 */
const BASE = '/models/vendor/sketchfab/props/';
const LANDMARKS = [
  { file: 'gun-shop',    district: 'OLD QUARTER',  minW: 8,  name: "Schneider's Guns" },
  // heavy: 133k and 94k triangles (budget for a large prop is 6k) -- they do not cast into the shadow cascades
  { file: 'supermarket', district: 'THE FLATS',    minW: 30, name: 'Flats Supermarket', heavy: true },
  { file: 'street-set',  district: 'VELLERY ROW',  minW: 12, name: 'Vellery corner', heavy: true },
  {
    file: '/models/vendor/kenney/commercial/building-skyscraper-d.glb',
    district: 'KINGSWAY',
    minW: 24,
    targetW: 28,
    name: 'Kingsway Apex Tower',
  },
  {
    file: '/models/vendor/kenney/industrial/water-tower.glb',
    district: 'STEELGATE',
    minW: 20,
    targetW: 22,
    name: 'Steelgate Waterworks & Silo',
  },
  {
    file: '/models/vendor/kenney/industrial/windmill.glb',
    district: 'HARBOUR POINT',
    minW: 20,
    targetW: 20,
    name: 'Harbour Point Turbine & Signal',
  },
  /* A FRONTAGE, not a prop (2026-09-10): Poly Haven's CC0 modular tenement
     facade (James Ray Cock), 51.5 x 17 m assembled, detail on its +Z face,
     doors at y = -1 over a 1 m foundation. It stands at the lot edge facing
     the nearest road with a plain massing block behind it, so from the
     street it is a real Old Quarter block and from the alley a building,
     not a stage flat. 10.6 MB and ~39k tris -- one of these in the city,
     lazily loaded like every landmark, keeps the initial download under
     the 25 MB budget; the factory set (13.8 MB) waits for KTX2. */
  {
    file: '/models/vendor/polyhaven/modular_urban_apartments_facade.glb',
    district: 'OLD QUARTER',
    minW: 44,
    maxScale: 1.0,
    frontage: { assemble: { bays: 17, floors: 4 }, groundY: 0, depth: 14, colour: 0x6f5548 },
    name: 'Old Quarter tenements',
  },
  /* Ours, authored in Blender (tools/blender/build_tokyo_neon_building.py):
     four seeded neon towers -- konbini ground floor, ribbon windows,
     cantilevered kanban blades, rooftop gantry and mast. They stand on the
     four free LITTLE TOKYO blocks (292, 297, 309 vacant, 313 lot), which
     tokyo.js leaves empty because the plan gives them no footprints.
     `frontage.depth: 0` uses the road-facing probe WITHOUT the plaster body:
     these are whole buildings, not stage flats. Metre-accurate, so
     maxScale 1. ~5k tris and 13 primitives each. */
];

/**
 * PHASE 6, the authored set pieces (world/skyline.js).
 *
 * Every position here was computed from the plan, not eyeballed: for each
 * district's empty blocks, the longest straight road run whose axis passes
 * through the block, then the point on that axis inside the block, then the
 * block-aligned yaw nearest the street's own direction (a building stands
 * square to its plot; a 40 degree twist to face the camera reads as a prop).
 * `view` is the street it terminates and how far you can see it from. The
 * script lives in the phase report; the numbers are the answer.
 *
 * `block` is reserved before #place() runs, so the vendor landmarks (the
 * tenement wants any 44 m Old Quarter lot) never land on top of one.
 */
const SKYLINE = [
  { kind: 'crane_cluster', x: 2339.3, z: 1954.5, yaw: 1.151, block: 497, district: 'HARBOUR POINT', name: 'Halstead Container Terminal', view: 'road 168 (26 m), 1023 m' },
  { kind: 'grain_silo', x: 2440.3, z: 2010.6, yaw: 2.722, block: 497, district: 'HARBOUR POINT', name: 'Harbour Point grain elevator', view: 'road 169 (26 m), 1086 m' },
  { kind: 'gas_holder', x: 3304.0, z: 1051.8, yaw: -3.052, block: 315, district: 'STEELGATE', name: 'Steelgate gas holder', view: 'road 172 (26 m), 1416 m' },
  { kind: 'flare_stack', x: 3387.3, z: 1084.4, yaw: 1.661, block: 315, district: 'STEELGATE', name: 'Steelgate flare stack', view: 'road 84 (30 m), 1105 m' },
  { kind: 'fly_tower', x: 768.8, z: 2341.5, yaw: 0.040, block: 370, district: 'THE FLATS', name: 'The Rialto', view: 'DOCK ROAD (30 m), 1736 m' },
  { kind: 'market_hall', x: 761.9, z: 2068.3, yaw: 1.611, block: 347, district: 'THE FLATS', name: 'Flats Market Hall', view: 'road 104 (19 m), 1161 m' },
  /* Not on a block: a gantry ACROSS road 219, 33 m clear of the nearest
     junction, ~335 m of straight approach from the north and ~927 m from the
     south. The posts stand on the pavements; nothing is solid in the road.
     Moved 12 m down the street from the first pass's (1618.0, 2102.7): the
     west post there was 2.5 m INSIDE a 14x14 m footprint on block 421 (this
     is the one landmark not placed on an empty block, so it is the one the
     plot check could not catch). Here both posts stand 2.0 m off the tarmac
     and 5.1 m / 16.5 m clear of the nearest building. */
  { kind: 'arcade_sign', x: 1616.6, z: 2114.6, yaw: 1.451, district: 'VELLERY ROW', name: 'Vellery Row arcade', view: 'road 219 (18 m), ~927 m south / ~335 m north' },
  { kind: 'church', x: 1383.6, z: 1660.9, yaw: -2.962, block: 272, district: 'OLD QUARTER', name: 'St Halstead in the Quarter', view: 'road 115 (19 m), 1436 m' },
  { kind: 'clock_tower', x: 1491.6, z: 1564.0, yaw: -1.391, block: 266, district: 'OLD QUARTER', name: 'Old Quarter clock tower', view: 'road 217 (18 m), 1466 m' },
  { kind: 'water_tower', x: 816.7, z: 1664.3, yaw: -1.791, block: 182, district: 'MARROW HILL', name: 'Marrow Hill water tower', view: 'road 198 (22 m), 1356 m' },
  { kind: 'bandstand', x: 1257.6, z: 771.0, yaw: -1.611, block: 83, district: 'GREENFELL PARK', name: 'Greenfell bandstand', view: 'road 126 (14 m), 1079 m' },
  { kind: 'glasshouse', x: 1304.8, z: 843.0, yaw: 3.102, block: 83, district: 'GREENFELL PARK', name: 'Greenfell palm house', view: 'road 56 (20 m), 1330 m' },
];

export class Landmarks {
  constructor(scene, district, world = null) {
    this.scene = scene; this.district = district; this.world = world; this.placed = [];
    this.usedBlocks = new Set();     // block ids the skyline took; #place() must not offer them to a vendor model
    this.solids = [];                // world-frame collision boxes, in districtWorld's own { x, z, hw, hd, angle, height } shape
    this.keepOut = [];               // world-frame ground footprints the dressing must not scatter into
    this.#buildSkyline();
    this.#buildTokyoArch();
    this.#buildHalsteadLiftBridge();
    this.#place();
  }

  /**
   * The twelve authored landmarks. One merged geometry each, one draw each,
   * bound to tokyoMaterial() -- vertex colour plus the `emit` attribute, so
   * their lit parts come up on the city's own night curve (main's
   * setTokyoNight) with no new material to keep in step. They are NOT in a
   * chunk: they live for the session, frustum-culled like any mesh, and they
   * enable SHADOW_FAR_LAYER because at 400 m they are only ever seen by the
   * far shadow cascades.
   */
  #buildSkyline() {
    const heads = [];
    let tris = 0;
    /* The signature bridge: two lattice towers, sheaves, counterweights on
       cables and a through-truss you drive inside (world/liftBridge.js). It is
       built whole here rather than per chunk, because it is one object 381 m
       long -- world/spans.js deliberately skips this bridge (signatureBridge)
       so the two do not both build piers along it. Modelled span-DOWN: a
       raised span would cut the road. Parts come back per material key, the
       same keys the self-built styles use. */
    try {
      const lb = buildLiftBridge(LIFT_BRIDGE.a, LIFT_BRIDGE.b, LIFT_BRIDGE.width);
      const byKey = new Map();
      for (const p of lb.parts) (byKey.get(p.mat) ?? byKey.set(p.mat, []).get(p.mat)).push(p.geo);
      for (const [key, geos] of byKey) {
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, artMaterial(key));
        m.name = `liftbridge_${key}`;
        m.castShadow = true; m.receiveShadow = true;
        m.layers.enable(SHADOW_FAR_LAYER);
        this.scene.add(m);
      }
      /* Its solids come back in the bridge's own frame (local: true), so they
         go through the same local-to-world turn the skyline pieces use. The
         car must pass BETWEEN the legs, so these are per-leg clusters, never a
         box across the deck. */
      const ang = LIFT_BRIDGE.angle, ca = Math.cos(ang), sa = Math.sin(ang);
      for (const b of lb.solids ?? []) {
        const wx = LIFT_BRIDGE.x + b.x * ca - b.z * sa;
        const wz = LIFT_BRIDGE.z + b.x * sa + b.z * ca;
        this.solids.push({ x: wx, z: wz, hw: b.hw, hd: b.hd, angle: ang, height: b.height, district: LIFT_BRIDGE.district, landmark: true });
      }
      for (const l of lb.lamps ?? []) {
        const wx = LIFT_BRIDGE.x + l.x * ca - l.z * sa;
        const wz = LIFT_BRIDGE.z + l.x * sa + l.z * ca;
        heads.push({ x: wx, y: l.y, z: wz, colour: l.colour ?? 0xffd9a0 });
      }
    } catch (e) { console.warn('lift bridge', e.message); }

    for (const s of SKYLINE) {
      let lm;
      try { lm = buildLandmark(s.kind, s.seed ?? 7); } catch (e) { console.warn('skyline', s.kind, e.message); continue; }
      const mesh = new THREE.Mesh(lm.geo, tokyoMaterial());
      mesh.name = `landmark_${s.kind}`;
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = s.yaw;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.layers.enable(SHADOW_FAR_LAYER);
      this.scene.add(mesh);
      /* three's rotation.y turns local +X to (cos yaw, -sin yaw), while a
         collision box's own `angle` turns its +X to (cos a, sin a)
         (vehicle/collision.js:resolveBoxes) -- so the box angle is -yaw. */
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      const toWorld = (lx, lz) => [s.x + lx * cy + lz * sy, s.z - lx * sy + lz * cy];
      for (const b of lm.solids) {
        const [wx, wz] = toWorld(b.x, b.z);
        this.solids.push({ x: wx, z: wz, hw: b.hw, hd: b.hd, angle: -s.yaw + (b.angle ?? 0), height: b.height, district: s.district, landmark: true });
      }
      for (const l of lm.lights) {
        const [wx, wz] = toWorld(l.x, l.z);
        heads.push({ x: wx, y: l.y, z: wz, colour: l.colour, range: l.range });
      }
      /* Keep-out. Reserving the BLOCK stops another building landing here; it
         does not stop the scatterers, and every plot in the table is exactly
         the type they dress: dressing.js drops YARD_KIT/HARBOUR_KIT on an
         11 m grid over every lot/vacant/yard and PARK_KIT on a 9 m grid over
         every park, and districtWorld's own park loop plants trees on an 11 m
         grid -- a skip inside the gas holder drum and poplars inside the palm
         house. Publish the GROUND footprint (vertices below 8 m, so the
         crane's boom still has containers standing under it) and let them
         ask. Three one-line callers, listed in the review. */
      const pos = lm.geo.attributes.position;
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) >= 8) continue;
        const px = pos.getX(i), pz = pos.getZ(i);
        if (px < mnx) mnx = px; if (px > mxx) mxx = px;
        if (pz < mnz) mnz = pz; if (pz > mxz) mxz = pz;
      }
      if (mnx < Infinity) {
        const [kx, kz] = toWorld((mnx + mxx) / 2, (mnz + mxz) / 2);
        this.keepOut.push({ x: kx, z: kz, cy, sy, hw: (mxx - mnx) / 2, hd: (mxz - mnz) / 2 });
      }
      if (s.block !== undefined) this.usedBlocks.add(s.block);
      this.placed.push({ ...s, tris: lm.tris, height: lm.height });
      tris += lm.tris;
    }
    /* The two scatterers both hold the District, not the world, so this is
       the one object both can reach without a new argument. */
    this.district.landmarkKeepOut = (x, z, pad) => this.keepOutAt(x, z, pad);
    if (this.world) {
      /* The night pool reads hero lights straight out of this map
         (game/lighting.js:#hero) and nothing else writes to it, so a key of
         our own is the whole wiring. Collision goes through
         world.extraSolids, which districtWorld folds into each chunk's box
         list as it builds -- see the hook in the phase report. */
      (this.world.heroLightsByChunk ??= new Map()).set('landmarks', heads);
      this.world.extraSolids = this.solids;
    }
    console.info(`skyline: ${this.placed.length} landmarks, ${tris} triangles, ${this.solids.length} solids, ${heads.length} hero lights`);
  }

  /**
   * Is (x, z) standing on a landmark? The dressing asks before it drops a
   * prop or a tree. Rects, in each landmark's own frame -- twelve of them, so
   * a linear scan is the whole algorithm; it runs per grid cell as a chunk
   * builds, never in the frame loop.
   */
  keepOutAt(x, z, pad = 1.5) {
    for (const k of this.keepOut) {
      const dx = x - k.x, dz = z - k.z;
      if (Math.abs(dx * k.cy - dz * k.sy) <= k.hw + pad
       && Math.abs(dx * k.sy + dz * k.cy) <= k.hd + pad) return true;
    }
    return false;
  }

  async #place() {
    const loader = new GLTFLoader();
    const used = new Set();
    await Promise.all(LANDMARKS.map(async (lm) => {
      const lots = this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && b.district === lm.district && !used.has(b) && !this.usedBlocks.has(b.id) && Math.min(b.w, b.h) >= lm.minW)
        .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
      const lot = lots[0] ?? this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && !used.has(b) && !this.usedBlocks.has(b.id) && Math.min(b.w, b.h) >= lm.minW).sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))[0];
      if (!lot) { console.warn('landmark: no lot for', lm.file); return; }
      used.add(lot);
      const path = lm.file.startsWith('/') ? lm.file : BASE + lm.file + '.glb';
      let gltf; try { gltf = await new Promise((res, rej) => loader.load(path, res, undefined, rej)); } catch (e) { console.warn('landmark', lm.file, e.message); return; }
      let obj = gltf.scene;
      if (lm.frontage?.assemble) {
        obj = assembleTenement(gltf, lm.frontage.assemble.bays, lm.frontage.assemble.floors);
        console.info(`tenement assembled: ${JSON.stringify(obj.userData.tenement)}`);
      }
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const maxK = lm.maxScale ?? 1.6;
      const k = lm.targetW ? (lm.targetW / size.x) : Math.min((lot.w - 3) / size.x, (lot.h - 3) / size.z, maxK);        // fit the lot or scale to target dimension
      const wrap = new THREE.Group();
      obj.position.set(-c.x, -(lm.frontage?.groundY ?? bb.min.y), -c.z);
      wrap.add(obj);
      wrap.scale.setScalar(k);
      wrap.position.set(lot.x, 0.15, lot.y);
      wrap.rotation.y = lot.angle;
      if (lm.frontage) {
        /* Face the road. Four candidate yaws; the facade's +Z normal probes
           8 m past the lot edge and the most-on-tarmac one wins
           (district.tarmacDepth is negative on the carriageway). The facade
           has to fit along the lot axis it stands on, so a 44 m side is
           never offered a 51 m wall. Then slide it to that edge. */
        const D = this.district, fw = size.x * k, fd = size.z * k;
        let best = null;
        for (let q = 0; q < 4; q++) {
          const yaw = lot.angle + q * Math.PI / 2;
          const along = (q % 2 === 0) ? lot.w : lot.h;     // lot axis the wall runs along
          const out = (q % 2 === 0) ? lot.h : lot.w;       // lot axis the normal points along
          if (along < fw + 1) continue;
          const nx = Math.sin(yaw), nz = Math.cos(yaw);
          const depth = D.tarmacDepth ? D.tarmacDepth(lot.x + nx * (out / 2 + 8), lot.y + nz * (out / 2 + 8)) : 0;
          if (!best || depth < best.depth) best = { yaw, nx, nz, out, depth };
        }
        if (best) {
          wrap.rotation.y = best.yaw;
          const push = best.out / 2 - fd / 2 - 1.0;
          wrap.position.x += best.nx * push; wrap.position.z += best.nz * push;
          // the block behind the wall: the facade's own height, the frontage depth, a plain plaster body and a flat roof
          // depth 0 = the model IS the building (the Blender neon towers); only a stage flat needs a body behind it
          const H = (bb.max.y - (lm.frontage.groundY ?? bb.min.y));
          if (lm.frontage.depth > 0) {
            const body = new THREE.Mesh(new THREE.BoxGeometry(size.x - 0.3, H - 0.6, lm.frontage.depth), new THREE.MeshStandardMaterial({ color: lm.frontage.colour, roughness: 0.92, metalness: 0 }));
            body.position.set(0, (H - 0.6) / 2, -(size.z / 2 + lm.frontage.depth / 2) + 0.15);
            body.castShadow = true; body.receiveShadow = true;
            obj.parent.add(body);
          }
          console.info(`frontage ${lm.name}: yaw ${best.yaw.toFixed(2)}, road depth ${best.depth.toFixed(1)} m`);
        }
      }
      wrap.traverse((o) => { if (o.isMesh) { o.castShadow = !lm.heavy; o.receiveShadow = true; } });
      this.scene.add(wrap);
      this.placed.push({ ...lm, x: lot.x, z: lot.y, scale: k });
      console.info(`landmark ${lm.name} at ${lot.x | 0},${lot.y | 0} (${lm.district}) x${k.toFixed(2)}`);
    }));

    // Place high-detail scanned characters as street walkers / pedestrians
    const STREET_PEOPLE = [
      { file: '/models/characters/cowboy.glb', x: 28, z: 12, yaw: 0.4, name: 'Cowboy on Sidewalk' },
      { file: '/models/characters/navy_jacket.glb', x: 18, z: 15, yaw: -1.2, name: 'Navy Jacket Pedestrian' },
      { file: '/models/characters/cowboy.glb', x: -35, z: 25, yaw: 1.8, name: 'Cowboy at Corner' },
    ];
    for (const sp of STREET_PEOPLE) {
      try {
        const gltf = await new Promise((res, rej) => loader.load(sp.file, res, undefined, rej));
        const obj = gltf.scene;
        obj.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(obj);
        const h = bb.max.y - bb.min.y || 1;
        const scale = 1.78 / h;
        obj.scale.setScalar(scale);
        obj.position.set(sp.x, -bb.min.y * scale + 0.15, sp.z);
        obj.rotation.y = sp.yaw;
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
        this.scene.add(obj);
        console.info(`street walker: ${sp.name} at ${sp.x},${sp.z}`);
      } catch (e) {
        console.warn('street walker', sp.file, e.message);
      }
    }
  }

  #buildTokyoArch() {
    const group = new THREE.Group();
    const vermilionMat = new THREE.MeshStandardMaterial({
      color: 0xcc1a24,
      roughness: 0.42,
      metalness: 0.1,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x1c1816,
      roughness: 0.65,
      metalness: 0.05,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf5b722,
      roughness: 0.28,
      metalness: 0.8,
    });

    // Two main vertical Torii columns spanning the street (27m clear span across Road 168)
    const span = 27.0;
    for (const s of [-span / 2, span / 2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.82, 10.5, 14), vermilionMat);
      col.position.set(s, 5.25, 0);
      col.castShadow = true; col.receiveShadow = true;

      // Base stone footings on sidewalk
      const baseStone = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 1.2, 14), darkWoodMat);
      baseStone.position.set(s, 0.6, 0);
      baseStone.receiveShadow = true;

      // Gold capital ring
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.25, 14), goldMat);
      ring.position.set(s, 8.8, 0);

      group.add(col, baseStone, ring);
    }

    // Lower crossbeam (Nuki)
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(span + 2.4, 0.68, 0.85), vermilionMat);
    nuki.position.set(0, 7.8, 0);
    nuki.castShadow = true;
    group.add(nuki);

    // Upper crossbeam (Kasagi) with curved tips
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(span + 4.8, 0.95, 1.15), vermilionMat);
    kasagi.position.set(0, 9.8, 0);
    kasagi.castShadow = true;
    group.add(kasagi);

    // Top lintel cap
    const capRoof = new THREE.Mesh(new THREE.BoxGeometry(span + 5.5, 0.26, 1.45), darkWoodMat);
    capRoof.position.set(0, 10.35, 0);
    group.add(capRoof);

    // Center illuminated Tokyo Street neon sign
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0812';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 1008, 240);
    ctx.fillStyle = '#ff007f';
    ctx.fillRect(20, 20, 984, 12);
    ctx.font = '900 86px "Hiragino Kaku Gothic Pro", "Noto Sans JP", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('新宿通り · TOKYO STREET · 歌舞伎町', 512, 142);
    const signTex = new THREE.CanvasTexture(canvas);
    signTex.colorSpace = THREE.SRGBColorSpace;

    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      emissiveMap: signTex,
      emissive: 0xffffff,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });

    // Core board backing
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.85, 0.32), darkWoodMat);
    signBoard.position.set(0, 8.8, 0);
    group.add(signBoard);

    // South-facing panel (seen by cars approaching from South / spawn looking North)
    const southPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.65), signMat);
    southPanel.position.set(0, 8.8, -0.17);
    southPanel.rotation.y = Math.PI;   // a half-turn about Y already reads left-to-right from the south; scale.x = -1 on top of it mirrored the lettering (seen in the browser)
    group.add(southPanel);

    // North-facing panel (seen by cars driving South)
    const northPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.65), signMat);
    northPanel.position.set(0, 8.8, 0.17);
    group.add(northPanel);

    // Hanging lanterns with warm golden glow spaced across the avenue
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xdd2211,
      emissive: 0xff4411,
      emissiveIntensity: 2.4,
      roughness: 0.35,
    });
    for (const lx of [-10.5, -6.5, -2.5, 2.5, 6.5, 10.5]) {
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.72, 12), lanternMat);
      lantern.position.set(lx, 7.0, 0);
      group.add(lantern);
    }

    // Place across the main avenue (Road 168) at the entrance to Little Tokyo
    group.position.set(2356.5, 0, 1378.0);
    group.rotation.y = -0.03;
    this.scene.add(group);
    console.info('Tokyo Gateway Arch placed at 2356.5, 1378.0 across Tokyo Street (Road 168)');
  }

  #buildHalsteadLiftBridge() {
    const ax = 1939, az = 2317, bx = 1962, bz = 2698;
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz);
    const yaw = Math.atan2(dz, dx);
    const width = 26.0;
    const deckY = 7.6;

    const group = new THREE.Group();
    group.name = 'HalsteadLiftBridge';

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x484f59,
      roughness: 0.42,
      metalness: 0.75,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x272d36,
      roughness: 0.48,
      metalness: 0.82,
    });
    const pierMat = new THREE.MeshStandardMaterial({
      color: 0x7c7f86,
      roughness: 0.85,
      metalness: 0.12,
    });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff1100,
      emissive: 0xff1100,
      emissiveIntensity: 3.8,
      roughness: 0.2,
    });
    const greenNavMat = new THREE.MeshStandardMaterial({
      color: 0x00ff66,
      emissive: 0x00ff66,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });
    const redNavMat = new THREE.MeshStandardMaterial({
      color: 0xff2200,
      emissive: 0xff2200,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });

    // 1. Dual Vertical Lift Towers flanking the navigation channel
    const towerPositions = [142, 238];
    const towerH = 34.0;
    const halfW = width / 2;

    for (const tPos of towerPositions) {
      const towerGroup = new THREE.Group();
      towerGroup.position.set(tPos, deckY, 0);

      // Deep concrete caisson footing under tower into riverbed
      for (const side of [-1, 1]) {
        const footing = new THREE.Mesh(new THREE.BoxGeometry(10.0, 11.6, 6.5), pierMat);
        footing.position.set(0, -5.8, side * (halfW + 1.2));
        footing.castShadow = true;
        footing.receiveShadow = true;
        towerGroup.add(footing);

        // River navigation hazard light on outer face of footing
        const navLight = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8), redNavMat);
        navLight.position.set(0, -1.8, side * (halfW + 4.5));
        towerGroup.add(navLight);
      }

      // Vertical steel columns on both sides of roadway (4 main columns per tower)
      for (const side of [-1, 1]) {
        const sideZ = side * (halfW + 1.2);
        for (const colX of [-3.8, 3.8]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(1.2, towerH, 1.2), steelMat);
          col.position.set(colX, towerH / 2, sideZ);
          col.castShadow = true;
          towerGroup.add(col);
        }

        // Side lattice cross-bracing (K-truss and X-braces between columns)
        for (let yLevel = 6; yLevel < towerH - 4; yLevel += 7) {
          const hBeam = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.55, 0.55), steelMat);
          hBeam.position.set(0, yLevel, sideZ);
          towerGroup.add(hBeam);

          const diag1 = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.35, 0.35), darkSteel);
          diag1.position.set(0, yLevel + 3.5, sideZ);
          diag1.rotation.z = Math.atan2(7.0, 7.6);
          towerGroup.add(diag1);

          const diag2 = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.35, 0.35), darkSteel);
          diag2.position.set(0, yLevel + 3.5, sideZ);
          diag2.rotation.z = -Math.atan2(7.0, 7.6);
          towerGroup.add(diag2);
        }

        // Tower top machinery penthouse
        const penthouse = new THREE.Mesh(new THREE.BoxGeometry(9.4, 3.2, 3.8), steelMat);
        penthouse.position.set(0, towerH + 1.6, sideZ);
        towerGroup.add(penthouse);

        // Counterweight sheaves (large cable pulley wheels)
        for (const sheaveX of [-2.6, 2.6]) {
          const sheave = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.45, 16), darkSteel);
          sheave.rotation.x = Math.PI / 2;
          sheave.position.set(sheaveX, towerH + 2.2, sideZ);
          towerGroup.add(sheave);
        }

        // Red aviation warning beacon on tower pinnacle
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), beaconMat);
        beacon.position.set(0, towerH + 4.2, sideZ);
        towerGroup.add(beacon);
      }

      // Overhead roadway portal crossbeam connecting the two towers (7.8m clearance above road)
      const portalBeam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, width + 5.0), steelMat);
      portalBeam.position.set(0, 8.2, 0);
      portalBeam.castShadow = true;
      towerGroup.add(portalBeam);

      // Top overhead tie-strut across towers at Y = towerH
      const topTie = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, width + 5.0), steelMat);
      topTie.position.set(0, towerH, 0);
      towerGroup.add(topTie);

      // Overhead highway portal sign
      if (typeof document !== 'undefined') {
        const signCanvas = document.createElement('canvas');
        signCanvas.width = 1024; signCanvas.height = 256;
        const sctx = signCanvas.getContext('2d');
        sctx.fillStyle = '#0e1824';
        sctx.fillRect(0, 0, 1024, 256);
        sctx.strokeStyle = '#3fd2ff';
        sctx.lineWidth = 10;
        sctx.strokeRect(6, 6, 1012, 244);
        sctx.font = '900 62px system-ui, -apple-system, sans-serif';
        sctx.textAlign = 'center';
        sctx.textBaseline = 'middle';
        sctx.fillStyle = '#ffffff';
        sctx.shadowColor = '#00e5ff';
        sctx.shadowBlur = 18;
        sctx.fillText('HALSTEAD LIFT BRIDGE', 512, 90);
        sctx.font = '700 42px system-ui, -apple-system, sans-serif';
        sctx.fillStyle = '#39ffb0';
        sctx.shadowColor = '#39ffb0';
        sctx.shadowBlur = 12;
        sctx.fillText('VERTICAL CLEARANCE 7.6M · EST. 1928', 512, 168);

        const signTex = new THREE.CanvasTexture(signCanvas);
        signTex.colorSpace = THREE.SRGBColorSpace;
        const portalSignMat = new THREE.MeshStandardMaterial({
          map: signTex,
          emissiveMap: signTex,
          emissive: 0xffffff,
          emissiveIntensity: 2.4,
          roughness: 0.3,
        });

        for (const faceDir of [-1, 1]) {
          const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(16.0, 3.4), portalSignMat);
          signMesh.position.set(faceDir * 1.25, 8.2, 0);
          signMesh.rotation.y = faceDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          towerGroup.add(signMesh);
        }
      }

      group.add(towerGroup);
    }

    // 2. Through-Truss framework along the river span (t = 68m to t = 312m)
    const trussStart = 68;
    const trussEnd = 312;
    const trussH = 5.2;
    const panelW = 8.0;

    for (let t = trussStart; t < trussEnd; t += panelW) {
      const segLen = Math.min(panelW, trussEnd - t);
      const segMid = t + segLen / 2;

      for (const side of [-1, 1]) {
        const sideZ = side * (halfW + 0.35);

        // Lower and upper chords (horizontal steel box beams)
        const topChord = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.45, 0.45), steelMat);
        topChord.position.set(segMid, deckY + trussH, sideZ);
        group.add(topChord);

        const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.45, 0.45), steelMat);
        bottomChord.position.set(segMid, deckY + 0.35, sideZ);
        group.add(bottomChord);

        // Vertical post
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, trussH, 0.4), steelMat);
        post.position.set(t, deckY + trussH / 2, sideZ);
        group.add(post);

        // Diagonal truss brace
        const diagLen = Math.hypot(segLen, trussH);
        const diag = new THREE.Mesh(new THREE.BoxGeometry(diagLen, 0.32, 0.32), darkSteel);
        diag.position.set(segMid, deckY + trussH / 2, sideZ);
        diag.rotation.z = (side > 0 ? 1 : -1) * Math.atan2(trussH, segLen);
        group.add(diag);
      }

      // Overhead sway frame struts across roadway every 16m
      if ((t - trussStart) % 16 < panelW) {
        const swayBeam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, width + 0.7), steelMat);
        swayBeam.position.set(t, deckY + trussH, 0);
        group.add(swayBeam);
      }
    }

    // Center shipping navigation channel green beacon suspended from bridge center
    const centerSpanT = (towerPositions[0] + towerPositions[1]) / 2;
    const centerNavLight = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), greenNavMat);
    centerNavLight.position.set(centerSpanT, deckY - 1.2, 0);
    group.add(centerNavLight);

    // Transform whole bridge group along Halstead Lift Bridge vector
    group.position.set(ax, 0, az);
    group.rotation.y = -yaw;
    this.scene.add(group);
    console.info('Halstead Lift Bridge 3D Architecture installed at', ax, az, 'length:', L);
  }
}
