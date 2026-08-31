import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
];

const CLIPS = {
  idle: ['Idle', 'Standing'],
  walk: ['Walk'],
  run: ['Run'],
  hit: ['Death'],
  punch: ['Punch'],
};
const TARGET_HEIGHT = 1.78;            // metres, so they match the cars

export class Character {
  constructor(scene, url = CHARACTERS[0]) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.ready = false;
    this.actions = {};
    this.current = null;
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
    this.ready = false;
    this.#load(CHARACTERS[i]);
    this.root.visible = wasVisible;
    return i;
  }

  #load(url) {
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;      // skinned bounds go stale as it animates
      });

      // normalise: these packs are authored at whatever scale suits them
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y || 1;
      const s = TARGET_HEIGHT / h;
      model.scale.setScalar(s);
      model.position.y = -box.min.y * s;
      this.root.add(model);

      this.mixer = new THREE.AnimationMixer(model);
      for (const [key, names] of Object.entries(CLIPS)) {
        const clip = gltf.animations.find((a) =>
          names.some((n) => a.name.toLowerCase().endsWith(n.toLowerCase())));
        if (clip) this.actions[key] = this.mixer.clipAction(clip);
      }
      this.play('idle', 0);
      this.ready = true;
      if (this.onReady) this.onReady();
    }, undefined, (err) => {
      console.warn('character failed to load, keeping the box figure:', err?.message || err);
      if (this.onFail) this.onFail();
    });
  }

  /** Cross-fade to a state. Re-requesting the current one is a no-op. */
  play(name, fade = 0.22) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (name === 'hit') { next.clampWhenFinished = true; next.setLoop(THREE.LoopOnce, 1); }
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
  }

  /** `speed` in m/s decides the clip; the model faces +X like everything else. */
  update(dt, x, y, z, yaw, speed) {
    if (!this.ready) return;
    this.root.position.set(x, y, z);
    this.root.rotation.y = -yaw + Math.PI / 2;
    this.play(speed > 4.2 ? 'run' : speed > 0.35 ? 'walk' : 'idle');
    // the clips are authored at their own pace; nudge playback so the feet
    // roughly keep up with how fast we are actually moving
    if (this.current) {
      this.current.timeScale = speed > 0.35 ? Math.max(0.6, Math.min(1.7, speed / (speed > 4.2 ? 5.2 : 1.9))) : 1;
    }
    this.mixer.update(dt);
  }

  show(on) { this.root.visible = on; }
}
