import * as THREE from 'three';
import { M4, mergeGeos } from '../core/geometry.js';

/**
 * People with joints.
 *
 * The first crowd was a single welded mesh per person: no elbows, no knees,
 * nothing that moved except a vertical bob. They read as skittles.
 *
 * The problem with fixing that is cost. Articulating a figure normally means
 * one draw call per limb per person, and there are 96 of them. So instead of
 * an InstancedMesh per PERSON, there is an InstancedMesh per BODY PART: every
 * left thigh in the city lives in one mesh, every head in another. Six draw
 * calls buys ninety-six independently animated people, because the per-limb
 * transform is just another instance matrix.
 *
 * Poses are computed here, not authored. A walk cycle is cheap trigonometry
 * and it beats a static mesh at any polygon count.
 */

export const PARTS = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];

/* Limb origins in body space: each part rotates about its own joint, so the
   geometry is built with the joint at the origin and the mass hanging off it. */
const HIP = 0.86, SHOULDER = 1.30, HEAD_Y = 1.52;
/* The leg part hangs from the hip at HIP, and its foot box bottoms out 0.745
   below that -- so a body origin at y=0 leaves the sole at HIP-0.745, floating
   11.5 cm. Add this to the body origin to put the sole on the ground. It is
   NEGATIVE; adding the positive value doubles the float, which is what my
   first attempt did. */
export const FOOT_DROP = 0.745 - HIP;

export function buildParts() {
  const torso = mergeGeos([
    boxAt(0.30, 0.52, 0.20, 0, 1.12, 0),          // chest and belly
    boxAt(0.34, 0.14, 0.22, 0, 1.34, 0),          // shoulders
    boxAt(0.26, 0.14, 0.20, 0, 0.86, 0),          // hips
  ]);
  const head = mergeGeos([
    sphereAt(0.115, 0, 0.10, 0),
    boxAt(0.09, 0.10, 0.09, 0, -0.02, 0),         // neck
  ]);
  const arm = mergeGeos([
    boxAt(0.085, 0.28, 0.085, 0, -0.15, 0),       // upper
    boxAt(0.075, 0.28, 0.075, 0, -0.44, 0),       // fore
    sphereAt(0.055, 0, -0.60, 0),                 // hand
  ]);
  const leg = mergeGeos([
    boxAt(0.115, 0.34, 0.115, 0, -0.18, 0),       // thigh
    boxAt(0.10, 0.34, 0.10, 0, -0.53, 0),         // shin
    boxAt(0.11, 0.07, 0.22, 0, -0.71, 0.045),     // foot
  ]);
  return { torso, head, armL: arm, armR: arm.clone(), legL: leg, legR: leg.clone() };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _body = new THREE.Matrix4();
const _local = new THREE.Matrix4();

/**
 * Write one person's six part-matrices into `out`.
 *
 * `state`: 0 idle, 1 walking, 2 running, 3 down. `phase` advances with the
 * distance walked, so the feet do not skate when the speed changes.
 */
export function poseInto(out, x, y, z, yaw, phase, state, scale = 1) {
  const run = state === 2;
  const moving = state === 1 || state === 2;
  const swing = run ? 1.15 : 0.72;
  const sw = moving ? Math.sin(phase) * swing : 0;
  const sw2 = moving ? Math.sin(phase + Math.PI) * swing : 0;
  // idle still breathes; a perfectly still figure looks switched off
  const breathe = moving ? 0 : Math.sin(phase * 0.6) * 0.02;
  const bounce = moving ? Math.abs(Math.sin(phase)) * (run ? 0.075 : 0.035) : breathe;
  const lean = run ? 0.22 : moving ? 0.07 : 0;

  if (state === 3) {
    /* Face down. This used to copy ONE matrix into all six parts, which put
       every limb at the same point -- a run-over pedestrian was a heap of
       overlapping clusters, not a body. The parts still need their own
       offsets; only the root rotation changes. */
    _e.set(Math.PI / 2, -yaw + Math.PI / 2, 0);
    _body.compose(_v.set(x, y + 0.22, z), _q.setFromEuler(_e), _s.set(scale, scale, scale));
    set(out[0], _body, 0, 0, 0, 0, 0, 0);                     // torso
    set(out[1], _body, 0, HEAD_Y - 0.10, 0, 0, 0, 0.25);      // head, lolled
    set(out[2], _body, 0, SHOULDER, 0.19, 0, 0, 0.9);         // arms flung out
    set(out[3], _body, 0, SHOULDER, -0.19, 0, 0, -0.9);
    set(out[4], _body, 0, HIP, 0.10, 0, 0, 0.25);             // legs splayed
    set(out[5], _body, 0, HIP, -0.10, 0, 0, -0.25);
    return;
  }

  _e.set(0, -yaw + Math.PI / 2, 0);
  _body.compose(_v.set(x, y + bounce, z), _q.setFromEuler(_e), _s.set(scale, scale, scale));

  // torso: leans into the run, counter-rotates against the arms
  set(out[0], _body, 0, 0, 0, lean, Math.sin(phase) * (moving ? 0.09 : 0), 0);
  set(out[1], _body, 0, HEAD_Y - 0.10, 0, -lean * 0.5, Math.sin(phase) * 0.05, 0);
  // arms swing opposite the legs, elbows carried higher at a run
  set(out[2], _body, 0, SHOULDER, 0.19, sw2 * 0.9 - (run ? 0.5 : 0), 0, 0.06);
  set(out[3], _body, 0, SHOULDER, -0.19, sw * 0.9 - (run ? 0.5 : 0), 0, -0.06);
  set(out[4], _body, 0, HIP, 0.10, sw, 0, 0);
  set(out[5], _body, 0, HIP, -0.10, sw2, 0, 0);
}

function set(target, body, x, y, z, rx, ry, rz) {
  _e.set(rx, ry, rz);
  _local.compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
  target.multiplyMatrices(body, _local);
}

function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(M4(x, y, z));
  return g;
}
function sphereAt(r, x, y, z) {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.applyMatrix4(M4(x, y, z));
  return g;
}

/**
 * A crowd of `count` articulated figures drawn in six instanced meshes.
 * Callers fill `people` and call `write()` each frame.
 */
export class FigureFleet {
  constructor(scene, count, opts = {}) {
    const parts = buildParts();
    const skin = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const cloth = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.meshes = PARTS.map((k) => {
      const m = new THREE.InstancedMesh(parts[k], k === 'head' ? skin.clone() : cloth.clone(), count);
      m.frustumCulled = false;
      m.castShadow = !!opts.shadows;
      scene.add(m);
      return m;
    });
    this.count = count;
    this.scratch = PARTS.map(() => new THREE.Matrix4());
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  /** Per-person colours: `wear` tints everything but the head, `skin` the head. */
  colour(i, wear, skinHex) {
    const c = _colour;
    for (let k = 0; k < this.meshes.length; k++) {
      this.meshes[k].setColorAt(i, c.setHex(PARTS[k] === 'head' ? skinHex : wear));
    }
  }

  write(i, x, y, z, yaw, phase, state, scale) {
    poseInto(this.scratch, x, y, z, yaw, phase, state, scale);
    for (let k = 0; k < this.meshes.length; k++) this.meshes[k].setMatrixAt(i, this.scratch[k]);
  }

  hide(i) {
    for (const m of this.meshes) m.setMatrixAt(i, this.hidden);
  }

  flush(colours = false) {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (colours && m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

const _colour = new THREE.Color();
