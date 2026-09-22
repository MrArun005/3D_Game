import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { OFFICER_HEIGHT, officerMaterial } from './officer.js';

/**
 * The officer you meet at the cruiser door, on the hero's rig.
 *
 * `world/officer.js` is seven merged primitives on a hand-written pose blender.
 * At forty metres that is right; at four metres, next to a skinned player
 * character with real clips, it reads as a toy. This is the same officer built
 * on the Quaternius rig the hero uses -- one SkinnedMesh set, an AnimationMixer
 * and the pack's own Idle / Walk / Run / Death clips -- with the uniform added
 * as primitive kit parented to the bones, not baked into a new GLB.
 *
 * WHICH MODEL. The brief named `/models/characters/navy_jacket.glb`. That file
 * has `skins: 0`, `animations: []` and ONE node (checked with a glTF JSON dump,
 * 2026-09-12): it is a static sculpt, not a rig, and neither a mixer nor a bone
 * override can be hung off it. `civilian_suit.glb` is the Quaternius rig with
 * the darkest clothing in the pack (Shirt 0.13,0.17,0.19), so it is the base
 * and its materials are re-tinted to police navy per officer.
 *
 * COST, per skinned officer, measured from the glTF (not guessed):
 *   6 SkinnedMesh draws, 1,852 triangles   (the GLB's 6 material primitives)
 * + 3 kit meshes  (cap / vest / belt), ~230 triangles, all in the shared
 *   `officerMaterial()` the primitive officers already use
 * + 1 AnimationMixer, 6 cloned materials, ~45 bones of matrix work
 * = 9 draws, ~2.1k triangles. It REPLACES a primitive officer (7 draws,
 *   ~2k triangles), so the delta per deployed officer is +2 draws, ~+250
 *   triangles and one mixer. Shadow casters: 2 (Shirt + Pants), one FEWER than
 *   the primitive officer's torso-and-two-legs, and none of the kit.
 *
 * ESCAPE HATCH: `?skinnedcops=0` keeps every officer primitive, `?skinnedcops=2`
 * halves the pool -- the A/B for the 60 fps floor, like `?lights=N`/`?people=N`.
 *
 * The pool is hard-capped (default 4) exactly as `game/people.js` caps its
 * skinned pedestrians: past the cap the caller keeps the primitive officer, so
 * MAX_DEPLOYED = 6 police on the street costs at most 4 mixers, never 6.
 *
 * Officers here face +Z (the Quaternius base human's toes run to -Y in Blender
 * space, which the armature's -90 deg X rotation puts on +Z). `world/officer.js`
 * faces +X. `sync()` therefore copies the primitive group's yaw and adds
 * MODEL_YAW; if a skinned officer ever stands sideways, that constant is the fix.
 */

export const OFFICER_MODEL = '/models/characters/civilian_suit.glb';
const MODEL = OFFICER_MODEL;
const MODEL_YAW = Math.PI / 2;          // our +Z-facing model vs the primitive officer's +X
const AIM_BLEND = 0.2;                  // seconds to bring the weapon up, and to drop it
const RUN_OVER = 2.4;                   // m/s: above this the run clip, played slower (character.js)
const WALK_CLIP_SPEED = 1.9, RUN_CLIP_SPEED = 5.2;   // what the clips are authored for
const CROUCH_DROP = 0.26;               // metres he sinks behind the cruiser door in cover

/* ------------------------------------------------------------------ pure bits
   Everything here is arithmetic with no three.js and no GPU, so the test can
   cover it. The class below is the only part that needs a device. */

/** The hero's rule (character.js): run clip above 2.4 m/s, played slow, not a sped-up walk. */
export function clipForSpeed(speed) {
  return speed > RUN_OVER ? 'run' : speed > 0.35 ? 'walk' : 'idle';
}

/** Playback rate for a clip so the feet roughly keep up with the ground speed. */
export function clipRate(speed, clip) {
  if (clip === 'idle') return 1;
  const authored = clip === 'run' ? RUN_CLIP_SPEED : WALK_CLIP_SPEED;
  return Math.max(0.55, Math.min(1.45, speed / authored));
}

/**
 * Aim from a shoulder to a target, in the officer's own frame.
 * `facingX/facingZ` is his forward on the ground plane; `yaw` comes back signed
 * about +Y (left positive), `pitch` positive when the target is above him.
 * No world-axis convention is baked in, which is why it is safe to feed it
 * `getWorldDirection()` straight out of three.
 */
export function aimAngles(ox, oy, oz, tx, ty, tz, facingX, facingZ) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const flat = Math.hypot(dx, dz) || 1e-6;
  const fl = Math.hypot(facingX, facingZ) || 1e-6;
  const fx = facingX / fl, fz = facingZ / fl;
  const ux = dx / flat, uz = dz / flat;
  // cross(facing, dir).y and dot(facing, dir): the signed turn from one to the other
  return {
    yaw: Math.atan2(fz * ux - fx * uz, fx * ux + fz * uz),
    pitch: Math.atan2(dy, flat),
    dist: Math.hypot(flat, dy),
  };
}

/** One frame of an exponential-ish ramp toward `target`, `seconds` to arrive. */
export function blendTo(cur, target, dt, seconds = AIM_BLEND) {
  if (!(seconds > 0)) return target;
  return cur + (target - cur) * Math.min(1, dt / seconds);
}

/**
 * Who holds which of the N slots. The whole point of the pool is that a mixer
 * is expensive, so the bookkeeping is the part worth testing: `take()` hands
 * out a free slot or -1, and -1 is the caller's signal to keep the primitive
 * officer it already has.
 */
export class Roster {
  constructor(n) { this.busy = new Array(Math.max(0, n | 0)).fill(false); }
  take() { const i = this.busy.indexOf(false); if (i >= 0) this.busy[i] = true; return i; }
  free(i) { if (i >= 0 && i < this.busy.length) this.busy[i] = false; }
  get out() { let n = 0; for (const b of this.busy) if (b) n++; return n; }
  get size() { return this.busy.length; }
}

/* ------------------------------------------------------------------ the kit
   Cap, vest and belt as primitives parented to Head / Torso / Hips. Authored
   facing +Z like the model, in metres, vertex-coloured into the officers'
   shared material so they add meshes and not pipelines. Dimensions are tuned
   by eye against a 1.66 m officer -- the calibration knob is right here. */
const KIT = {
  cap: { r: 0.102, crown: 0.058, peak: 0.105, band: 0.016 },
  vest: { w: 0.40, h: 0.36, d: 0.27 },
  belt: { w: 0.36, h: 0.065, d: 0.26 },
};
const C = { navy: 0x1b2a4a, dark: 0x14161c, badge: 0xc9a227, hi: 0x2f7fd0, strip: 0xe9ecf2 };

function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const at = (geo, x, y, z, rx = 0) => geo.applyMatrix4(
  new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(rx)));
const box = (w, h, d, hex) => tint(new THREE.BoxGeometry(w, h, d), hex);
const cyl = (rt, rb, h, hex, seg = 12) => tint(new THREE.CylinderGeometry(rt, rb, h, seg), hex);

function capGeo(tone) {
  const k = KIT.cap;
  return mergeGeometries([
    at(cyl(k.r, k.r + 0.008, k.crown, tone), 0, k.band / 2 + k.crown / 2, 0),
    at(cyl(k.r + 0.012, k.r + 0.012, k.band, C.dark), 0, 0, 0),
    at(box(0.19, 0.013, k.peak, C.dark), 0, 0.004, k.r * 0.72 + k.peak / 2, -0.14),
    at(box(0.018, 0.024, 0.016, C.badge), 0, k.band / 2 + 0.018, k.r + 0.002),
  ], false);
}
function vestGeo(swat) {
  const v = KIT.vest, body = swat ? 0x181a1f : C.dark;
  const p = [
    at(box(v.w, v.h, v.d, body), 0, 0, 0),
    at(box(0.10, 0.045, 0.02, swat ? C.strip : C.hi), 0, v.h * 0.18, v.d / 2),      // flash / POLICE strip
    at(box(0.10, 0.045, 0.02, swat ? C.strip : C.hi), 0, v.h * 0.18, -v.d / 2),
    at(box(0.026, 0.032, 0.014, C.badge), -0.11, v.h * 0.30, v.d / 2),              // chest badge
    at(box(0.040, 0.078, 0.036, C.dark), -0.155, v.h * 0.34, 0.09),                 // shoulder radio
    at(cyl(0.006, 0.006, 0.10, C.dark, 4), -0.155, v.h * 0.34 + 0.085, 0.09),       // aerial
  ];
  if (swat) {
    p.push(at(box(0.085, 0.09, 0.05, 0x0e0f12), 0.10, -v.h * 0.22, v.d / 2 - 0.01));   // mag pouches
    p.push(at(box(0.085, 0.09, 0.05, 0x0e0f12), -0.10, -v.h * 0.22, v.d / 2 - 0.01));
  }
  return mergeGeometries(p, false);
}
function beltGeo() {
  const b = KIT.belt;
  return mergeGeometries([
    at(box(b.w, b.h, b.d, C.dark), 0, 0, 0),
    at(box(0.05, 0.10, 0.055, C.dark), b.w / 2 - 0.02, -0.05, 0.02),     // holster
    at(box(0.035, 0.05, 0.035, C.dark), -b.w / 2 + 0.02, -0.03, 0.02),   // cuff pouch
  ], false);
}

/* --------------------------------------------------------------- scratch
   Shared across every officer: only one is posed at a time, inside one call. */
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ax = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _dir = new THREE.Vector3(), _hand = new THREE.Vector3(), _sup = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Swing `bone` so the child it carries points along `worldDir`, blended `w`.
 * `childDir` is that child's offset in the bone's own frame, cached at load:
 * the bone's rotation acts in its PARENT's frame, so the target quaternion is
 * the one taking childDir onto worldDir expressed in parent space. This works
 * without knowing which way the rig calls "down an arm".
 */
function pointBone(bone, childDir, worldDir, w) {
  if (!bone || !bone.parent || w <= 0) return;
  bone.parent.getWorldQuaternion(_pq).invert();
  _v.copy(worldDir).applyQuaternion(_pq).normalize();
  _q.setFromUnitVectors(childDir, _v);
  bone.quaternion.slerp(_q, w);
}

/** Add `angle` of rotation about a WORLD axis on top of whatever the clip wrote. */
function twistBone(bone, worldAxis, angle, w = 1) {
  if (!bone || !bone.parent || Math.abs(angle * w) < 1e-4) return;
  bone.parent.getWorldQuaternion(_pq).invert();
  _ax.copy(worldAxis).applyQuaternion(_pq).normalize();
  _q.setFromAxisAngle(_ax, angle * w);
  bone.quaternion.premultiply(_q);
}

const BONE_TINT = {
  Shirt: C.navy, Pants: 0x171c28, Socks: 0x0e0f12, Shoes: 0x0e0f12, Hair: 0x241a14,
};

/** One officer on the rig. Built by the pool; never constructed by the game directly. */
export class SkinnedOfficer {
  constructor(scene, gltf, slot) {
    this.slot = slot;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    const model = cloneSkinned(gltf.scene);
    this.model = model;
    this.mats = [];
    model.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      /* game/people.js leaves its skinned pedestrians frustum-culled and casting
         nothing; the primitive officer casts from its TORSO AND LEGS ONLY
         ("the rest is noise in the map and a shadow draw each", officer.js:112).
         Both rules apply here, and a skinned caster is the dear kind: the pose
         is skinned again in the shadow pass. Shirt + Pants = 2 casters, which is
         one FEWER than the primitive officer this replaces. */
      o.frustumCulled = true;
      o.receiveShadow = true;
      const name = o.material?.name || '';
      o.castShadow = /shirt|pants/i.test(name);
      o.material = o.material.clone();             // per-officer tint; SkeletonUtils.clone shares them
      o.material.roughness = 0.72;
      o.material.metalness = 0.04;
      this.mats.push(o.material);
    });

    // normalise to the primitive officer's height so he stands with the crowd
    const b = new THREE.Box3().setFromObject(model);
    const s = OFFICER_HEIGHT / Math.max(1e-3, b.max.y - b.min.y);
    model.scale.setScalar(s);
    model.position.y = -b.min.y * s;
    this.root.add(model);
    this.topY = b.max.y * s + model.position.y;

    // bones we pose by hand, and the child offsets pointBone needs
    this.bones = {};
    model.traverse((o) => {
      if (!o.isBone) return;
      this.bones[o.name] = o;
    });
    const dirOf = (a, b2) => {
      const p = this.bones[a], c = this.bones[b2];
      return p && c ? c.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    };
    this.dirs = {
      UpperArmR: dirOf('UpperArmR', 'LowerArmR'), LowerArmR: dirOf('LowerArmR', 'PalmR'),
      UpperArmL: dirOf('UpperArmL', 'LowerArmL'), LowerArmL: dirOf('LowerArmL', 'PalmL'),
    };

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    const find = (tail) => gltf.animations.find((a) => a.name.toLowerCase().endsWith(tail)) || null;
    for (const [key, tail] of [['idle', 'idle'], ['walk', 'walk'], ['run', 'run'], ['death', 'death']]) {
      const clip = find(tail);
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    if (this.actions.death) { this.actions.death.setLoop(THREE.LoopOnce, 1); this.actions.death.clampWhenFinished = true; }
    this.current = null;

    this.#dress();

    /* The weapon slot. It hangs off the root rather than off the hand bone, and
       is driven to the hand's world position each frame -- the same trick
       character.js uses for the player's gun, so the muzzle points where he
       aims instead of wherever the rig's palm axis happens to face. */
    this.handSlot = new THREE.Group();
    this.root.add(this.handSlot);

    this.aimW = 0; this.crouch = 0; this.recoil = 0; this.speed = 0;
    this.lastSync = 0;                  // see SkinnedOfficerPool.#stale
    this.dying = false; this.gun = null; this.hidden = [];
    this._prev = new THREE.Vector3(); this._havePrev = false;
    this.reseed(slot + 1);
  }

  /** Cap, vest and belt on the bones. Three meshes, the officers' shared material. */
  #dress() {
    const mat = officerMaterial();
    const head = this.bones.Head, torso = this.bones.Torso, hips = this.bones.Hips, neck = this.bones.Neck;
    this.root.updateMatrixWorld(true);
    const put = (geo, bone, wx, wy, wz) => {
      if (!bone) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = false; m.receiveShadow = true; m.frustumCulled = true;   // see the caster note above
      bone.add(m);
      bone.updateMatrixWorld(true);
      // world -> bone local, and undo the bone's world scale so metres stay metres
      m.position.copy(bone.worldToLocal(_v.set(wx, wy, wz)));
      bone.getWorldQuaternion(_pq).invert();
      m.quaternion.copy(_pq);
      const ws = bone.getWorldScale(_v2).x || 1;
      m.scale.setScalar(1 / ws);
      return m;
    };
    const hp = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.42, 0);
    const tp = torso ? torso.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.10, 0);
    const np = neck ? neck.getWorldPosition(new THREE.Vector3()) : tp.clone().setY(tp.y + 0.25);
    const bp = hips ? hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0.90, 0);
    this.capMesh = put(capGeo(0x161f36), head, hp.x, this.topY - KIT.cap.crown * 0.55, hp.z + 0.004);
    this.vestMesh = put(vestGeo(false), torso, tp.x, (tp.y + np.y) * 0.5 + 0.02, tp.z);
    this.beltMesh = put(beltGeo(), hips, bp.x, bp.y + 0.02, bp.z);
    this._vestPatrol = this.vestMesh?.geometry || null;
    this._vestSwat = null;
  }

  /** Patrol dress or tactical: a geometry swap on the vest, same material (officer.js:dressOfficer). */
  dress(swat) {
    if (!this.vestMesh) return;
    if (swat && !this._vestSwat) this._vestSwat = vestGeo(true);
    this.vestMesh.geometry = swat ? this._vestSwat : this._vestPatrol;
    this.swat = !!swat;
  }

  /**
   * Seeded variety, the same knobs world/officer.js turns: build and height on
   * the group, plus -- which the primitive cannot afford, because its colour is
   * baked into shared geometry -- a skin tone and a uniform shade, because the
   * materials here are already per-officer.
   */
  reseed(seed = 1) {
    const rnd = mulberry32(0x9e3779b1 ^ ((seed * 2654435761) >>> 0));
    const height = 0.94 + rnd() * 0.12, build = 0.92 + rnd() * 0.16;
    /* UNIFORM, unlike officer.js's (build, height, build). Every aim below runs
       through getWorldQuaternion on a bone, and Matrix4.decompose only recovers
       a true rotation from R*S -- a non-uniform scale ABOVE a rotated bone skews
       what comes back, which is the gun pointing a few degrees off its own
       barrel. The hero is uniform (character.js: model.scale.setScalar) too;
       `build` stays in `variety` as the knob if a stocky officer is ever wanted. */
    this.root.scale.setScalar(height);
    const skin = new THREE.Color().setHSL(0.07 + rnd() * 0.02, 0.34 + rnd() * 0.16, 0.20 + rnd() * 0.26);
    const shade = 0.88 + rnd() * 0.24;
    for (const m of this.mats) {
      const n = m.name || '';
      if (/skin/i.test(n)) m.color.copy(skin);
      else if (BONE_TINT[n] !== undefined) m.color.set(BONE_TINT[n]).multiplyScalar(/shirt/i.test(n) ? shade : 1);
    }
    this.variety = { height, build, seed };
  }

  /** World position of the gun hand, like character.js. False when the rig has no palm. */
  handWorldPosition(out) {
    const b = this.bones.PalmR || this.bones.LowerArmR;
    if (!b) return false;
    b.getWorldPosition(out);
    return true;
  }

  /** A round goes off: the muzzle kicks up and settles. Called from the fire site. */
  kick(k = 0.15) { this.recoil = Math.min(0.4, this.recoil + k); }

  /**
   * Take over a deployed primitive officer: hide his seven meshes and move his
   * weapon into this rig's hand. Everything else in traffic.js keeps talking to
   * the primitive group -- it is still the thing that holds the position, so
   * blood, line of sight, drops and the bullet origin need no change at all.
   */
  takeOver(joints, gun) {
    this.hidden.length = 0;
    if (joints) {
      for (const k of ['head', 'cap', 'torso', 'armL', 'armR', 'legL', 'legR']) {
        const m = joints[k];
        if (m && m.visible) { m.visible = false; this.hidden.push(m); }
      }
    }
    if (gun) {
      this.gun = gun;
      this.gunHome = gun.parent;
      this.gunPos = gun.position.clone();
      this.gunRot = gun.rotation.clone();
      this.handSlot.add(gun);
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
    }
    this.dying = false;
    this.aimW = 0; this.crouch = 0; this.recoil = 0; this.speed = 0;
    this._havePrev = false;
    this.lastSync = now();
    for (const a of Object.values(this.actions)) { a.stop(); a.setEffectiveWeight(1); }
    this.current = null;
    this.root.visible = true;
  }

  /** Hand the officer back to the primitive meshes and the weapon to his arm. */
  giveBack() {
    for (const m of this.hidden) m.visible = true;
    this.hidden.length = 0;
    if (this.gun && this.gun.parent === this.handSlot && this.gunHome) {
      this.gunHome.add(this.gun);
      this.gun.position.copy(this.gunPos);
      this.gun.rotation.copy(this.gunRot);
    }
    this.gun = null; this.gunHome = null;
    this.root.visible = false;
    this.dying = false;
    for (const a of Object.values(this.actions)) a.stop();
    this.current = null;
  }

  #play(name, fade = 0.18) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset(); next.enabled = true; next.setEffectiveWeight(1);
    if (name !== 'death') { next.setLoop(THREE.LoopRepeat, Infinity); next.clampWhenFinished = false; }
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
  }

  /**
   * One frame. `group` is the primitive officer's group -- the authority on
   * where he is -- and `pose` is traffic.js's own word for what he is doing:
   * 'crouch' | 'peek' | 'walk' | 'cuff' | 'fall'.
   */
  sync(dt, group, pose, ax, ay, az, hurt = 0) {
    if (!group) return;
    this.lastSync = now();
    this.root.visible = group.visible;
    this.root.position.copy(group.position);
    this.root.rotation.y = group.rotation.y + MODEL_YAW;

    /* Ground speed is measured, not asked for: the advance walk moves the cover
       point and that is the only locomotion an officer has. A jump in position
       (he was just deployed, or teleported with his cruiser) is not a sprint. */
    let speed = 0;
    if (this._havePrev && dt > 1e-4) {
      const d = Math.hypot(group.position.x - this._prev.x, group.position.z - this._prev.z);
      if (d < 1) speed = d / dt;
    }
    this._prev.copy(group.position);
    this._havePrev = true;
    this.speed = blendTo(this.speed, speed, dt, 0.15);

    const down = pose === 'fall';
    if (down && !this.dying) { this.dying = true; this.#play('death', 0.1); }
    if (!down) {
      const clip = clipForSpeed(this.speed);
      this.#play(clip);
      if (this.current) this.current.timeScale = clipRate(this.speed, clip);
    }

    // cover drops him behind the door; the clips have no crouch, so the root does it
    // ponytail: a body-height offset, not bent knees. Legs bend the day someone
    // authors or retargets a crouch clip -- a bone-by-bone crouch by hand fought
    // the walk cycle every time the AI flipped state.
    this.crouch = blendTo(this.crouch, (pose === 'crouch' || pose === 'peek') && !down ? 1 : 0, dt, 0.25);
    this.root.position.y -= this.crouch * CROUCH_DROP;

    this.mixer.update(dt);

    /* ---- EVERYTHING BELOW RUNS AFTER mixer.update ON PURPOSE ----
       The mixer writes every bone's local transform from the clip each frame.
       An aim written before it is overwritten and never seen; written after it,
       it rides on top of the clip, which is exactly the blend we want. */
    const aiming = !down && pose !== 'cuff' && this.gun !== null;
    this.aimW = blendTo(this.aimW, aiming ? 1 : 0, dt, AIM_BLEND);
    this.recoil = blendTo(this.recoil, 0, dt, 0.12);
    if (this.aimW > 0.002) this.#aim(ax, ay, az, hurt);
    else if (hurt > 0) this.#flinch(hurt);
  }

  /** Point the upper body down the aim. Called only from sync(), after the mixer. */
  #aim(ax, ay, az, hurt) {
    const w = this.aimW;
    this.root.updateMatrixWorld(true);
    this.root.getWorldDirection(_fwd);           // our model faces +Z, so this IS his forward
    _fwd.y = 0; _fwd.normalize();

    const sh = this.bones.UpperArmR;
    if (!sh) return;
    sh.getWorldPosition(_v2);
    const a = aimAngles(_v2.x, _v2.y, _v2.z, ax, ay, az, _fwd.x, _fwd.z);

    // chest and head turn toward him; the neck keeps to what a neck allows
    twistBone(this.bones.Torso, UP, Math.max(-0.5, Math.min(0.5, a.yaw * 0.32)), w);
    const headYaw = Math.max(-0.8, Math.min(0.8, a.yaw * 0.6));
    twistBone(this.bones.Head, UP, headYaw, w);
    _ax.crossVectors(_fwd, UP);                  // his own right: pitch axis for a nod
    twistBone(this.bones.Head, _ax, -Math.max(-0.6, Math.min(0.6, a.pitch)) + this.recoil * 0.5, w);
    if (hurt > 0) this.#flinch(hurt);
    this.root.updateMatrixWorld(true);

    // right arm out along the line of fire, kicked up by whatever recoil is left
    _dir.set(ax - _v2.x, ay - _v2.y, az - _v2.z).normalize();
    if (this.recoil > 1e-3) {
      _ax.crossVectors(_fwd, UP).normalize();
      _dir.applyAxisAngle(_ax, -this.recoil).normalize();
    }
    pointBone(this.bones.UpperArmR, this.dirs.UpperArmR, _dir, w);
    this.root.updateMatrixWorld(true);
    pointBone(this.bones.LowerArmR, this.dirs.LowerArmR, _dir, w);
    this.root.updateMatrixWorld(true);

    // left hand supports on the weapon, a hand's width down the barrel
    if (this.handWorldPosition(_hand) && this.bones.UpperArmL && this.bones.LowerArmL) {
      _sup.copy(_hand).addScaledVector(_dir, 0.16);      // _sup, not _v: pointBone uses _v as scratch
      this.bones.UpperArmL.getWorldPosition(_v2);
      _v2.subVectors(_sup, _v2).normalize();
      pointBone(this.bones.UpperArmL, this.dirs.UpperArmL, _v2, w * 0.9);
      this.root.updateMatrixWorld(true);
      this.bones.LowerArmL.getWorldPosition(_v2);
      _v2.subVectors(_sup, _v2).normalize();
      pointBone(this.bones.LowerArmL, this.dirs.LowerArmL, _v2, w * 0.9);
      // no updateMatrixWorld here: the only thing left to read is PalmR, and the
      // right arm was already settled above. Each of these is a whole-rig walk.
    }

    // the weapon rides the animated hand and points where he aims
    if (this.gun && this.handWorldPosition(_hand)) {
      this.handSlot.position.copy(this.root.worldToLocal(_hand));
      _q.setFromUnitVectors(XAXIS, _dir);        // the weapon's +X is its muzzle
      this.root.getWorldQuaternion(_pq).invert();
      this.handSlot.quaternion.copy(_pq).multiply(_q);
    }
  }

  /** The stagger traffic.js already tracks in c.hitT, on the rig instead of the boxes. */
  #flinch(hurt) {
    const k = Math.max(0, Math.min(1, hurt / 0.35));
    this.root.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
    _ax.crossVectors(_fwd, UP).normalize();
    twistBone(this.bones.Torso, _ax, 0.30 * k, 1);
    twistBone(this.bones.Head, _ax, 0.22 * k, 1);
  }
}

/* -------------------------------------------------------------------- pool
   `game/people.js` dresses only its N nearest pedestrians and leaves the rest
   as instanced parts; this is the same bargain. N mixers, reused by whoever is
   deployed, and `acquire()` returning null is the caller's instruction to keep
   the primitive officer standing. */
export class SkinnedOfficerPool {
  constructor(scene, { max = 4, url = MODEL } = {}) {
    this.scene = scene;
    this.roster = new Roster(max);
    this.slots = [];
    this.ready = false;
    this.url = url;
    this.loading = false;
    /* Fetch NOW, not at the first deploy. acquire() is only called when an
       officer steps out, and it hands back null while the GLB is in flight --
       so a pool built lazily at that moment guarantees the FIRST squad of the
       session is the boxes we were asked to replace. Build the pool at boot
       (main.js) and the half-megabyte is long landed before the first siren. */
    if (max > 0) this.#load();
  }

  /* A rig whose officer has not been sync'd for two seconds was leaked by a
     caller that cleared `deployed` without releasing (traffic.js has five such
     sites and standDown() is one of them). Reclaiming it is what stops a
     forgotten hook from leaving a rig standing in the road forever AND from
     retiring a slot permanently -- four arrests would otherwise exhaust the
     pool and silently retire the whole feature.
     ponytail: a 2 s watchdog, not refcounting. The fix is still the hook. */
  #stale() {
    const t = now();
    for (let i = 0; i < this.slots.length; i++) {
      if (this.roster.busy[i] && t - this.slots[i].lastSync > 2000) {
        console.warn('skinned officer slot', i, 'was never released; reclaiming');
        this.slots[i].giveBack();
        return i;
      }
    }
    return -1;
  }

  #load() {
    if (this.loading) return;
    this.loading = true;
    new GLTFLoader().load(this.url, (gltf) => {
      for (let i = 0; i < this.roster.size; i++) this.slots.push(new SkinnedOfficer(this.scene, gltf, i));
      this.ready = true;
    }, undefined, (err) => {
      console.warn('skinned officers unavailable, keeping the primitive ones:', err?.message || err);
    });
  }

  /** A rig for this officer, or null while the model is loading / the pool is full. */
  acquire(seed = 1, swat = false) {
    if (!this.ready) { this.#load(); return null; }
    let i = this.roster.take();
    if (i < 0) i = this.#stale();
    if (i < 0) return null;
    const sk = this.slots[i];
    sk.reseed(seed);
    sk.dress(swat);
    return sk;
  }

  /** Give a rig back. Returns null so the caller can write `c.sk = pool.release(c.sk)`. */
  release(sk) {
    if (!sk) return null;
    sk.giveBack();
    this.roster.free(sk.slot);
    return null;
  }

  /**
   * Every material the pool draws with. NOTE for the warm-up: CLAUDE.md's rule
   * is that a material must be compiled on the OBJECT KIND that draws it, and
   * six of these are drawn by a SkinnedMesh -- warming them on a plain Mesh
   * compiles the wrong pipeline and leaves the first-deploy hitch in place.
   * Empty until the GLB lands, so a boot-time caller gets nothing either way.
   */
  materials() {
    const out = [];
    for (const s of this.slots) out.push(...s.mats);
    if (this.slots.length) out.push(officerMaterial());
    return out;
  }
}

/* One pool for the game. traffic.js asks for it by scene; nothing else should. */
let POOL = null;

/** `?skinnedcops=N` overrides the pool size; 0 keeps every officer primitive. */
function capFromQuery(fallback) {
  if (typeof location === 'undefined') return fallback;      // node: the test imports this module
  const q = new URLSearchParams(location.search).get('skinnedcops');
  const n = q === null ? NaN : parseInt(q, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(8, n)) : fallback;
}

export function officerPool(scene, opts) {
  if (!POOL && scene) POOL = new SkinnedOfficerPool(scene, { ...opts, max: capFromQuery(opts?.max ?? 4) });
  return POOL;
}
