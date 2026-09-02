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

  const mat = {
    // Standard rather than Lambert on the carriageway: roughness plus the
    // environment map is what makes wet asphalt catch the sky and the lamps.
    road: new THREE.MeshStandardMaterial({
      map: road, roughness: 0.36, metalness: 0.08, envMapIntensity: 1.05,
    }),
    // the district's carriageway: unpainted, tiled by the metre
    /* Asphalt needs relief, not just a picture of asphalt.
       With albedo alone the carriageway is a flat sheet under the sun and the
       aggregate painted into the texture never catches a highlight -- it read
       as grey plastic. The normal map comes from the texture's own luminance,
       so the stones that are drawn bright are the stones that stand proud. */
    tarmac: new THREE.MeshStandardMaterial({
      map: plain, normalMap: plainNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.42, metalness: 0.06, envMapIntensity: 0.8,
    }),
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
    /* The same slabs, tiled ONCE.
       `walk` carries repeat = (WALK_W/2.4, CELL/2.4) for the legacy 130m grid,
       which writes no UVs of its own. districtWorld DOES write real UVs, in
       units of tiles -- so the repeat multiplied on top of them, crushing a
       4x4 slab pattern to roughly a fiftieth of a texel down the length of
       every pavement. At a grazing angle that aliases into black corrugation,
       which is what the pavements have looked like all along. */
    walkDistrict: new THREE.MeshLambertMaterial({ map: (() => {
      const t = walk.clone();
      t.repeat.set(1, 1);
      t.needsUpdate = true;
      return t;
    })() }),
    kerb: new THREE.MeshLambertMaterial({ color: 0x44474c }),
    roof: new THREE.MeshLambertMaterial({ color: 0x2a2e34 }),
    roofGlass: new THREE.MeshStandardMaterial({
      color: 0x1a222c, roughness: 0.18, metalness: 0.55, envMapIntensity: 1.35,
    }),
    crown: new THREE.MeshStandardMaterial({
      color: 0xc8e0f4, emissive: 0x8ec4e8, emissiveIntensity: 1.7,
      roughness: 0.28, metalness: 0.2,
    }),
    pole: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.62, metalness: 0.55 }),
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
