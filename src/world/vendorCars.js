import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BODY_TYPES, BODY_KEYS } from '../vehicle/config.js';
import { buildWaymoIPace, IPACE_SPEC } from '../vehicle/waymo.js';
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
  // 2026-09-13, from Arun's downloads. Long axis Z like the Chevrolets; '+z' is the family default -- flip if one drives backwards.
  's-porsche-gt3r':  { src: 's', file: 'porsche-gt3r',  front: '+z' },
  /* Procedural bodies: built in code, no file on disk. `p-waymo` is the Waymo
     Jaguar I-Pace (vehicle/waymo.js), authored from memory with zero assets. */
  'p-waymo': { src: 'p', file: 'waymo-ipace' },
  's-f40-comp':      { src: 's', file: 'f40-comp',      front: '+z', pose: 'end' },   // rigged: rest pose has the door OPEN, its one clip is 'DoorFrontLeftClose'
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
/* The Sketchfab cars are OUT of ambient traffic (2026-09-11): 28k-50k
   triangles each against a 4k traffic budget, and a shadow caster apiece.
   They stay in the garage as cars you buy; the roads run on the Quaternius
   and Kenney fleet. */
const STYLE_WEIGHT = { sedan: 4, hatch: 3, suv: 3, van: 2, wagon: 2, pickup: 2, taxi: 3, hatch2: 2, sports: 1, sports2: 1, chev1: 0, chev2: 0, chev3: 0 };   // explicit 0: the picker defaults a missing key to 1
/* Never bodywork, whatever else a car is made of -- the fallback below may
   pick a neutral as the paint, but never one of these. */
const NON_PAINT = new Set(['windows', 'window', 'glass', 'headlights', 'taillights', 'lights', 'chrome', 'tyre', 'tire', 'rubber']);
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
  /* Every material neutral -- which is SUV and SportsCar2 exactly: their MTLs
     carry only Black, Grey, Headlights, TailLights, White, Windows, and all six
     are in NEUTRAL. paintName stayed null, no group matched it, paintParts came
     out EMPTY, and mergeGeometries([]) reads geometries[0].index and throws
     "Cannot read properties of undefined (reading 'index')" -- which is why two
     of the fleet's body styles silently fell back to the loft.
     A white or grey car is still a car: fall back to the largest material that
     CANNOT be bodywork-excluded. NEUTRAL stays as it is, because its job is to
     stop a chrome bumper winning the hue vote on a car that has a real colour. */
  if (!paintName) {
    for (const [n, a] of area) {
      if (NON_PAINT.has(n.replace(/[^a-z]/g, '')) || a <= best) continue;
      best = a; paintName = n;
    }
  }
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
  // a clear failure beats mergeGeometries reading geometries[0].index on an empty array
  if (!paintParts.length) throw new Error(`no paint material found (materials: ${[...area.keys()].join(', ')})`);
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
  if (def.src === 'p') {
    /* Procedural whole-group body (the Waymo I-Pace). Same contract as the
       's' path: nose +X, centred, base at y=0 — the builder guarantees it,
       so only the length is scaled onto the caller's spec. Wheels are its
       own (static), like every whole-group body. */
    const group = buildWaymoIPace();
    const k = spec.L / IPACE_SPEC.L;
    group.scale.setScalar(k);
    group.updateMatrixWorld(true);
    group.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.frustumCulled = false; } });
    // no driver in a Waymo: the eye sits mid-cabin at the sensor operator's row
    const eye = new THREE.Vector3(-0.05 * spec.L, 0.98 * k, -0.36 * k);
    const cockpit = { back: -eye.x, up: eye.y - 0.62, side: eye.z };
    return { group, paint: null, detail: null, detailMat: null, lodBody: null, cockpit };
  }
  if (def.src === 's') {
    // whole textured model, nose to +X, bottom at 0, scaled by LENGTH so the proportions stay real
    const gltf = await fetchGltf(def.file, SBASE);
    /* SkeletonUtils.clone, not Object3D.clone. The F40 Competizione export is
       SKINNED (wheels rigged to bones); a plain clone(true) leaves each
       SkinnedMesh bound to the bones under the ORIGINAL, never-placed root, so
       the body rendered at the world origin -- 155k triangles loaded with no
       error and nothing on screen but the under-glow. SkeletonUtils rebinds the
       clone to its own bones; on an unskinned scene it is a plain deep clone. */
    const group = skeletonClone(gltf.scene);
    /* Some rigged exports ship with their doors/hood OPEN as the rest pose and
       an animation that closes them (the F40: one 3 s clip, 'DoorFrontLeftClose').
       `pose: 'end'` plays every clip to its last frame once, so the bones settle
       in the closed state, and the mixer is dropped -- nothing drives them after. */
    if (def.pose === 'end' && gltf.animations?.length) {
      const mixer = new THREE.AnimationMixer(group);
      let dur = 0;
      for (const clip of gltf.animations) {
        /* LoopOnce + clamp, or the default LoopRepeat WRAPS at the end and
           update(duration) lands back on frame 0 -- the door open again. */
        const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
        dur = Math.max(dur, clip.duration);
      }
      mixer.update(dur + 0.01);
    }
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
    /* Shadow casting is gated by SIZE (2026-09-13). A Sketchfab body is a
       parts library: the C8 arrives as 976 meshes, 656 of them wheel spokes,
       lug bolts and calliper badges. Every one was a caster, and cascade 0
       redraws every caster -- measured in the browser as 985 of the frame's
       2411 direct draws (41%), the single largest consumer in the game.
       Anything whose world bounding radius is under 0.20 m sits INSIDE the
       car's own silhouette, so its shadow is never separable from the body's;
       the measured distribution has its natural break exactly there
       (183 casters above 0.15 m, 68 above 0.20 m). Panels, glass and tyres
       stay; the jewellery stops. Do not raise this to "fix" a draw count --
       the wheel rims live just above it. */
    wrap.updateMatrixWorld(true);
    const SHADOW_MIN_R = 0.20;
    wrap.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const e = o.matrixWorld.elements;
        const scale = Math.hypot(e[0], e[1], e[2]);
        o.castShadow = (g.boundingSphere?.radius ?? 0) * scale > SHADOW_MIN_R;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          if (o.material.metalness !== undefined) {
            o.material.envMapIntensity = 1.4;
          }
        }
      }
    });
    /* Where the driver's eye is IN THIS BODY, for the cockpit camera (camera.js
       merges it over the loft-tuned numbers). The loft's seat sits at local
       (2.1, 1.0, +0.36) and the cockpit rig was measured against it; a vendor
       body puts its seat wherever the real car does -- the F40 and the 911 well
       forward, the C8 further back -- so a fixed eye ended up in the dash or over
       the roof: "steering, dashboard not visible properly". Prefer the model's
       own steering wheel node when it has one (the F40 rig names it), sit 0.42 m
       behind it and 0.30 m above its hub; otherwise fall back to the box: eye at
       the car's centre, 0.74 of its height, on the loft's side of the cabin. */
    wrap.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(wrap), ws = wb.getSize(new THREE.Vector3());
    let eye = null;
    // Arun's perfect_racing_pov: the head sits ~0.6 m behind the hub, so the whole wheel and cluster fit in the lower half
    wrap.traverse((o) => {
      if (!eye && /steer/i.test(o.name)) eye = o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.82, 0.22, 0));   // Arun asked for more distance from the wheel: 0.82 m behind the hub
    });
    // a low car with a high hub (the F40: roof ~1.1 m) put the eye through its headliner at +0.36; never above 76% of the body
    if (eye) eye.y = Math.min(eye.y, ws.y * 0.76);
    /* Fallback, calibrated on the C8 and the 992: 0.74 of the box height put the
       eye at 0.90 m in both, which read right; the car's CENTRE did not -- the
       911's seats are ~0.5 m ahead of it (rear engine) and from there you were at
       the B-pillar looking at roll cage and roof. 6% of the length forward covers
       both. And -0.36: every vendor body here is left-hand drive; +0.36 was the
       loft's seat and put the eye in the passenger seat with no wheel in view. */
    if (!eye) eye = new THREE.Vector3(ws.x * 0.03 - 0.40, ws.y * 0.74, -0.36);   // and 20 cm further back on the box path to match   // 0.06 put the 992's eye past its wheel and 0.74 of the height into its headliner; 0.03 / 0.70 frame both it and the C8
    const cockpit = { back: -eye.x, up: eye.y - 0.62, side: eye.z };   // camera.js: back is rearward-positive, up is over car.y (= ground + 0.62)
    return { group: wrap, paint: null, detail: null, detailMat: null, lodBody: null, cockpit };
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
 * The hero car skin loader. Supports both procedural/Quaternius kits and
 * full-fidelity high-poly Sketchfab hero bodies (e.g. Corvette C8 ZR1, Monza).
 */
/* THE default car, in one place (2026-09-15). It used to live in three:
   here, main.js:initialBody and garage.js:fitted, each hardcoded to
   's-corvette-zr1'. Changing main.js alone did nothing -- the garage constructs
   after it, sets its own default, and stamps it into localStorage 'hb.body',
   so the yellow Corvette came back on every boot. Measured: cleared the key
   before load, and it read 's-corvette-zr1' again 24 s later.
   camaro-350 is the deep blue one: `CarPaint` #001b8a, the only shipped body
   whose most-saturated material is paint rather than lights or calipers. */
export const DEFAULT_BODY = 's-camaro-350';

export async function loadHeroSkin(assets, hero, file = DEFAULT_BODY) {
  const u = hero.userData;
  u.loftHull ??= u.hull;
  const hull = u.loftHull;
  if (!hull) return false;
  if (u.skin) { u.skin.parent?.remove(u.skin); u.skin = null; }
  hull.geometry.computeBoundingBox();
  const bb = hull.geometry.boundingBox;                 // shell space: nose at 0, tail at +L
  const L = bb.max.x - bb.min.x, W = bb.max.z - bb.min.z;
  const kit = await fetchKit(file, { L, wMax: W / 2 }, assets, { wheels: false }).catch((e) => { console.warn('hero skin', file, e.message); return null; });
  if (!kit) return false;

  const shellG = hull.parent;
  if (kit.group) {
    // Whole textured body (Sketchfab): hide procedural loft shell & procedural wheels
    shellG.traverse((o) => { if (o.isMesh) o.visible = false; });
    u.cockpit = kit.cockpit ?? null;   // the eye for this body's own interior (camera.js cockpit rig)
    if (u.wheels) {
      for (const w of u.wheels) if (w.steer) w.steer.visible = false;
    }
    const cxG = (bb.min.x + bb.max.x) / 2;
    // Tyre contact plane is at y=0, perfectly seated on the asphalt
    kit.group.position.set(shellG.position.x - cxG, 0, 0);
    shellG.parent.add(kit.group);
    u.skin = kit.group;
    u.hull = hull;                                         // dents land on the hidden loft: invisible, harmless
    return true;
  }

  // Restore procedural shell & wheels when switching to standard or Quaternius body
  shellG.traverse((o) => { if (o.isMesh) o.visible = true; });
  u.cockpit = null;   // back on the loft: its interior, its tuned eye
  if (u.wheels) {
    for (const w of u.wheels) if (w.steer) w.steer.visible = true;
  }
  const trim = assets.carMats.trim, paint = hull.material, glass = u.glass?.material;
  shellG.traverse((o) => { if (o.isMesh && (o.material === paint || o.material === glass || o.material === trim)) o.visible = false; });
  const paintGeo = kit.paint.clone();                    // the hero crumples its own copy
  paintGeo.userData.owned = true;
  const skin = new THREE.Group();
  const cx = (bb.min.x + bb.max.x) / 2;
  skin.position.set(shellG.position.x - cx, bb.min.y, 0);
  const pm = new THREE.Mesh(paintGeo, paint); pm.castShadow = true; pm.receiveShadow = true;
  const dm = new THREE.Mesh(kit.detail, kit.detailMat); dm.castShadow = true; dm.receiveShadow = true;
  skin.add(pm, dm);
  shellG.parent.add(skin);
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
