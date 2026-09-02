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
export const KENNEY_CARS = {
  sedan: 'sedan', hatch: 'hatchback-sports', suv: 'suv', van: 'van',
  wagon: 'suv-luxury', pickup: 'truck',
  taxi: 'taxi', police: 'police',
};
// styles with no spec of their own borrow the sedan's dimensions
const SPEC_OF = { taxi: 'sedan', police: 'sedan' };

const loader = new GLTFLoader();
const gltfCache = new Map();          // file -> Promise<gltf>; the fleet, the hero skin and the garage share one fetch
const fetchGltf = (file) => { let p = gltfCache.get(file); if (!p) { p = new Promise((res, rej) => loader.load(BASE + file + '.glb', res, undefined, rej)); gltfCache.set(file, p); } return p; };
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
  const sx = spec.L / len, sz = (spec.wMax * 2) / wid, sy = sz;
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
export async function loadHeroSkin(assets, hero, file = 'sedan-sports') {
  const u = hero.userData;
  const hull = u.hull;
  if (!hull || !assets.mat.carKit) return false;
  const gltf = await fetchGltf(file).catch(() => null);
  if (!gltf) return false;
  let map = null; gltf.scene.traverse((o) => { if (!map && o.isMesh && o.material?.map) map = o.material.map; });
  const palette = samplePalette(map.image);
  hull.geometry.computeBoundingBox();
  const bb = hull.geometry.boundingBox;                 // shell space: nose at 0, tail at +L
  const L = bb.max.x - bb.min.x, W = bb.max.z - bb.min.z;
  const kit = buildKit(gltf, { L, wMax: W / 2 }, palette, { wheels: false });
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
  const dm = new THREE.Mesh(kit.detail, assets.mat.carKit); dm.castShadow = true; dm.receiveShadow = true;
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
  let detailMat = null, palette = null;
  const installed = [];
  // one round trip for the whole kit instead of eight in a row
  const entries = Object.entries(KENNEY_CARS);
  const loaded = await Promise.all(entries.map(([, file]) => fetchGltf(file).catch((e) => e)));
  for (let n = 0; n < entries.length; n++) {
    const [key, file] = entries[n];
    try {
      const gltf = loaded[n];
      if (gltf instanceof Error) throw gltf;
      if (!detailMat) {
        let map = null;
        gltf.scene.traverse((o) => { if (!map && o.isMesh && o.material?.map) map = o.material.map; });
        if (!map) throw new Error('no colormap');
        palette = samplePalette(map.image);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        detailMat = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.08 });
        detailMat.name = 'car_kit_palette';
        assets.mat.carKit = detailMat;
      }
      const spec = BODY_TYPES[key] ?? BODY_TYPES[SPEC_OF[key]] ?? BODY_TYPES.sedan;
      const kit = buildKit(gltf, spec, palette);
      const old = assets.geo.stunt[key];
      assets.geo.stunt[key] = {
        body: kit.paint, glass: kit.detail, detail: kit.detail, detailMat,
        lodBody: kit.lodBody, occupant: old?.occupant ?? assets.geo.stunt.sedan.occupant,
        vendor: true,
      };
      installed.push(key);
    } catch (e) {
      console.warn(`vendor car ${key} (${file}) failed: ${e.message}; keeping the loft`);
    }
  }
  // traffic may pick any installed style that has a spec to drive with
  assets.geo.stuntKeys = [...BODY_KEYS, ...(installed.includes('taxi') ? ['taxi'] : [])];
  console.info(`vendor cars: ${installed.length}/${Object.keys(KENNEY_CARS).length} installed (${installed.join(', ')})`);
  return installed;
}
