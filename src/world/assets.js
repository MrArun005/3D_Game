import * as THREE from 'three';
import { texAsphalt, texWalk, texPool, toTex, cv, normalFromCanvas } from './textures.js';
import { buildFacadeMaterials, buildBaseMaterials, BASE_H } from './facades.js';
import { makeTileable } from './city.js';
import { texSignAtlas, buildSignMaterial, signGeometry, buildWindowMaterial } from './signs.js';
import {
  buildStreetLamp, buildLampHead, buildTrafficPost, buildTree,
  buildCanopy, buildBollard, buildBin, buildShelter,
  buildAcUnit, buildWaterTank, buildRoofHut, buildSpecies, TREE_SPECIES,
} from './props.js';
import { buildStuntGeometries, buildMaterials } from '../vehicle/model.js';
import { PAINT_COLOURS, BODY_KEYS, BODY_TYPES } from '../vehicle/config.js';
import { CELL, ROAD_HALF, WALK_W } from './metrics.js';
import { buildLampGeometry } from './signals.js';

/** Every geometry and material the city draws from, built once at boot. */
export function createAssets() {
  const road = texAsphalt('road');
  const plain = texAsphalt('plain');
  const intersection = texAsphalt('inter');
  const walk = texWalk();
  // built from the same canvas the albedo uses, before repeat is applied
  const plainNormal = normalFromCanvas(plain.image, 2.4);
  const pool = texPool();

  const armLen = CELL - ROAD_HALF * 2;
  road.repeat.set(1, armLen / (ROAD_HALF * 2));
  plain.wrapS = plain.wrapT = THREE.RepeatWrapping;
  walk.repeat.set(WALK_W / 2.4, CELL / 2.4);

  const carMats = buildMaterials();

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);      // origin at the footprint, so scale.y is height

  const geo = {
    box,
    plane: new THREE.PlaneGeometry(1, 1),
    lens: new THREE.SphereGeometry(0.09, 8, 6),
    lamp: buildStreetLamp(),
    lampHead: buildLampHead(),
    signal: buildTrafficPost(),
    signalLamp: buildLampGeometry(),
    tree: buildTree(),
    canopy: buildCanopy(),
    bollard: buildBollard(),
    bin: buildBin(),
    shelter: buildShelter(),
    ac: buildAcUnit(),
    tank: buildWaterTank(),
    hut: buildRoofHut(),
    stunt: buildStuntGeometries(),      // keyed by body style
  };

  const texLoader = new THREE.TextureLoader();
  const loadPBR = (path, srgb = true, tile = 1) => {
    const t = texLoader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(tile, tile);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const setORM = (m, ormTex) => {
    m.aoMap = ormTex;
    m.roughnessMap = ormTex;
    m.metalnessMap = ormTex;
    ormTex.channel = 0;
  };

  const mat = {
    // Standard rather than Lambert on the carriageway: roughness plus the
    // environment map is what makes wet asphalt catch the sky and the lamps.
    road: new THREE.MeshStandardMaterial({
      map: road, roughness: 0.36, metalness: 0.08, envMapIntensity: 1.05,
    }),
    // Scanned PBR tarmac with aggregate, wet surface sheen, and normal relief
    tarmac: (() => {
      const m = new THREE.MeshStandardMaterial({
        map: loadPBR('/textures/asphalt_wet_albedo.png', true, 2),
        normalMap: loadPBR('/textures/asphalt_wet_normal.png', false, 2),
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.52, metalness: 0.06, envMapIntensity: 1.15,
      });
      setORM(m, loadPBR('/textures/asphalt_wet_orm.png', false, 2));
      return m;
    })(),
    // road paint, drawn as geometry a hair above the tarmac
    paint: new THREE.MeshBasicMaterial({
      color: 0xd6d8d2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    paintWarm: new THREE.MeshBasicMaterial({
      color: 0xd8c24a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    kerbFace: new THREE.MeshLambertMaterial({ color: 0x9a9a94 }),
    intersection: new THREE.MeshStandardMaterial({
      map: intersection, roughness: 0.38, metalness: 0.08, envMapIntensity: 1.0,
    }),
    walk: new THREE.MeshLambertMaterial({ map: walk }),
    // Scanned PBR pavement slabs with mortar relief and surface roughness
    walkDistrict: (() => {
      const m = new THREE.MeshStandardMaterial({
        map: loadPBR('/textures/pavement_slab_albedo.png', true, 1),
        normalMap: loadPBR('/textures/pavement_slab_normal.png', false, 1),
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.72, metalness: 0.04,
      });
      setORM(m, loadPBR('/textures/pavement_slab_orm.png', false, 1));
      return m;
    })(),
    // Scanned weathered kerb stones with chipped edges and occlusion
    kerb: (() => {
      const m = new THREE.MeshStandardMaterial({
        map: loadPBR('/textures/kerb_stone_albedo.png', true, 1),
        normalMap: loadPBR('/textures/kerb_stone_normal.png', false, 1),
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.68, metalness: 0.05,
      });
      setORM(m, loadPBR('/textures/kerb_stone_orm.png', false, 1));
      return m;
    })(),
    roof: new THREE.MeshLambertMaterial({ color: 0x2a2e34 }),
    roofGlass: new THREE.MeshStandardMaterial({
      color: 0x1a222c, roughness: 0.18, metalness: 0.55, envMapIntensity: 1.35,
    }),
    crown: new THREE.MeshStandardMaterial({
      color: 0xc8e0f4, emissive: 0x8ec4e8, emissiveIntensity: 1.7,
      roughness: 0.28, metalness: 0.2,
    }),
    // Scanned galvanised painted metal for posts and street fixtures
    pole: (() => {
      const m = new THREE.MeshStandardMaterial({
        map: loadPBR('/textures/metal_galv_albedo.png', true, 2),
        normalMap: loadPBR('/textures/metal_galv_normal.png', false, 2),
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 0.5, metalness: 0.65,
      });
      setORM(m, loadPBR('/textures/metal_galv_orm.png', false, 2));
      return m;
    })(),
    /* Emissive, not Basic. main.js dims lampGlow.emissiveIntensity for daylight
       -- a property a MeshBasicMaterial does not have -- and the bloom pass
       reads the emissive MRT channel, so as a Basic material the lamp heads
       neither dimmed by day nor bloomed by night. Now they do both. */
    lampGlow: new THREE.MeshStandardMaterial({
      color: 0x3a3226, emissive: 0xffd9a0, emissiveIntensity: 3.2, roughness: 0.4,
    }),
    // unlit so a red lens stays red at night; brightness comes from instance colour
    signalLamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    plant: new THREE.MeshStandardMaterial({ color: 0x4b4f55, roughness: 0.78, metalness: 0.4 }),
    // additive cone under each lamp head: haze doing what a real light would
    lampCone: new THREE.MeshBasicMaterial({
      color: 0xffc98a, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, fog: true,
    }),
    bark: new THREE.MeshLambertMaterial({ color: 0x312b25 }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x283126 }),
    bin: new THREE.MeshStandardMaterial({ color: 0x282c31, roughness: 0.7, metalness: 0.4 }),
    tailDim: new THREE.MeshStandardMaterial({
      color: 0x4a1013, emissive: 0xa8181c, emissiveIntensity: 0.7, roughness: 0.3,
    }),
    pool: new THREE.MeshBasicMaterial({
      map: pool, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 1.0, fog: true,
    }),
    // one white material for every parked car; colour comes per instance, so a
    // whole street of mixed cars is one draw call per silhouette
    parked: carMats.stunt,
    carGlass: carMats.glass,
  };

  geo.lampCone = new THREE.ConeGeometry(3.1, 8.4, 12, 1, true);
  // origin-centred glowing cap for the catalogue lamps (dressing.js places it)
  geo.lampCap = new THREE.BoxGeometry(0.34, 0.12, 0.62);
  // Phase 1 shop signs: one atlas, one node material, one quad (world/signs.js)
  geo.sign = signGeometry();
  mat.sign = buildSignMaterial(texSignAtlas());
  mat.windowQuad = buildWindowMaterial();
  mat.beacon = new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2a1a, emissiveIntensity: 4.0, roughness: 0.6 });
  mat.beacon.name = 'beacon';
  geo.species = Object.fromEntries(TREE_SPECIES.map((k) => [k, buildSpecies(k)]));

  return {
    geo, mat, carMats,
    bodyKeys: BODY_KEYS, bodySpecs: BODY_TYPES, paints: PAINT_COLOURS,
    facades: (() => {
      const f = buildFacadeMaterials();
      // makeTileable returns a NODE material, so the result must be kept
      for (const k of Object.keys(f)) f[k] = f[k].map(makeTileable);
      return f;
    })(),
    base: (() => {
      const b = buildBaseMaterials();
      b.materials = b.materials.map(makeTileable);
      return b;
    })(),
    baseHeight: BASE_H,
    poolTexture: pool,
  };
}
