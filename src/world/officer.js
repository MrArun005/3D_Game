import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { headPieces, skullCover, weldNormals, _internals as FIG } from './figure.js';

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

/* Shaped parts (2026-09-23): the officer is built from the same kit as the
   crowd (world/figure.js) -- the sculpted skull with its face and a cropped
   hairline, lathed torso and vest, tapered limbs, shaped boots -- so an officer
   stepping out of a cruiser beside a pedestrian is the same kind of person.
   The seven-mesh contract, the joint origins and the vertex colours are the
   old ones: poseOfficer() below did not change. */
const HEAD_UP = 0.12;                                 // skull centre above the neck joint
const toHead = (geo) => geo.translate(0, HEAD_UP - FIG.J.headY, 0);
const up = (fy) => (fy - FIG.J.hipY) * 0.88;          // figure torso heights -> officer torso space (hip at 0)

/** A lathed section [[r, y], ...] squashed front-back (x) by `depth`. */
function lathe(profile, hex, seg = 8, depth = 1) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), seg);
  g.scale(depth, 1, 1);
  return tint(weldNormals(g), hex);
}
/** A tapered limb between two heights, open at both ends (they sit inside a joint). */
function limb(rTop, rBot, yTop, yBot, hex, seg = 10) {
  const g = new THREE.CylinderGeometry(rTop, rBot, yTop - yBot, seg, 1, true);
  g.translate(0, (yTop + yBot) / 2, 0);
  return tint(weldNormals(g), hex);
}
function ovoid(r, x, y, z, sx, sy, sz, hex, seg = 8) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(3, Math.round(seg * 0.6)));
  g.scale(sx, sy, sz); g.translate(x, y, z);
  return tint(weldNormals(g), hex);
}

/** Head: the crowd's sculpted skull, face and a cropped cut, and a neck. Origin at the neck. */
function headGeo() {
  const colour = { [FIG.R.skin]: C.skin, [FIG.R.eye]: C.eye, [FIG.R.brow]: 0x2a1d16, [FIG.R.lip]: C.mouth, [FIG.R.hair]: 0x231812 };
  const p = headPieces({ seg: 9, rings: 7, hair: 'cropped', featureSeg: 4 }).map(({ geo, region }) => tint(toHead(geo), colour[region]));
  p.push(limb(0.047, 0.054, 0.07, -0.09, C.skin, 8));                // neck, down into the collar
  return mergeGeometries(p, false);
}

/** Peaked service cap: a band that hugs the skull, a flat crown flaring over it, the peak, the badge. */
function capGeo() {
  const p = [];
  p.push(tint(toHead(skullCover(10, 7, [1.12, 1.06, 1.14], [-0.004, 0.006], (c, uy) => uy > 0.30 + 0.08 * c)), C.dark));   // band
  const crown = new THREE.CylinderGeometry(0.128, 0.112, 0.05, 12, 1);
  crown.scale(1.12, 1, 1); crown.rotateZ(-0.06); crown.translate(-0.005, HEAD_UP + 0.098, 0);
  p.push(tint(weldNormals(crown), C.cap));
  const peak = new THREE.CylinderGeometry(0.082, 0.082, 0.008, 8, 1, false, 0, Math.PI);   // a half disc on +X
  peak.scale(0.95, 1, 1.05); peak.rotateZ(-0.34); peak.translate(0.072, HEAD_UP + 0.036, 0);
  p.push(tint(peak, 0x0a0a0c));
  p.push(at(box(0.014, 0.024, 0.022, C.badge), 0.118, HEAD_UP + 0.085, 0));
  return mergeGeometries(p, false);
}

/** Torso: trouser seat, shirt, stab vest with its blue flash, duty belt, badge, radio, holster. Origin at hip. */
function torsoGeo() {
  const p = [];
  p.push(lathe([[0.001, up(0.80)], [0.135, up(0.82)], [0.160, up(0.88)], [0.168, up(0.95)], [0.158, up(1.00)], [0.150, up(1.04)]], C.navy, 8, 0.70));
  p.push(lathe([[0.150, up(1.02)], [0.158, up(1.10)], [0.175, up(1.22)], [0.186, up(1.32)], [0.185, up(1.40)], [0.150, up(1.46)], [0.075, up(1.50)], [0.001, up(1.505)]], C.navy, 8, 0.64));
  p.push(lathe([[0.166, up(1.06)], [0.176, up(1.10)], [0.193, up(1.22)], [0.203, up(1.32)], [0.199, up(1.40)], [0.160, up(1.445)]], C.dark, 8, 0.68));   // vest
  p.push(lathe([[0.160, up(0.99)], [0.166, up(1.00)], [0.166, up(1.055)], [0.160, up(1.065)]], C.dark, 8, 0.74));                            // belt
  p.push(at(box(0.012, 0.05, 0.13, C.hi), 0.136, up(1.34), 0));                          // vest flash
  p.push(at(box(0.012, 0.03, 0.026, C.badge), 0.134, up(1.25), 0.075));                  // chest badge
  p.push(at(box(0.045, 0.075, 0.035, C.dark), 0.02, up(1.40), 0.13));                   // shoulder radio
  p.push(at(cyl(0.006, 0.006, 0.10, C.dark, 4), 0.02, up(1.40) + 0.08, 0.13));           // aerial
  p.push(at(box(0.07, 0.11, 0.05, C.dark), 0.03, up(0.97), 0.175));                      // holster
  p.push(at(box(0.05, 0.06, 0.04, C.dark), 0.10, up(1.02), -0.12));                      // cuff pouch
  return mergeGeometries(p, false);
}

/** Arm hanging from the shoulder: short sleeve, bare forearm, glove. Origin at shoulder. */
function armGeo() {
  const p = [];
  p.push(ovoid(0.052, 0, -0.005, 0, 1, 0.95, 1, C.navy, 6));                            // shoulder cap
  p.push(limb(0.053, 0.047, 0, -UPPER_ARM * 0.62, C.navy));                               // short sleeve, a touch proud of the arm
  p.push(limb(0.044, 0.040, -UPPER_ARM * 0.60, -UPPER_ARM, C.skin));
  p.push(limb(0.041, 0.033, -UPPER_ARM, -UPPER_ARM - FOREARM, C.skin));
  p.push(ovoid(0.040, 0.004, -UPPER_ARM - FOREARM - 0.055, 0, 0.62, 1.15, 0.95, C.dark, 6));   // glove
  return mergeGeometries(p, false);
}

/** A boot: rounded toe box forward (+X), flat sole at `sole`, ankle collar. */
function boot(sole, hex, big = 1) {
  const g = new THREE.SphereGeometry(0.052 * big, 8, 5);
  g.scale(2.2, 1.0, 1.05); g.translate(0.05, sole + 0.052, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < sole + 0.014) pos.setY(i, sole);   // flat sole
  return [tint(weldNormals(g), hex), limb(0.050 * big, 0.056 * big, sole + 0.14, sole + 0.05, hex, 10)];
}

const SOLE = -THIGH - SHIN - 0.0675;                  // where the old boot's sole sat: officers stand where they stood

/** Leg hanging from the hip: trouser, boot. Origin at hip. */
function legGeo() {
  const p = [];
  p.push(limb(0.086, 0.062, 0.02, -THIGH, C.navy));
  p.push(limb(0.062, 0.047, -THIGH, SOLE + 0.12, C.navy));
  p.push(...boot(SOLE, C.dark));
  return mergeGeometries(p, false);
}

/* ------------------------------------------------------------ SWAT variant
   Four stars and up: the tactical unit. Same head, same seven-mesh contract,
   same shared material -- only the geometry differs, so it costs one extra
   geometry set for the whole city and zero pipeline variants. Black helmet
   with a visor band, black plate carrier with a white POLICE strip, long
   dark sleeves and gloves (no skin forearms), knee pads. */
const S = { black: 0x0e0f12, plate: 0x181a1f, drab: 0x23262c, strip: 0xe9ecf2, visor: 0x2a3140 };

function helmetGeo() {
  const p = [];
  p.push(tint(toHead(skullCover(10, 7, [1.2, 1.14, 1.22], [-0.01, 0.012], (c, uy) => uy > 0.18 + 0.2 * c)), S.black));   // shell, low at the back
  p.push(at(box(0.05, 0.045, 0.19, S.visor), 0.10, HEAD_UP + 0.075, 0));                  // visor band, up
  p.push(at(box(0.20, 0.02, 0.05, S.black), 0.0, HEAD_UP + 0.14, 0));                    // rail
  p.push(at(box(0.012, 0.09, 0.02, S.black), -0.02, HEAD_UP - 0.05, 0.095));             // chin strap tab
  return mergeGeometries(p, false);
}
function swatTorsoGeo() {
  const p = [];
  p.push(lathe([[0.001, up(0.80)], [0.135, up(0.82)], [0.160, up(0.88)], [0.168, up(0.95)], [0.158, up(1.00)], [0.150, up(1.04)]], S.drab, 8, 0.70));
  p.push(lathe([[0.150, up(1.02)], [0.158, up(1.10)], [0.175, up(1.22)], [0.186, up(1.32)], [0.185, up(1.40)], [0.150, up(1.46)], [0.075, up(1.50)], [0.001, up(1.505)]], S.drab, 8, 0.64));
  p.push(at(box(0.07, 0.34, 0.33, S.plate), 0.085, up(1.25), 0));                        // front plate
  p.push(at(box(0.07, 0.34, 0.33, S.plate), -0.085, up(1.25), 0));                       // back plate
  p.push(at(box(0.012, 0.045, 0.19, S.strip), 0.123, up(1.36), 0));                      // POLICE strip, front
  p.push(at(box(0.012, 0.045, 0.19, S.strip), -0.123, up(1.36), 0));                     // and back
  for (const z of [-0.09, 0, 0.09]) p.push(at(box(0.045, 0.09, 0.07, S.black), 0.135, up(1.14), z));   // mag pouches
  p.push(lathe([[0.160, up(0.99)], [0.166, up(1.00)], [0.166, up(1.055)], [0.160, up(1.065)]], S.black, 8, 0.74));
  p.push(at(box(0.07, 0.12, 0.05, S.black), 0.03, up(0.97), 0.175));                     // holster
  p.push(at(box(0.045, 0.075, 0.035, S.black), 0.02, up(1.40), 0.13));                   // radio
  return mergeGeometries(p, false);
}
function swatArmGeo() {
  const p = [];
  p.push(ovoid(0.055, 0, -0.005, 0, 1, 0.95, 1, S.drab, 6));
  p.push(limb(0.054, 0.046, 0, -UPPER_ARM, S.drab));
  p.push(limb(0.046, 0.038, -UPPER_ARM, -UPPER_ARM - FOREARM, S.drab));                  // long sleeve
  p.push(ovoid(0.045, 0.012, -UPPER_ARM, 0, 1, 1.1, 1.05, S.black, 6));                  // elbow pad
  p.push(ovoid(0.042, 0.004, -UPPER_ARM - FOREARM - 0.055, 0, 0.62, 1.15, 0.95, S.black, 6));   // glove
  return mergeGeometries(p, false);
}
function swatLegGeo() {
  const p = [];
  p.push(limb(0.088, 0.064, 0.02, -THIGH, S.drab));
  p.push(limb(0.064, 0.050, -THIGH, SOLE + 0.12, S.drab));
  p.push(ovoid(0.058, 0.035, -THIGH, 0, 0.8, 1.15, 1.05, S.black, 6));                  // knee pad
  p.push(...boot(SOLE, S.black, 1.05));
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
    moustache: box(0.012, 0.012, 0.05, 0x2a1d16),
    swat: { cap: helmetGeo(), torso: swatTorsoGeo(), arm: swatArmGeo(), leg: swatLegGeo() },
  };
  for (const k of ['head', 'cap', 'torso', 'arm', 'leg']) SHARED[k].computeBoundingSphere();
  for (const k of ['cap', 'torso', 'arm', 'leg']) SHARED.swat[k].computeBoundingSphere();
  return SHARED;
}

/** The one material every officer draws with, for the boot pipeline warm-up. */
export function officerMaterial() { return shared().mat; }

/** Free the shared geometry. Only for teardown -- it is shared by every officer. */
export function disposeOfficers() {
  if (!SHARED) return;
  for (const k of ['head', 'cap', 'torso', 'arm', 'leg', 'moustache']) SHARED[k].dispose();
  for (const k of ['cap', 'torso', 'arm', 'leg']) SHARED.swat[k].dispose();
  SHARED.mat.dispose();
  SHARED = null;
}

/**
 * One officer. Returns the group to add to the scene plus the joints to pose.
 * Seven meshes; geometry and material shared with every other officer.
 */
export function buildOfficer(seed = 1, { swat = false } = {}) {
  const s = shared();
  const group = new THREE.Group();
  /* Seeded variety, so officer #3 is the same person every load (CLAUDE.md:
     seeded randomness only). Height and build are a scale on the group; the
     cap is hidden for one in five; one in four grows a moustache, which is a
     tiny eighth mesh. Skin tone is NOT varied: colour is baked per vertex into
     geometry shared by every officer, and a per-officer material would cost a
     pipeline variant each -- a trade not worth six faces. */
  const rnd = mulberry32(0x9e3779b1 ^ (seed * 2654435761 >>> 0));
  const variety = {
    height: 0.94 + rnd() * 0.12,
    build: 0.92 + rnd() * 0.16,
    cap: rnd() > 0.2,
    moustache: rnd() < 0.25,
  };
  group.scale.set(variety.build, variety.height, variety.build);
  const mk = (geo, x, y, z, shadow = true, parent = group) => {
    const m = new THREE.Mesh(geo, s.mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;   // torso and legs only: the rest is noise in the map and a shadow draw each
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /* The upper body HANGS FROM THE TORSO (2026-09-23). All seven used to hang
     off the group, so a crouch dropped the torso 0.42 m while the head, cap and
     arms stayed at standing height, floating over it -- and a fall laid the
     torso down under a standing head. Now they ride the torso's drop, lean and
     twist; the aiming poses hold the gun arm and the head against the torso's
     rotation (holdAgainstTorso) so the weapon still points where it did. */
  const torso = mk(s.torso, 0, HIP, 0);
  const head = mk(s.head, 0, NECK - HIP, 0, false, torso);
  const cap = mk(s.cap, 0, NECK - HIP, 0, false, torso);
  const armL = mk(s.arm, 0, SHOULDER - HIP, -0.20, false, torso);
  const armR = mk(s.arm, 0, SHOULDER - HIP, 0.20, false, torso);
  const legL = mk(s.leg, 0, HIP, -0.09);
  const legR = mk(s.leg, 0, HIP, 0.09);
  cap.visible = variety.cap;
  if (variety.moustache) {
    const m = new THREE.Mesh(s.moustache, s.mat);
    m.position.set(0.086, 0.078, 0);   // under the nose, in head space
    head.add(m);
  }
  const joints = { head, cap, torso, armL, armR, legL, legR };
  if (swat) dressOfficer(joints, true);
  poseOfficer(joints, 'idle', 0);
  return { group, joints, variety };
}

/**
 * Swap an existing officer between patrol dress and SWAT: geometry only, so
 * a cruiser built at one star fields a tactical officer at four. The helmet
 * always shows (variety.cap hid the peaked cap for one in five).
 */
export function dressOfficer(joints, swat) {
  const s = shared(), src = swat ? s.swat : s;
  joints.cap.geometry = src.cap; joints.torso.geometry = src.torso;
  joints.armL.geometry = src.arm; joints.armR.geometry = src.arm;
  joints.legL.geometry = src.leg; joints.legR.geometry = src.leg;
  if (swat) joints.cap.visible = true;
  joints.swat = swat;
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
const _qT = new THREE.Quaternion(), _qD = new THREE.Quaternion(), _eD = new THREE.Euler();
/** Hold a joint that hangs from the torso at a rotation in the OFFICER's frame: local = torso^-1 * wanted. */
function holdAgainstTorso(torso, joint, x, y, z) {
  _qT.setFromEuler(torso.rotation).invert();
  _qD.setFromEuler(_eD.set(x, y, z));
  joint.quaternion.copy(_qT.multiply(_qD));
}

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
    torso.rotation.y = -0.18;
    holdAgainstTorso(torso, armR, 0, 0, -Math.PI / 2 + 0.06);
    holdAgainstTorso(torso, armL, -0.55, 0, -Math.PI / 2 + 0.30);
    legL.rotation.z = 0.16; legR.rotation.z = -0.20;   // braced stance
    holdAgainstTorso(torso, head, 0, 0, -0.10); cap.rotation.copy(head.rotation);
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
    holdAgainstTorso(torso, armR, 0, 0, -Math.PI / 2 + 0.10);
    holdAgainstTorso(torso, armL, -0.5, 0, -Math.PI / 2 + 0.34);
    holdAgainstTorso(torso, head, 0, -lean * 0.5, -0.06); cap.rotation.copy(head.rotation);
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

/* ------------------------------------------------------------ pose blending
   poseOfficer() snaps the joints to a pose. Raise-to-aim and drop-to-cover
   should be motions: the blender remembers where each joint was and eases it
   toward the new pose over `blendS` seconds. Scratch is per-blender and
   reused, so blending allocates nothing per frame. */
const JOINTS = ['head', 'cap', 'torso', 'armL', 'armR', 'legL', 'legR'];
export class PoseBlender {
  constructor() {
    this.prev = {};   // joint -> [rx, ry, rz, py]
    for (const j of JOINTS) this.prev[j] = [0, 0, 0, HIP];
    this.warm = false;
  }
  /** Pose the joints toward `pose`, easing from the last applied state. */
  apply(joints, pose, phase, dt, blendS = 0.22) {
    poseOfficer(joints, pose, phase);              // target
    const k = this.warm ? Math.min(1, dt / Math.max(1e-3, blendS)) : 1;
    for (const j of JOINTS) {
      const o = joints[j], p = this.prev[j];
      const tx = o.rotation.x, ty = o.rotation.y, tz = o.rotation.z, tp = o.position.y;
      o.rotation.set(p[0] + (tx - p[0]) * k, p[1] + (ty - p[1]) * k, p[2] + (tz - p[2]) * k);
      if (j === 'torso') o.position.y = p[3] + (tp - p[3]) * k;
      p[0] = o.rotation.x; p[1] = o.rotation.y; p[2] = o.rotation.z; p[3] = o.position.y;
    }
    this.warm = true;
  }
}

/**
 * Turn the head (and cap) toward a target: `yawLocal` is the target bearing in
 * the officer's own frame, radians, 0 = straight ahead. Clamped so the neck
 * cannot do more than a real one. Applied AFTER posing, so it rides on top.
 */
export function lookAt(joints, yawLocal, max = 0.8) {
  const y = Math.max(-max, Math.min(max, yawLocal));
  joints.head.rotation.y += y;
  joints.cap.rotation.y += y;
}
