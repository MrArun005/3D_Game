import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PARTS } from '../../tools/avatar/avatar.mjs';
import { SHAPES } from '../../tools/avatar/shapes.mjs';
import { gaitBlend, bestPhaseOffset, stepWeight } from './gait.js';

/**
 * The player, as an actual rigged human.
 *
 * The hand-built figure it replaces was six boxes on a trigonometric walk
 * cycle -- fine for a crowd seen at forty metres, obviously wrong for the
 * character the camera sits behind. These are Quaternius CC0 models with real
 * skeletons and real clips, so idle, walk and run are animation rather than
 * arithmetic.
 *
 * Only the player gets one. A skinned mesh per pedestrian would cost far more
 * than the part-instanced crowd does, and nobody is looking that closely at
 * the ninety-six people on the pavement.
 *
 * Six models ship; five of them were never loaded by anything. They are the
 * pool the player picks from -- `?me=3` on the URL, or K in play.
 */

/** Every shipped avatar, in a stable order so `?me=` means the same thing. */
export const CHARACTERS = [
  '/models/characters/civilian_casual.glb',
  '/models/characters/civilian_man.glb',
  '/models/characters/civilian_woman.glb',
  '/models/characters/civilian_suit.glb',
  '/models/characters/civilian_longsleeve.glb',
  '/models/characters/civilian_woman2.glb',
  '/models/characters/cowboy.glb',
  '/models/characters/navy_jacket.glb',
  // RPM-schema wardrobe avatars (tools/avatar). No clips of their own — see
  // the donor retarget below. ?me=8 / ?me=9.
  '/models/avatar/male.wardrobe.glb',
  '/models/avatar/female.wardrobe.glb',
];

export const NAMED_CHARACTERS = [
  { id: 'maya', name: 'MAYA LIN', role: 'STREET RACER', perk: 'Precision apex control & drift bonus', index: 2 },
  { id: 'valerie', name: 'VALERIE CROSS', role: 'SHADOW OPERATIVE', perk: 'Agile athletics & silent footwork', index: 9 },
  { id: 'leo', name: 'LEO VANCE', role: 'GETAWAY SPECIALIST', perk: 'Sharper steering response', index: 0 },
  { id: 'marcus', name: 'MARCUS STERLING', role: 'MASTERMIND', perk: 'Cool heat & +20% payouts', index: 3 },
  { id: 'jax', name: 'JAX MILLER', role: 'ENFORCER', perk: 'Heavy ram force & NOS boost', index: 6 },
];

/* What the build does not ship: vite.config.js DIST_PRUNE removes
   models/avatar (the wardrobe GLBs are unlicensed dev fixtures, NOTICE.md).
   test/character-ship.test.js reads DIST_PRUNE and holds the two together. */
export const DEV_ONLY_PREFIX = '/models/avatar/';

/**
 * The personas K may cycle to. In the shipped build (`prod`), one whose model
 * the build prunes is left out: swap() disposes the current body before it
 * loads the next, so a 404 there left the on-foot hero with no body at all.
 * Dev keeps every persona. Pure; tested.
 */
export function shippedPersonas(list = NAMED_CHARACTERS, prod = false) {
  return prod ? list.filter((p) => !CHARACTERS[p.index]?.startsWith(DEV_ONLY_PREFIX)) : list;
}

/* The wardrobe GLBs carry 11 generated parts (beards, hair shells, torso
   layers) as plain meshes — glTF has no visibility flag and the loader keeps
   everything visible, so an un-hidden avatar wears five beards at once. The
   part list is the customiser's, imported so there is one source of truth. */
const WARDROBE_PARTS = new Set(Object.values(PARTS).flat());

/**
 * RPM avatars ship no animation clips, so they borrow the Quaternius man's
 * and retarget them at load. The map is TARGET (RPM, Mixamo names) -> SOURCE
 * (Quaternius) — note the source names are what GLTFLoader makes of them:
 * PropertyBinding.sanitizeNodeName strips the dots, so `UpperArm.L` loads as
 * `UpperArmL`. Unmapped target bones (fingers, eyes, toes, Spine1) keep their
 * bind pose. Quaternius `Foot.L/R` are IK targets parented to the rig root,
 * not to the shin — retargetClip works in target-matrix space, so their world
 * orientation still lands on the avatar's ankles correctly.
 */
const RETARGET_NAMES = {
  Hips: 'Hips', Spine: 'Abdomen', Spine2: 'Torso', Neck: 'Neck', Head: 'Head',
  LeftShoulder: 'ShoulderL', LeftArm: 'UpperArmL', LeftForeArm: 'LowerArmL', LeftHand: 'PalmL',
  RightShoulder: 'ShoulderR', RightArm: 'UpperArmR', RightForeArm: 'LowerArmR', RightHand: 'PalmR',
  LeftUpLeg: 'UpperLegL', LeftLeg: 'LowerLegL', LeftFoot: 'FootL',
  RightUpLeg: 'UpperLegR', RightLeg: 'LowerLegR', RightFoot: 'FootR',
};

const DONOR = '/models/characters/civilian_man.glb';
let donorPromise = null;
const donorReady = () => (donorPromise ??= new Promise((res, rej) =>
  new GLTFLoader().load(DONOR, res, undefined, rej)));

/**
 * Borrow the donor's clips for a clip-less avatar. `target` is the avatar's
 * SkinnedMesh — the retargeted tracks come out as `.bones[Name].…` paths,
 * which only bind when the AnimationMixer is rooted ON that mesh, so the
 * caller must build its mixer there too.
 */
async function retargetedClips(target) {
  const donor = await donorReady();
  let source = null;
  donor.scene.traverse((o) => { if (o.isSkinnedMesh) source ??= o; });
  if (!source || !target) return [];
  donor.scene.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  /* Hip translation comes across in the donor's units; scale it into the
     avatar's. Bind-local hip height is the honest ruler for both — the Hips
     bone hangs directly off each armature root. */
  const sHip = source.skeleton.bones.find((b) => b.name === 'Hips');
  const tHip = target.skeleton.bones.find((b) => b.name === 'Hips');
  const scale = sHip && tHip && sHip.position.y > 1e-3
    ? tHip.position.y / sHip.position.y : 1;
  return donor.animations.map((clip) => retargetClip(target, source, clip, {
    hip: 'Hips',
    names: { ...RETARGET_NAMES },
    scale,
    // vertical bob only: the game positions the root, lateral drift would fight it
    hipInfluence: new THREE.Vector3(0, 1, 0),
  }));
}

const CLIPS = {
  idle: ['Idle', 'Standing'],
  walk: ['Walk'],
  run: ['Run'],
  jump: ['Jump'],
  runningJump: ['RunningJump'],
  hit: ['Death'],
  punch: ['Punch'],
};
const TARGET_HEIGHT = 1.78;            // metres, so they match the cars

/* The left thigh's rotation over one cycle of each clip (2026-09-25): what
   bestPhaseOffset (gait.js) lines up, so the blended walk and run land the
   same foot at the same time instead of crossing their legs. Quaternius names
   it UpperLeg.L (UpperLegL once three sanitises the dot); the RPM avatars'
   retargeted tracks, LeftUpLeg. No such track: phase 0, as it always was. */
const THIGH = /(UpperLeg[._]?L|LeftUpLeg|Thigh[._]?L|UpLeg[._]?L)\.quaternion$/i;
function thighPhase(walkClip, runClip, N = 48) {
  const sample = (clip) => {
    const track = clip.tracks.find((t) => THIGH.test(t.name));
    if (!track) return null;
    const it = track.createInterpolant();
    return Array.from({ length: N }, (_, i) => Array.from(it.evaluate((i / N) * clip.duration)));
  };
  const a = sample(walkClip), b = sample(runClip);
  return a && b ? bestPhaseOffset(a, b) : 0;
}

export class Character {
  constructor(scene, url = CHARACTERS[2]) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.ready = false;
    this.actions = {};
    this.current = null;
    this.state = null; this.fade = 0.2; this.weights = new Map(); this.runPhase = 0;   // hand-managed blend weights (play / #blend)
    this.morphMeshes = [];
    this.blinkTimer = 2.0;
    this.blinkProgress = -1;
    this.blinkDuration = 0.15;
    this.index = Math.max(0, CHARACTERS.indexOf(url));
    this.#load(url);
  }

  /**
   * Swap avatar. The old model is disposed rather than hidden -- a skinned
   * mesh keeps its skeleton, its bone texture and its clips alive, and
   * cycling through six of them would leak all six.
   */
  swap(index) {
    const i = ((index % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
    if (i === this.index && this.ready) return this.index;
    this.index = i;
    const wasVisible = this.root.visible;
    for (const child of [...this.root.children]) {
      child.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) m?.dispose();
      });
      this.root.remove(child);
    }
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.state = null; this.weights = new Map(); this.runPhase = 0;
    this.morphMeshes = [];
    this.ready = false;
    this.#load(CHARACTERS[i]);
    this.root.visible = wasVisible;
    return i;
  }

  setMorph(name, val) {
    for (let i = 0; i < this.morphMeshes.length; i++) {
      const m = this.morphMeshes[i];
      let idx = m.morphTargetDictionary ? m.morphTargetDictionary[name] : -1;
      if (idx === undefined || idx < 0) {
        idx = SHAPES.indexOf(name);
      }
      if (idx >= 0 && idx < m.morphTargetInfluences.length) {
        m.morphTargetInfluences[idx] = val;
      }
    }
  }

  #initFace() {
    this.blinkTimer = 1.5 + Math.random() * 2.0;
    this.blinkProgress = -1;
    this.blinkDuration = 0.15;
    // Naturally warm, confident, pretty resting facial expression
    this.setMorph('mouthSmile', 0.14);
    this.setMorph('browInnerUp', 0.06);
    this.setMorph('eyeSquintLeft', 0.04);
    this.setMorph('eyeSquintRight', 0.04);
  }

  #updateFace(dt) {
    if (!this.morphMeshes.length) return;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkProgress < 0) {
      this.blinkProgress = 0;
      this.blinkTimer = 3.2 + Math.random() * 2.2;
    }
    if (this.blinkProgress >= 0) {
      this.blinkProgress += dt / this.blinkDuration;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = -1;
        this.setMorph('eyeBlinkLeft', 0);
        this.setMorph('eyeBlinkRight', 0);
      } else {
        const w = Math.sin(this.blinkProgress * Math.PI);
        this.setMorph('eyeBlinkLeft', w);
        this.setMorph('eyeBlinkRight', w);
      }
    }
  }

  #load(url) {
    try {
      new GLTFLoader().load(url, async (gltf) => {
        const model = gltf.scene;
        this.morphMeshes = [];
        model.traverse((o) => {
          if (!o.isMesh && !o.isSkinnedMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;      // skinned bounds go stale as it animates
          if (o.name === 'Wolf3D_Glasses' || WARDROBE_PARTS.has(o.name)) o.visible = false;   // reveal eyes/face
          if (o.morphTargetInfluences && o.morphTargetInfluences.length > 0) {
            this.morphMeshes.push(o);
          }
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m) continue;
            const nm = (m.name || '').toLowerCase();
            const onm = (o.name || '').toLowerCase();
            if (nm.includes('eye') || onm.includes('eye')) {
              m.roughness = 0.08;
              m.metalness = 0.0;
              if (m.color) m.color.multiplyScalar(1.2); // clear bright eyes
            } else if (nm.includes('skin') || onm.includes('skin') || nm.includes('head') || nm.includes('face')) {
              m.roughness = 0.52;
              m.metalness = 0.0; // eliminate alien metallic skin shine
            } else if (nm.includes('hair') || onm.includes('hair')) {
              m.roughness = 0.58;
              m.metalness = 0.04;
            } else if (nm.includes('shoe') || onm.includes('shoe') || nm.includes('footwear')) {
              m.roughness = 0.38;
              m.metalness = 0.08;
            } else {
              // clothing, shirts, jackets, pants
              m.roughness = 0.72;
              m.metalness = 0.02;
            }
          }
        });

        // normalise: these packs are authored at whatever scale suits them
        const box = new THREE.Box3().setFromObject(model);
        const h = box.max.y - box.min.y || 1;
        const s = TARGET_HEIGHT / h;
        model.scale.setScalar(s);
        model.position.y = -box.min.y * s;
        this.root.add(model);

        // RPM avatars ship no clips; borrow the donor's, retargeted
        let animations = gltf.animations;
        let mixerRoot = model;
        if (!animations.length) {
          let target = null;
          model.traverse((o) => { if (o.isSkinnedMesh) target ??= o; });
          if (target) {
            try { animations = await retargetedClips(target); }
            catch (e) { console.warn('avatar retarget failed:', e?.message || e); animations = []; }
            if (this.root.children[0] !== model) return;   // swapped away mid-await
            if (animations.length) mixerRoot = target;     // `.bones[…]` tracks bind here
          }
        }

        this.mixer = new THREE.AnimationMixer(mixerRoot);
        for (const [key, names] of Object.entries(CLIPS)) {
          const clip = animations.find((a) => {
            const lower = a.name.toLowerCase();
            return names.some((n) => {
              const nl = n.toLowerCase();
              return lower === nl || lower.endsWith('_' + nl) || lower.endsWith('|' + nl);
            });
          }) || animations.find((a) =>
            names.some((n) => a.name.toLowerCase().endsWith(n.toLowerCase()))
          );
          if (clip) this.actions[key] = this.mixer.clipAction(clip);
        }
        if (this.actions.walk && this.actions.run) this.runPhase = thighPhase(this.actions.walk.getClip(), this.actions.run.getClip());
        this.play('idle', 0);
        this.#initFace();
        this.ready = true;
        if (this.onReady) this.onReady();
      }, undefined, (err) => {
        console.warn('character failed to load, keeping the box figure:', err?.message || err);
        if (this.onFail) this.onFail();
      });
    } catch (err) {
      if (this.onFail) this.onFail();
    }
  }

  /**
   * Go to a state over `fade` seconds. Re-requesting the current one is a
   * no-op. The weights are managed by hand (#blend), not by three's
   * crossFadeFrom: the walk/run blend below holds TWO clips at once, and
   * three's fadeOut always starts from weight 1, so leaving a 60/40 blend
   * spiked both clips to full. Every clip's weight walks linearly toward its
   * target instead, which also keeps the total at 1 through a transition (a
   * total under 1 blends in the bind pose).
   */
  play(name, fade = 0.22) {
    let next = this.actions[name];
    if (!next && name === 'runningJump') next = this.actions.jump;
    if (!next || this.state === name) return;
    const once = name === 'hit' || name === 'jump' || name === 'runningJump';
    next.clampWhenFinished = once;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    if (once || !(this.weights.get(next) > 0)) next.reset();   // a one-shot starts over; a clip already fading back in keeps its step
    next.enabled = true;
    next.play();
    this.state = name; this.fade = fade; this.current = next;
  }

  /** The locomotion blend: walk and run together, phase-locked (gait.js). */
  #loco() {
    if (this.state === 'loco') return;
    const walk = this.actions.walk, run = this.actions.run;
    for (const a of [walk, run]) {
      a.clampWhenFinished = false;
      a.setLoop(THREE.LoopRepeat, Infinity);
      if (!(this.weights.get(a) > 0)) a.reset();
      a.enabled = true;
      a.play();
    }
    this.state = 'loco'; this.fade = 0.2; this.current = walk;
  }

  /** Every clip's weight one step toward its target; clips at zero stop costing anything. */
  #blend(dt, wRun) {
    const walk = this.actions.walk, run = this.actions.run;
    for (const a of Object.values(this.actions)) {
      const target = this.state === 'loco' ? (a === walk ? 1 - wRun : a === run ? wRun : 0) : (a === this.current ? 1 : 0);
      const w = stepWeight(this.weights.get(a) ?? 0, target, dt, this.fade);
      this.weights.set(a, w);
      a.stopFading();
      a.setEffectiveWeight(w);
      if (w === 0 && target === 0) a.enabled = false;
    }
  }

  /**
   * A one-shot action -- punch, hit -- that holds for `seconds` before the
   * locomotion states take the body back. Without the hold, update() would
   * re-select idle on the very next frame and the punch would never be seen:
   * which is why the Punch clip has been loaded and never played.
   */
  act(name, seconds = 0.8) {
    if (!this.actions[name]) return false;
    this.busyUntil = performance.now() + seconds * 1000;
    this.play(name, 0.08);
    return true;
  }

  /** `speed` in m/s decides the clip; the model faces +X like everything else. */
  /** The named bone of the active skinned mesh, cached. Target rig names (PalmR, UpperArmR...). */
  bone(name) {
    this._bones ??= new Map();
    if (this._bones.has(name)) return this._bones.get(name);
    let found = null;
    this.root.traverse((o) => { if (!found && o.isSkinnedMesh) found = o.skeleton.bones.find((b) => b.name === name) || null; });
    this._bones.set(name, found);
    return found;
  }

  /**
   * World position of the right palm, written into `out`. Lets the held
   * weapon ride the animated hand without guessing the bone's axes: the gun
   * is placed AT the hand and oriented by the aim, which is what a third-
   * person camera actually shows. Returns false when there is no rig yet.
   */
  handWorldPosition(out) {
    const b = this.bone('PalmR') || this.bone('LowerArmR');
    if (!b) return false;
    b.getWorldPosition(out);
    return true;
  }

  /**
   * Take a hit: the 'hit' clip has been loaded since the avatar landed and
   * never played (CLAUDE.md). One-shot, then back to locomotion; `busyUntil`
   * keeps update() from stomping it for the clip's length.
   */
  flinch() {
    /* The only 'hit' clip on the rig is 'Death' (CLIPS.hit maps to it), so
       playing it on every landed round made her die four times a firefight.
       A flinch is now a 0.25 s pause in locomotion; the camera kick and the
       health bar carry the message. The clip is kept for die(). */
    if (!this.ready) return false;
    this.busyUntil = performance.now() + 250;
    return true;
  }

  /** A punch: the Punch clip if the rig has one, else a 0.4 s pause. Returns the swing time in ms. */
  punch() {
    if (!this.ready) return 0;
    const a = this.actions.punch;
    if (a) { this.play('punch', 0.06); const ms = Math.min(700, (a.getClip().duration * 1000) | 0); this.busyUntil = performance.now() + ms; return ms; }
    this.busyUntil = performance.now() + 400; return 400;
  }

  /** Wasted: the Death clip, held on its last frame. Returns its length in ms so the caller can wait. */
  die() {
    const a = this.actions.hit;
    if (!a || !this.ready) return 0;
    this.play('hit', 0.1);
    const ms = Math.min(2200, (a.getClip().duration * 1000) | 0);
    this.busyUntil = performance.now() + ms + 400;
    return ms;
  }

  /* A NEGATIVE speed means backing up: the caller keeps you facing the camera
     and we play the walk clip in reverse, which is what a backpedal is. Every
     decision below reads the magnitude. */
  update(dt, x, y, z, yaw, speed, isGrounded = true, rollLean = 0, pitchLean = 0) {
    const backing = speed < 0;
    speed = Math.abs(speed);
    if (!this.ready) return;
    this._bones = this._bones && this._bonesRoot === this.root.children[0] ? this._bones : (this._bonesRoot = this.root.children[0], new Map());
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitchLean * 0.5, -yaw + Math.PI / 2, rollLean, 'YXZ');
    this.#updateFace(dt);

    let wRun = 0;
    const walk = this.actions.walk, run = this.actions.run;
    if (!(this.busyUntil > performance.now())) {
      if (!isGrounded) {
        if (speed > 3.8 && this.actions.runningJump) this.play('runningJump', 0.12);
        else if (this.actions.jump) this.play('jump', 0.12);
      } else if (speed > 0.35 && !backing && walk && run) {
        this.#loco();
      } else {
        this.play(backing || (speed > 0.35 && !run) ? 'walk' : speed > 0.35 ? 'run' : 'idle', 0.2);
      }
    }
    if (this.state === 'loco') {
      /* Blend space (gait.js): the default 3.2 m/s jog is ~40% run on a
         ~1x cycle, where it used to be the sprint clip at 0.62x. The run is
         phase-LOCKED to the walk every frame (runPhase is measured at load
         from the thigh), so the two can never drift into crossed legs. */
      const Dw = walk.getClip().duration, Dr = run.getClip().duration;
      const g = gaitBlend(speed, Dw, Dr);
      wRun = g.w;
      walk.timeScale = g.tsWalk;
      run.timeScale = g.tsRun;
      run.time = (((walk.time / Dw + this.runPhase) % 1) + 1) % 1 * Dr;
    } else if (this.current) {
      if (this.current === this.actions.jump || this.current === this.actions.runningJump) {
        this.current.timeScale = 1.05;
      } else if (this.current === walk || this.current === run) {
        const rate = speed > 0.35 ? Math.max(0.55, Math.min(1.45, speed / (this.current === run ? 5.2 : 1.9))) : 1;
        this.current.timeScale = backing ? -rate : rate;
      } else {
        this.current.timeScale = 1;
      }
    }
    this.#blend(dt, wRun);
    this.mixer.update(dt);
  }

  show(on) { this.root.visible = on; }
}
