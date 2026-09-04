import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A police officer with a face and a body, built entirely from primitives.
 *
 * The old officer was `personGeometry()` -- a navy capsule -- with an
 * icosahedron for a head (traffic.js). At the range you actually meet one,
 * standing at the door of a cruiser with a gun out, that reads as a bollard.
 *
 * No downloaded model. Every part here is a Sphere/Box/Cylinder/Cone, so every
 * part arrives with real UVs (CLAUDE.md rule 4) and merges cleanly. Colour is
 * a per-vertex attribute rather than a material per part, which is what keeps
 * a whole officer down to SEVEN meshes: head, cap, torso, two arms, two legs.
 * Geometry and materials are built once and shared by every officer alive --
 * only the Mesh wrappers are per-officer, because only the transforms differ.
 *
 * The face is geometry, not a texture. A face painted on a sphere depends on
 * getting the spherical UV seam right, and it is the kind of thing that looks
 * fine in the atlas and lands on the back of the head in the game. Brow, nose,
 * eyes and mouth as small merged solids cannot be mis-oriented: they sit where
 * they are put, and they catch the same light as the rest of the scene.
 *
 * Officers face +X, like every other character and vehicle in this project.
 */

// --- proportions, metres. HIP and SHOULDER match world/figure.js so an
// --- officer standing next to a crowd figure is the same size as one.
const HIP = 0.86, SHOULDER = 1.30, NECK = 1.42;
const THIGH = 0.44, SHIN = 0.42, UPPER_ARM = 0.29, FOREARM = 0.27;

const C = {
  navy:   0x1b2a4a,   // shirt
  dark:   0x14161c,   // vest, belt, boots, holster
  cap:    0x161f36,
  skin:   0xd7a878,
  badge:  0xc9a227,
  eye:    0x14141a,
  mouth:  0x7a4640,
  hi:     0x2f7fd0,   // the blue flash on the vest
};

/** Add a flat colour attribute so parts can merge into one vertex-coloured mesh. */
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
const cyl = (rt, rb, h, hex, seg = 8) => tint(new THREE.CylinderGeometry(rt, rb, h, seg), hex);
const ball = (r, hex, seg = 10) => tint(new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)), hex);
const cone = (r, h, hex, seg = 6) => tint(new THREE.ConeGeometry(r, h, seg), hex);

/* ---------------------------------------------------------------- the parts
   Every limb's geometry is authored around its JOINT, not its centre, so the
   pose function can rotate the mesh directly and get an anatomically sane
   swing. Arms hang down from the shoulder, legs down from the hip, the head
   sits on the neck. */

/** Head: skull, jaw, brow, nose, eyes, mouth, ears. Origin at the neck. */
function headGeo() {
  const p = [];
  p.push(at(ball(0.105, C.skin, 12), 0, 0.115, 0));                  // skull
  p.push(at(box(0.15, 0.075, 0.14, C.skin), 0.012, 0.055, 0));       // jaw
  p.push(at(cyl(0.045, 0.05, 0.06, C.skin, 6), 0, 0.015, 0));        // neck
  p.push(at(box(0.028, 0.02, 0.115, C.skin), 0.082, 0.145, 0));      // brow ridge
  p.push(at(cone(0.022, 0.055, C.skin, 5), 0.093, 0.108, 0, 0, 0, -Math.PI / 2)); // nose
  for (const s of [-1, 1]) {
    p.push(at(ball(0.017, C.eye, 6), 0.082, 0.128, s * 0.035));      // eye
    p.push(at(box(0.02, 0.055, 0.012, C.skin), 0.02, 0.10, s * 0.104)); // ear
  }
  p.push(at(box(0.012, 0.012, 0.048, C.mouth), 0.079, 0.062, 0));    // mouth
  return mergeGeometries(p, false);
}

/** Peaked cap, separate mesh so a knocked-off cap is a one-liner later. */
function capGeo() {
  const p = [];
  p.push(at(cyl(0.108, 0.116, 0.055, C.cap, 12), 0, 0.205, 0));      // crown
  p.push(at(box(0.10, 0.014, 0.20, C.cap), 0.085, 0.183, 0, 0, 0, 0.12)); // peak
  p.push(at(cyl(0.117, 0.117, 0.016, C.dark, 12), 0, 0.178, 0));     // band
  p.push(at(box(0.016, 0.022, 0.02, C.badge), 0.106, 0.202, 0));     // cap badge
  return mergeGeometries(p, false);
}

/** Torso: shirt, stab vest, duty belt, badge, shoulder radio. Origin at hip. */
function torsoGeo() {
  const p = [];
  p.push(at(box(0.20, 0.42, 0.34, C.navy), 0, 0.28, 0));             // shirt
  p.push(at(box(0.225, 0.30, 0.365, C.dark), 0, 0.30, 0));           // stab vest
  p.push(at(box(0.02, 0.055, 0.10, C.hi), 0.115, 0.30, 0));          // vest flash
  p.push(at(box(0.014, 0.03, 0.026, C.badge), 0.116, 0.375, 0.085)); // chest badge
  p.push(at(box(0.23, 0.055, 0.36, C.dark), 0, 0.045, 0));           // duty belt
  p.push(at(box(0.05, 0.09, 0.05, C.dark), 0.02, 0.02, 0.175));      // holster
  p.push(at(box(0.045, 0.075, 0.035, C.dark), -0.09, 0.40, 0.12));   // shoulder radio
  p.push(at(cyl(0.006, 0.006, 0.10, C.dark, 4), -0.09, 0.47, 0.12)); // aerial
  for (const s of [-1, 1]) p.push(at(cyl(0.055, 0.06, 0.07, C.navy, 8), 0, 0.44, s * 0.185)); // shoulders
  return mergeGeometries(p, false);
}

/** Arm hanging from the shoulder: sleeve, forearm, glove. Origin at shoulder. */
function armGeo() {
  const p = [];
  p.push(at(cyl(0.052, 0.045, UPPER_ARM, C.navy), 0, -UPPER_ARM / 2, 0));
  p.push(at(cyl(0.045, 0.042, FOREARM, C.skin), 0, -UPPER_ARM - FOREARM / 2, 0));
  p.push(at(box(0.055, 0.02, 0.05, C.navy), 0, -UPPER_ARM + 0.01, 0));            // cuff
  p.push(at(ball(0.045, C.dark, 6), 0, -UPPER_ARM - FOREARM - 0.02, 0));          // glove
  return mergeGeometries(p, false);
}

/** Leg hanging from the hip: trouser, boot. Origin at hip. */
function legGeo() {
  const p = [];
  p.push(at(cyl(0.07, 0.058, THIGH, C.navy), 0, -THIGH / 2, 0));
  p.push(at(cyl(0.058, 0.05, SHIN, C.navy), 0, -THIGH - SHIN / 2, 0));
  p.push(at(box(0.09, 0.075, 0.20, C.dark), 0.03, -THIGH - SHIN - 0.03, 0));      // boot
  return mergeGeometries(p, false);
}

/* ------------------------------------------------------------------ sharing
   One set of geometry and one material for every officer in the city. Built on
   first use so importing this module costs nothing at boot. */
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.06 }),
    head: headGeo(), cap: capGeo(), torso: torsoGeo(), arm: armGeo(), leg: legGeo(),
  };
  for (const k of ['head', 'cap', 'torso', 'arm', 'leg']) SHARED[k].computeBoundingSphere();
  return SHARED;
}

/** The one material every officer draws with, for the boot pipeline warm-up. */
export function officerMaterial() { return shared().mat; }

/** Free the shared geometry. Only for teardown -- it is shared by every officer. */
export function disposeOfficers() {
  if (!SHARED) return;
  for (const k of ['head', 'cap', 'torso', 'arm', 'leg']) SHARED[k].dispose();
  SHARED.mat.dispose();
  SHARED = null;
}

/**
 * One officer. Returns the group to add to the scene plus the joints to pose.
 * Seven meshes; geometry and material shared with every other officer.
 */
export function buildOfficer() {
  const s = shared();
  const group = new THREE.Group();
  const mk = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, s.mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const head = mk(s.head, 0, NECK, 0);
  const cap = mk(s.cap, 0, NECK, 0);
  const torso = mk(s.torso, 0, HIP, 0);
  const armL = mk(s.arm, 0, SHOULDER, -0.20);
  const armR = mk(s.arm, 0, SHOULDER, 0.20);
  const legL = mk(s.leg, 0, HIP, -0.09);
  const legR = mk(s.leg, 0, HIP, 0.09);
  const joints = { head, cap, torso, armL, armR, legL, legR };
  poseOfficer(joints, 'idle', 0);
  return { group, joints };
}

/**
 * Pose the joints. No skinning and no clips -- five states covering everything
 * a police officer in this game actually does, driven by one phase number.
 *
 *   idle  hands at the belt, slight sway
 *   aim   both arms forward and level, weapon hand leading
 *   walk  opposed arm/leg swing, phase is the stride
 *   cuff  one arm reaching down and forward
 *   fall  collapsed: legs folded, arms out, torso and head down
 */
export function poseOfficer(j, pose, phase = 0) {
  const { head, cap, torso, armL, armR, legL, legR } = j;
  // reset the two that most poses leave alone
  torso.rotation.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  cap.rotation.set(0, 0, 0);
  torso.position.y = HIP;

  if (pose === 'walk') {
    const s = Math.sin(phase), c = Math.cos(phase * 2);
    legL.rotation.z = s * 0.62;
    legR.rotation.z = -s * 0.62;
    armL.rotation.z = -s * 0.48;
    armR.rotation.z = s * 0.48;
    armL.rotation.x = 0.12; armR.rotation.x = -0.12;
    torso.rotation.z = -0.05 + c * 0.02;
    head.rotation.z = 0.04;
    cap.rotation.z = 0.04;
    return;
  }

  if (pose === 'aim') {
    /* Both hands to the weapon: the right arm comes up to level and forward,
       the left crosses in to support it, and the head tips down the sights. */
    armR.rotation.set(0, 0, -Math.PI / 2 + 0.06);
    armL.rotation.set(-0.55, 0, -Math.PI / 2 + 0.30);
    legL.rotation.z = 0.16; legR.rotation.z = -0.20;   // braced stance
    torso.rotation.y = -0.18;
    head.rotation.z = -0.10; cap.rotation.z = -0.10;
    return;
  }

  if (pose === 'crouch' || pose === 'peek') {
    /* Behind the cruiser door: knees bent, body dropped ~0.42 m, weapon arm
       up. 'peek' is the same crouch leaning out to the right to fire; the AI
       flips between them so the officer is exposed only while shooting. */
    const lean = pose === 'peek' ? 0.26 : 0;
    legL.rotation.z = 1.15; legR.rotation.z = 1.05;
    torso.position.y = HIP - 0.42;
    torso.rotation.set(0, -0.10 - lean * 0.6, -0.18);
    armR.rotation.set(0, 0, -Math.PI / 2 + 0.10);
    armL.rotation.set(-0.5, 0, -Math.PI / 2 + 0.34);
    head.rotation.set(0, -lean * 0.5, -0.06); cap.rotation.copy(head.rotation);
    return;
  }

  if (pose === 'cuff') {
    armR.rotation.set(0, 0, -1.15);
    armL.rotation.set(0, 0, -0.85);
    torso.rotation.z = -0.34;                          // bent over the arrest
    head.rotation.z = -0.24; cap.rotation.z = -0.24;
    legL.rotation.z = 0.26; legR.rotation.z = -0.10;
    return;
  }

  if (pose === 'fall') {
    const k = Math.min(1, phase);                      // 0 standing -> 1 down
    torso.rotation.z = -k * (Math.PI / 2 - 0.12);
    torso.position.y = HIP - k * 0.62;
    head.rotation.z = -k * 0.5; cap.rotation.z = -k * 0.5;
    armL.rotation.z = -k * 1.5; armR.rotation.z = k * 1.2;
    legL.rotation.z = k * 1.25; legR.rotation.z = k * 0.95;
    return;
  }

  // idle: weight on one hip, hands resting near the belt, a slow breathing sway
  const sway = Math.sin(phase * 0.8) * 0.03;
  armL.rotation.set(0.10, 0, -0.30 + sway);
  armR.rotation.set(-0.10, 0, 0.30 - sway);
  legL.rotation.z = 0.04; legR.rotation.z = -0.02;
  torso.rotation.z = -0.02 + sway * 0.5;
  head.rotation.y = sway * 2.5;
  cap.rotation.y = sway * 2.5;
}

export const OFFICER_HEIGHT = NECK + 0.24;
export const OFFICER_PARTS = 7;
