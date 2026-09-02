import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY_TYPES, BODY_KEYS } from '../vehicle/config.js';
import { toTex } from './textures.js';

/**
 * The traffic and parked fleet from Kenney's Car Kit (CC0, kenney.nl).
 *
 * Replaces the lofted "stunt" bodies -- a swept cross-section with a tyre
 * cylinder at each corner -- with authored low-poly cars: real wheel arches,
 * bumpers, grilles, lamps, mirrors. Same contract as buildStuntGeometries(),
 * so traffic.js and districtWorld.js keep working:
 *
 *   assets.geo.stunt[key] = { body, glass, lodBody, occupant, detail, detailMat }
 *
 * `body` is the PAINT: the faces whose palette colour is the model's dominant
 * one, so a plain material tinted per car (traffic: material.color; parked:
 * instance colour) gives the fleet its variety. `detail` is everything else --
 * glass, tyres, chrome, lamps -- drawn once with the kit's own 512^2 palette.
 * Two draws per body style per chunk instead of one; the price of colour.
 *
 * Kenney's proportions are toy-like (a sedan is 2.55 x 1.5m). The body is
 * scaled to the BODY_TYPES spec on each axis so traffic's collision radii and
 * lane offsets still describe the car you see; the wheels are scaled
 * uniformly and re-seated at the scaled hubs so they stay round.
 * Kenney cars face +Z; the fleet drives along local +X, so everything turns
 * a quarter turn (see buildKit).
 */
const BASE = '/models/vendor/kenney/cars/';
const QBASE = '/models/vendor/quaternius/cars/';
const SBASE = '/models/vendor/sketchfab/';   // owner-supplied bodies, hero-only, see NOTICE.md there

/**
 * Every body the game can wear, from two CC0 sources. Quaternius' Realistic
 * Car Pack (OBJ, flat colours, real proportions: a sports car is 3.96 x 1.8 x
 * 1.15 m) is the GTA-looking set; Kenney's Car Kit fills the shapes it lacks
 * (van, pickup). `k-` ids load a GLB with the palette texture, `q-` ids load
 * OBJ + MTL and bake the material colours into vertex colours.
 */
export const BODIES = {
  'q-sports':  { src: 'q', file: 'SportsCar' },
  'q-sports2': { src: 'q', file: 'SportsCar2' },
  'q-normal1': { src: 'q', file: 'NormalCar1' },
  'q-normal2': { src: 'q', file: 'NormalCar2' },
  'q-suv':     { src: 'q', file: 'SUV' },
  'q-taxi':    { src: 'q', file: 'Taxi' },
  'q-cop':     { src: 'q', file: 'Cop' },
  'k-van':     { src: 'k', file: 'van' },
  'k-truck':   { src: 'k', file: 'truck' },
  'k-suv-luxury': { src: 'k', file: 'suv-luxury' },
  'k-hatch':   { src: 'k', file: 'hatchback-sports' },
  'k-sedan':   { src: 'k', file: 'sedan' },
  /* Sketchfab bodies the owner dropped in: full PBR, dozens of materials, so
     they are worn as a whole textured group (no paint split, no instancing,
     no dents) and only by the hero. `front` says which local axis the nose
     is on; flip it if a car drives backwards. NC licences: see NOTICE.md. */
  's-camaro-jewel':  { src: 's', file: 'camaro-jewel',  front: '+z' },
  's-corvette-c6r':  { src: 's', file: 'corvette-c6r',  front: '+z' },
  's-camaro-350':    { src: 's', file: 'camaro-350',    front: '+z' },
  's-camaro-patrol': { src: 's', file: 'camaro-patrol', front: '+z' },
  's-corvette-zr1':  { src: 's', file: 'corvette-zr1',  front: '+z' },
  's-monza':         { src: 's', file: 'monza',         front: '+z' },
};
/** Traffic / parked style -> body id. */
export const KENNEY_CARS = {
  sedan: 'q-normal1', hatch: 'q-normal2', suv: 'q-suv', van: 'k-van',
  wagon: 'k-suv-luxury', pickup: 'k-truck',
  taxi: 'q-taxi', police: 'q-cop',
  sports: 'q-sports', sports2: 'q-sports2', hatch2: 'k-hatch',   // extra traffic styles, sedan-sized specs
  // the owner's Sketchfab cars, the three lightest, as rare traffic (whole textured groups)
  chev1: 's-camaro-jewel', chev2: 's-corvette-c6r', chev3: 's-camaro-350',
};
/* Spawn weights: the pooled fleet picks a style per car at start, so common
   bodies are listed several times and the heavy textured ones once. */
const STYLE_WEIGHT = { sedan: 4, hatch: 3, suv: 3, van: 2, wagon: 2, pickup: 2, taxi: 3, hatch2: 2, sports: 1, sports2: 1, chev1: 1, chev2: 1, chev3: 1 };
const NEUTRAL = new Set(['black', 'grey', 'gray', 'windows', 'window', 'glass', 'headlights', 'taillights', 'chrome', 'silver', 'lights', 'darkgrey', 'darkgray', 'white', 'tyre', 'tire', 'rubber']);
// styles with no spec of their own borrow the sedan's dimensions
const SPEC_OF = { taxi: 'sedan', police: 'sedan', sports: 'sedan', sports2: 'sedan', hatch2: 'hatch', chev1: 'sedan', chev2: 'sedan', chev3: 'sedan' };

const loader = new GLTFLoader();
const gltfCache = new Map();          // file -> Promise<gltf>; the fleet, the hero skin and the garage share one fetch
const fetchGltf = (file, base = BASE) => { const k = base + file; let p = gltfCache.get(k); if (!p) { p = new Promise((res, rej) => loader.load(base + file + '.glb', res, undefined, rej)); gltfCache.set(k, p); } return p; };
const _m = new THREE.Matrix4(), _v = new THREE.Vector3();

function samplePalette(image) {
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  return (u, v) => {
    const x = Math.min(c.width - 1, Math.max(0, Math.floor(u * c.width)));
    const y = Math.min(c.height - 1, Math.max(0, Math.floor((1 - v) * c.height)));
    const i = (y * c.width + x) * 4;
    /* Chroma, not colour: the Kenney colormap shades every hue down a
       gradient, so one body paint samples as a dozen RGB values (a sedan's
       grey ran 193..220). Divide by the max channel and the shades of one
       hue collapse together while cream, chrome and glass stay apart. */
    const r = data[i], gg = data[i + 1], b = data[i + 2], m = Math.max(1, r, gg, b);
    return [r / m, gg / m, b / m];
  };
}

/** Split an indexed geometry into (faces in the dominant paint hue, the rest). */
function splitByPaint(geo, sample) {
  const idx = geo.index.array, uv = geo.attributes.uv.array, pos = geo.attributes.position.array;
  const n = idx.length / 3, cluster = new Int32Array(n), centres = [], area = [];
  const TOL = 0.12;
  for (let f = 0; f < n; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const u = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, v = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
    const ch = sample(u, v);
    // face area weights the vote so a big roof outvotes a hundred tiny bolts
    const ax = pos[b * 3] - pos[a * 3], ay = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2];
    const bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const ar = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    let k = -1;
    for (let i = 0; i < centres.length; i++) {
      const cc = centres[i];
      if (Math.hypot(cc[0] - ch[0], cc[1] - ch[1], cc[2] - ch[2]) < TOL) { k = i; break; }
    }
    if (k < 0) { k = centres.length; centres.push(ch); area.push(0); }
    cluster[f] = k; area[k] += ar;
  }
  let paint = 0;
  for (let i = 1; i < area.length; i++) if (area[i] > area[paint]) paint = i;
  const pi = [], di = [];
  for (let f = 0; f < n; f++) (cluster[f] === paint ? pi : di).push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]);
  const sub = (list) => { const g = geo.clone(); g.setIndex(list); return g; };
  return { paint: sub(pi), detail: sub(di) };
}

function buildKit(gltf, spec, palette, { wheels: keepWheels = true } = {}) {
  gltf.scene.updateMatrixWorld(true);
  let body = null; const wheels = [], extras = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (o.name === 'body') body = g;
    else if (o.name.startsWith('wheel')) wheels.push(g);
    else extras.push(g);   // spoilers, grilles, doors: ride with the body
  });
  if (!body) throw new Error('no body node');
  if (extras.length) body = mergeGeometries([body, ...extras], false);

  body.computeBoundingBox();
  const bb = body.boundingBox;
  const len = bb.max.z - bb.min.z, wid = bb.max.x - bb.min.x;
  const sx = spec.L / len, sz = (spec.wMax * 2) / wid, sy = sz * 0.9;   // a touch lower than the toy proportions
  // centre the body on its footprint before scaling so the hubs land right
  const cz = (bb.max.z + bb.min.z) / 2, cx = (bb.max.x + bb.min.x) / 2;
  body.translate(-cx, 0, -cz);
  body.applyMatrix4(_m.makeScale(sz, sy, sx));   // x is width, z is length in Kenney space

  const { paint, detail } = splitByPaint(body, palette);
  const lodBody = body;                          // body without wheels: ~700 tris, fine at 200m

  const wheelParts = [];
  for (const w of wheels) {
    w.computeBoundingBox();
    w.boundingBox.getCenter(_v);
    w.translate(-_v.x, -_v.y, -_v.z);
    w.applyMatrix4(_m.makeScale(sz, sz, sz));
    w.translate((_v.x - cx) * sz, _v.y * sz, (_v.z - cz) * sx);
    wheelParts.push(w);
  }
  const detailAll = mergeGeometries(keepWheels ? [detail, ...wheelParts] : [detail], false);

  /* Kenney faces +Z; the fleet drives along local +X, so +Z -> +X. Verified
     the assumption-free way: camera placed 8m ahead along a moving van's
     measured travel direction sees its nose with this turn and its tail with
     the opposite one (the -pi/2 attempt lasted one frame). */
  const q = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  for (const g of [paint, detailAll, lodBody]) { g.applyMatrix4(q); g.computeBoundingSphere(); }
  paint.userData = { length: spec.L, width: spec.wMax * 2 };
  return { paint, detail: detailAll, lodBody };
}

import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

const objCache = new Map();
/** OBJ + MTL as a Group of Meshes with material arrays and geometry groups. */
function fetchObj(file) {
  let p = objCache.get(file);
  if (!p) {
    p = new Promise((res, rej) => {
      new MTLLoader().setPath(QBASE).load(file + '.mtl', (mtl) => {
        mtl.preload();
        new OBJLoader().setMaterials(mtl).setPath(QBASE).load(file + '.obj', res, undefined, rej);
      }, undefined, rej);
    });
    objCache.set(file, p);
  }
  return p;
}

/**
 * A Quaternius car into the kit contract. Every mesh is non-indexed with
 * material groups; the paint is the largest-area group whose material name
 * is not a neutral (black, grey, glass, lamps). Detail keeps every other
 * group with its MTL colour baked as vertex colour, wheels included, so one
 * vertexColors material draws all of it. Front is wherever the objects named
 * Front*Wheel sit, so the quarter turn onto +X is decided per car.
 */
function buildKitFromObj(group, spec, { wheels: keepWheels = true } = {}) {
  const bodies = [], wheels = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => { if (o.isMesh) (/wheel/i.test(o.name) ? wheels : bodies).push(o); });
  if (!bodies.length) throw new Error('no body mesh');
  // front: mean z of the front wheels
  let fz = 0, fn = 0;
  for (const w of wheels) if (/front/i.test(w.name)) { w.geometry.computeBoundingBox(); fz += (w.geometry.boundingBox.min.z + w.geometry.boundingBox.max.z) / 2; fn++; }
  const frontPlusZ = fn ? fz / fn > 0 : true;
  // area per material name across the body meshes
  const area = new Map(), colourOf = new Map();
  const faceArea = (p, i) => { const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2], bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2]; return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx); };
  const groupsOf = (m) => { const mats = Array.isArray(m.material) ? m.material : [m.material]; const gs = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: m.geometry.attributes.position.count, materialIndex: 0 }]; return gs.map((g) => ({ ...g, mat: mats[g.materialIndex] || mats[0] })); };
  for (const m of bodies) { const p = m.geometry.attributes.position.array; for (const g of groupsOf(m)) { let a = 0; for (let v = g.start; v < g.start + g.count; v += 3) a += faceArea(p, v * 3); const n = (g.mat.name || '').toLowerCase(); area.set(n, (area.get(n) || 0) + a); colourOf.set(n, g.mat.color); } }
  let paintName = null, best = -1;
  for (const [n, a] of area) if (!NEUTRAL.has(n.replace(/[^a-z]/g, '')) && a > best) { best = a; paintName = n; }
  // split: paint ranges vs detail ranges (detail gets vertex colours)
  const paintParts = [], detailParts = [];
  const slice = (m, g, withColour) => {
    const src = m.geometry, geo = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) { const at = src.attributes[k]; if (!at) continue; geo.setAttribute(k, new THREE.BufferAttribute(at.array.slice(g.start * at.itemSize, (g.start + g.count) * at.itemSize), at.itemSize)); }
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.count * 2), 2));
    if (withColour) { const c = g.mat.color, arr = new Float32Array(g.count * 3); for (let i = 0; i < g.count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); }
    geo.applyMatrix4(m.matrixWorld);
    return geo;
  };
  // every part carries a colour attribute (paint parts too) so mergeGeometries accepts any mix of them
  for (const m of bodies) for (const g of groupsOf(m)) ((g.mat.name || '').toLowerCase() === paintName ? paintParts : detailParts).push(slice(m, g, true));
  if (keepWheels) for (const w of wheels) for (const g of groupsOf(w)) detailParts.push(slice(w, g, true));
  const paint = mergeGeometries(paintParts, false), detail = mergeGeometries(detailParts, false);
  const all = mergeGeometries([...paintParts, ...detailParts], false);
  if (!paint || !detail || !all) throw new Error('merge failed (mixed attributes)');
  // centre on the footprint, scale to the spec, turn the front onto +X
  paint.computeBoundingBox(); const bb = paint.boundingBox.clone();
  for (const g of [detail, all]) { g.computeBoundingBox(); bb.union(g.boundingBox); }
  const len = bb.max.z - bb.min.z, wid = bb.max.x - bb.min.x, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, y0 = bb.min.y;
  const M = new THREE.Matrix4().makeRotationY(frontPlusZ ? Math.PI / 2 : -Math.PI / 2)
    .multiply(new THREE.Matrix4().makeScale((spec.wMax * 2) / wid, (spec.wMax * 2) / wid, spec.L / len))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -y0, -cz));
  for (const g of [paint, detail, all]) { g.applyMatrix4(M); g.computeBoundingSphere(); }
  paint.userData = { length: spec.L, width: spec.wMax * 2 };
  return { paint, detail, lodBody: all };
}

/** Any body id -> { paint, detail, detailMat, lodBody }, from either source. */
export async function fetchKit(id, spec, assets, opts = {}) {
  const def = BODIES[id] ?? BODIES['q-sports'];
  if (def.src === 's') {
    // whole textured model, nose to +X, bottom at 0, scaled by LENGTH so the proportions stay real
    const gltf = await fetchGltf(def.file, SBASE);
    const group = gltf.scene.clone(true);
    group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(group), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const zLong = size.z >= size.x;
    const len = zLong ? size.z : size.x;
    const wrap = new THREE.Group();
    group.position.set(-c.x, -bb.min.y, -c.z);
    wrap.add(group);
    const turn = zLong ? (def.front === '-z' ? -Math.PI / 2 : Math.PI / 2) : (def.front === '-x' ? Math.PI : 0);
    wrap.rotation.y = turn;
    const k = spec.L / len; wrap.scale.set(k, k, k);
    wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    return { group: wrap, paint: null, detail: null, detailMat: null, lodBody: null };
  }
  if (def.src === 'q') {
    const group = await fetchObj(def.file);
    const kit = buildKitFromObj(group, spec, opts);
    assets.mat.carVertex ??= (() => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 }); m.name = 'car_vertex'; return m; })();
    return { ...kit, detailMat: assets.mat.carVertex };
  }
  const gltf = await fetchGltf(def.file);
  if (!assets.mat.carKit) {
    let map = null; gltf.scene.traverse((o) => { if (!map && o.isMesh && o.material?.map) map = o.material.map; });
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    assets.mat.carKit = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.08 }); assets.mat.carKit.name = 'car_kit_palette';
    assets.kenneyPalette = samplePalette(map.image);
  }
  return { ...buildKit(gltf, spec, assets.kenneyPalette, opts), detailMat: assets.mat.carKit };
}

/**
 * The hero wears a Kenney body too (item 1 of the visual list, 2026-09-02).
 *
 * The lofted hull stays as the PHYSICS and damage carrier -- its wheels
 * steer and spin, its interior, driver, steering wheel and lamps stay -- but
 * the visible skin becomes the kit's sports sedan, scaled to the hull's own
 * length and width so nothing downstream (camera offsets, collision probes,
 * door hinge maths) moves. Hidden: the hull body and glass, the four hinged
 * doors and the box trim. The paint mesh shares the hero's `paint` material
 * so damage soot and stolen-car colours still apply, and it becomes
 * userData.hull so the crumple lands on what you see. Known loss: the doors
 * no longer swing open on a carjack; the body is one piece.
 */
export async function loadHeroSkin(assets, hero, file = 'q-sports') {
  const u = hero.userData;
  /* Re-fits: after the first skin userData.hull is the Kenney paint mesh, not
     the loft -- measuring that (and its parent, the old skin group) put the
     second body nowhere. Keep the loft hull as the fixed reference. */
  u.loftHull ??= u.hull;
  const hull = u.loftHull;
  if (!hull) return false;
  if (u.skin) { u.skin.parent?.remove(u.skin); u.skin = null; }
  hull.geometry.computeBoundingBox();
  const bb = hull.geometry.boundingBox;                 // shell space: nose at 0, tail at +L
  const L = bb.max.x - bb.min.x, W = bb.max.z - bb.min.z;
  const kit = await fetchKit(file, { L, wMax: W / 2 }, assets, { wheels: false }).catch((e) => { console.warn('hero skin', file, e.message); return null; });
  if (!kit) return false;
  if (kit.group) {
    // a whole textured body (Sketchfab): hide the loft skin, hang the group where the hull centre is
    const shellG = hull.parent, trimG = assets.carMats.trim, paintG = hull.material, glassG = u.glass?.material;
    shellG.traverse((o) => { if (o.isMesh && (o.material === paintG || o.material === glassG || o.material === trimG)) o.visible = false; });
    const cxG = (bb.min.x + bb.max.x) / 2;
    kit.group.position.set(shellG.position.x - cxG, bb.min.y, 0);
    shellG.parent.add(kit.group);
    u.skin = kit.group;
    u.hull = hull;                                         // dents land on the hidden loft: invisible, harmless
    return true;
  }
  const shell = hull.parent;
  // hide the loft skin: body, glass, doors and trim; keep lamps, interior, driver, wheel
  const trim = assets.carMats.trim, paint = hull.material, glass = u.glass?.material;
  shell.traverse((o) => { if (o.isMesh && (o.material === paint || o.material === glass || o.material === trim)) o.visible = false; });
  const paintGeo = kit.paint.clone();                    // the hero crumples its own copy
  paintGeo.userData.owned = true;
  const skin = new THREE.Group();
  // the kit body is centred and faces +X; the hull is centred at (min+max)/2 in shell space, which the
  // half-turned shell puts at CG_X - centre in body space, nose forward
  const cx = (bb.min.x + bb.max.x) / 2;
  skin.position.set(shell.position.x - cx, bb.min.y, 0);
  const pm = new THREE.Mesh(paintGeo, paint); pm.castShadow = true; pm.receiveShadow = true;
  const dm = new THREE.Mesh(kit.detail, kit.detailMat); dm.castShadow = true; dm.receiveShadow = true;
  skin.add(pm, dm);
  shell.parent.add(skin);
  u.hull = pm;                                           // damage.attach() reads this
  u.skin = skin;
  return true;
}

/**
 * Load every mapped model and install it over assets.geo.stunt. Resolves when
 * done; on any failure that style keeps its lofted body, so the game never
 * waits on or breaks for a missing file.
 */
export async function loadVendorCars(assets) {
  const installed = [];
  // Pre-cache all BODIES in parallel so mid-game car stealing & garage fitting is 100% instant
  const allBodyIds = [...new Set([...Object.values(KENNEY_CARS), ...Object.keys(BODIES)])];
  await Promise.all(allBodyIds.map(async (id) => {
    try {
      const spec = BODY_TYPES.sedan;
      await fetchKit(id, spec, assets).catch(() => null);
    } catch (e) { /* ignore pre-cache errors */ }
  }));

  await Promise.all(Object.entries(KENNEY_CARS).map(async ([key, id]) => {
    try {
      const spec = BODY_TYPES[key] ?? BODY_TYPES[SPEC_OF[key]] ?? BODY_TYPES.sedan;
      const kit = await fetchKit(id, spec, assets);
      const old = assets.geo.stunt[key];
      assets.geo.stunt[key] = kit.group
        ? { group: kit.group, heavy: true, occupant: old?.occupant ?? assets.geo.stunt.sedan.occupant, vendor: true }
        : {
          body: kit.paint, glass: kit.detail, detail: kit.detail, detailMat: kit.detailMat,
          lodBody: kit.lodBody, occupant: old?.occupant ?? assets.geo.stunt.sedan.occupant, vendor: true,
        };
      installed.push(key);
    } catch (e) { console.warn(`vendor car ${key} (${id}) failed: ${e.message}; keeping the loft`); }
  }));
  // traffic picks from every installed style except the police cruiser, weighted (STYLE_WEIGHT)
  const keys = [...new Set([...BODY_KEYS, ...installed.filter((k) => k !== 'police')])];
  assets.geo.stuntKeys = keys.flatMap((k) => Array(STYLE_WEIGHT[k] ?? 1).fill(k));
  console.info(`vendor cars: ${installed.length}/${Object.keys(KENNEY_CARS).length} installed (${installed.join(', ')})`);
  return installed;
}
