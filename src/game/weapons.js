import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The arsenal: four weapons, their handling numbers, and their models.
 *
 * `weapon.js` owns the hitscan ray and the feedback. This file owns what a
 * weapon IS -- how fast it fires, how far it throws its shots, how long you
 * spend reloading -- and what it looks like in a hand. Splitting them means
 * the police can carry the same weapons the player does and behave correctly
 * without a second implementation.
 *
 * Nothing is downloaded. Every model is Boxes and Cylinders merged into one
 * vertex-coloured geometry, so a weapon is ONE draw call and arrives with real
 * UVs. At the range you see a gun -- in your own hands, or across a street in
 * an officer's -- silhouette and proportion are what read; a scanned receiver
 * would cost 30k triangles to say the same thing.
 *
 * Muzzles point +X, like the characters holding them.
 */

const C = {
  frame:  0x2a2d33,   // polymer/steel body
  slide:  0x3a3f47,   // lighter top surface, so the shape reads in shadow
  grip:   0x1c1e22,
  wood:   0x5a4632,   // shotgun furniture
  metal:  0x1a1c20,   // barrel
  sight:  0xd8dde5,
};

/**
 * Handling. Spread is in radians of cone half-angle: `rest` is the aimed
 * accuracy, and every shot adds `gain` up to `max`, recovering at `decay` per
 * second once you stop. That single mechanism is what makes an SMG a spray
 * weapon and a rifle a marksman's, without special-casing either.
 */
export const ARSENAL = {
  pistol: {
    name: 'PISTOL', damage: 26, cooldown: 0.22, mag: 12, reload: 1.5, range: 70,
    pellets: 1, auto: false, restSpread: 0.012, maxSpread: 0.075, spreadGain: 0.020, spreadDecay: 0.11,
    // muzzle offsets are the measured barrel end of each model, so the flash
    // sits on the barrel instead of floating in front of it (test caught this)
    recoil: 0.020, shake: 0.30, muzzle: 0.20, reserve: 48,
  },
  smg: {
    name: 'SMG', damage: 17, cooldown: 0.075, mag: 30, reload: 2.1, range: 60,
    pellets: 1, auto: true, restSpread: 0.030, maxSpread: 0.135, spreadGain: 0.013, spreadDecay: 0.24,
    recoil: 0.013, shake: 0.22, muzzle: 0.30, reserve: 90,
  },
  rifle: {
    name: 'RIFLE', damage: 34, cooldown: 0.115, mag: 30, reload: 2.6, range: 120,
    pellets: 1, auto: true, restSpread: 0.010, maxSpread: 0.090, spreadGain: 0.011, spreadDecay: 0.20,
    recoil: 0.024, shake: 0.38, muzzle: 0.53, reserve: 90,
  },
  shotgun: {
    name: 'SHOTGUN', damage: 15, cooldown: 0.78, mag: 6, reload: 3.0, range: 34,
    pellets: 8, auto: false, restSpread: 0.085, maxSpread: 0.130, spreadGain: 0.010, spreadDecay: 0.30,
    recoil: 0.055, shake: 0.85, muzzle: 0.51, reserve: 18,
  },
};

export const WEAPON_KINDS = Object.keys(ARSENAL);

function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  return geo;
};
const box = (w, h, d, hex) => tint(new THREE.BoxGeometry(w, h, d), hex);
/** A barrel lying along +X. */
const barrel = (r, len, hex, seg = 7) => {
  const g = tint(new THREE.CylinderGeometry(r, r, len, seg), hex);
  g.rotateZ(Math.PI / 2);
  return g;
};

/* ------------------------------------------------------------------- models
   Origin is the grip, roughly where the hand closes, so attaching a weapon to
   a hand is a position with no fudge factor. Muzzle sits at +X `muzzle` metres,
   which is the number `ARSENAL[kind].muzzle` reports back to the shooter. */

function pistolGeo() {
  const p = [];
  p.push(at(box(0.055, 0.115, 0.032, C.grip), -0.01, -0.055, 0, 0, 0, 0.18));  // grip
  p.push(at(box(0.175, 0.048, 0.030, C.slide), 0.065, 0.022, 0));              // slide
  p.push(at(box(0.155, 0.030, 0.026, C.frame), 0.058, -0.010, 0));             // frame
  p.push(at(barrel(0.009, 0.055, C.metal), 0.170, 0.022, 0));                  // muzzle
  p.push(at(box(0.032, 0.020, 0.020, C.frame), -0.005, -0.020, 0));            // trigger guard
  p.push(at(box(0.010, 0.012, 0.024, C.sight), 0.140, 0.050, 0));              // front sight
  return mergeGeometries(p, false);
}

function smgGeo() {
  const p = [];
  p.push(at(box(0.050, 0.120, 0.034, C.grip), -0.02, -0.058, 0, 0, 0, 0.14));
  p.push(at(box(0.235, 0.062, 0.040, C.frame), 0.085, 0.020, 0));              // receiver
  p.push(at(box(0.040, 0.130, 0.030, C.grip), 0.070, -0.062, 0, 0, 0, 0.05));  // magazine
  p.push(at(barrel(0.011, 0.110, C.metal), 0.245, 0.020, 0));
  p.push(at(box(0.075, 0.030, 0.026, C.frame), 0.215, 0.052, 0));              // top rail
  p.push(at(box(0.090, 0.026, 0.024, C.frame), -0.075, 0.020, 0));             // folded stock
  p.push(at(box(0.010, 0.014, 0.022, C.sight), 0.250, 0.058, 0));
  return mergeGeometries(p, false);
}

function rifleGeo() {
  const p = [];
  p.push(at(box(0.050, 0.120, 0.034, C.grip), -0.03, -0.058, 0, 0, 0, 0.16));
  p.push(at(box(0.300, 0.066, 0.042, C.frame), 0.110, 0.024, 0));              // receiver
  p.push(at(box(0.044, 0.150, 0.032, C.grip), 0.055, -0.072, 0, 0, 0, 0.04));  // magazine
  p.push(at(box(0.150, 0.048, 0.036, C.frame), 0.300, 0.020, 0));              // handguard
  p.push(at(barrel(0.010, 0.170, C.metal), 0.440, 0.020, 0));
  p.push(at(box(0.034, 0.030, 0.030, C.metal), 0.520, 0.020, 0));              // flash hider
  p.push(at(box(0.150, 0.055, 0.030, C.frame), -0.130, 0.016, 0));             // stock
  p.push(at(box(0.070, 0.034, 0.028, C.slide), 0.180, 0.062, 0));              // optic
  p.push(at(box(0.012, 0.016, 0.024, C.sight), 0.400, 0.056, 0));
  return mergeGeometries(p, false);
}

function shotgunGeo() {
  const p = [];
  p.push(at(box(0.052, 0.115, 0.036, C.wood), -0.02, -0.055, 0, 0, 0, 0.16));
  p.push(at(box(0.260, 0.060, 0.044, C.frame), 0.100, 0.022, 0));              // receiver
  p.push(at(barrel(0.017, 0.300, C.metal), 0.360, 0.030, 0));                  // barrel
  p.push(at(barrel(0.013, 0.240, C.wood), 0.300, -0.008, 0));                  // pump / tube
  p.push(at(box(0.170, 0.060, 0.034, C.wood), -0.140, 0.014, 0, 0, 0, -0.06)); // stock
  p.push(at(box(0.010, 0.014, 0.020, C.sight), 0.500, 0.048, 0));
  return mergeGeometries(p, false);
}

const BUILDERS = { pistol: pistolGeo, smg: smgGeo, rifle: rifleGeo, shotgun: shotgunGeo };

let GEO = null, MAT = null;
function cache() {
  if (GEO) return;
  MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  GEO = {};
  for (const k of WEAPON_KINDS) { GEO[k] = BUILDERS[k](); GEO[k].computeBoundingSphere(); }
}

/** The one material every weapon draws with, for the boot pipeline warm-up. */
export function weaponMaterial() { cache(); return MAT; }

/** One mesh, one draw, geometry shared with every other holder of this weapon. */
export function buildWeaponMesh(kind = 'pistol') {
  cache();
  const g = GEO[BUILDERS[kind] ? kind : 'pistol'];
  const m = new THREE.Mesh(g, MAT);
  m.castShadow = true;
  return m;
}

export function disposeWeapons() {
  if (!GEO) return;
  for (const k of Object.keys(GEO)) GEO[k].dispose();
  MAT.dispose();
  GEO = null; MAT = null;
}

/**
 * Current cone half-angle for a shooter's accumulated heat, 0..1.
 * Pulled out as a pure function so the handling curve is testable without a
 * scene, a camera or a frame loop.
 */
export function spreadFor(kind, heat) {
  const w = ARSENAL[kind] ?? ARSENAL.pistol;
  const h = Math.max(0, Math.min(1, heat));
  return w.restSpread + (w.maxSpread - w.restSpread) * h;
}

/** Heat after firing one shot, and after `dt` of not firing. */
export function heatAfterShot(kind, heat) {
  const w = ARSENAL[kind] ?? ARSENAL.pistol;
  return Math.min(1, heat + w.spreadGain / Math.max(1e-4, w.maxSpread - w.restSpread));
}
export function heatAfterRest(kind, heat, dt) {
  const w = ARSENAL[kind] ?? ARSENAL.pistol;
  return Math.max(0, heat - w.spreadDecay * dt);
}
