import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Near-field pedestrians: Kenney Blocky Characters (CC0) over the crowd.
 *
 * The crowd stays the 6-part instanced fleet (320 people, 6 draws). The N
 * nearest to the player are shown instead as full Kenney characters -- rigid
 * parts driven by the kit's own idle / walk / sprint / die clips through an
 * AnimationMixer each -- and their fleet instance is hidden for that frame.
 * 72 triangles and 6 draws per character; N=16 is ~100 draws, which the
 * bundle work paid for. Eight body variants, cycled by crowd index.
 *
 * Kenney characters are 2.7 units tall and face +Z; ours are ~1.75 m and head
 * along (cos yaw, -sin yaw), so scale 0.65 * height and rotation yaw + pi/2.
 */
const BASE = '/models/characters/';
const VARIANTS = ['civilian_casual', 'civilian_man', 'civilian_woman', 'civilian_suit', 'civilian_longsleeve', 'civilian_woman2'];

export class People {
  constructor(scene, count = 16) {
    this.scene = scene; this.count = count;
    this.slots = [];          // { obj, mixer, actions, current, person }
    this.ready = false;
    this._nearBuf = [];
    this._camFwd = new THREE.Vector3();
    this.#load();
  }

  async #load() {
    const loader = new GLTFLoader();
    const load = (f) => new Promise((res, rej) => loader.load(BASE + f + '.glb', res, undefined, rej));
    const kits = [];
    for (const v of VARIANTS) {
      try { kits.push(await load(v)); } catch (e) { console.warn('character', v, e.message); }
    }
    if (!kits.length) return;
    for (let i = 0; i < this.count; i++) {
      const k = kits[i % kits.length];
      const obj = k.scene.clone(true);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = true; } });
      obj.visible = false;
      this.scene.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const actions = {};
      const findClip = (names) => {
        for (const n of names) {
          const c = THREE.AnimationClip.findByName(k.animations, n);
          if (c) return c;
        }
        return k.animations[0] || null;
      };
      const idleC = findClip(['Idle', 'Standing', 'idle']);
      if (idleC) actions.idle = mixer.clipAction(idleC);
      const walkC = findClip(['Walk', 'walk']);
      if (walkC) actions.walk = mixer.clipAction(walkC);
      const sprintC = findClip(['Run', 'run', 'sprint']);
      if (sprintC) actions.sprint = mixer.clipAction(sprintC);
      const dieC = findClip(['Death', 'die', 'hit']);
      if (dieC) {
        actions.die = mixer.clipAction(dieC);
        actions.die.setLoop(THREE.LoopOnce);
        actions.die.clampWhenFinished = true;
      }
      this.slots.push({ obj, mixer, actions, current: null, person: null });
    }
    this.ready = true;
    console.info(`people: ${this.slots.length} high-detail human characters from ${kits.length} models`);
  }

  #play(slot, name, rate = 1) {
    const a = slot.actions[name] || slot.actions.idle;
    if (!a) return;
    if (slot.current !== a) { if (slot.current) slot.current.fadeOut(0.15); a.reset().fadeIn(0.15).play(); slot.current = a; }
    a.timeScale = rate;
  }

  /** After crowd.update(): take over the nearest people, hide their fleet instances. */
  update(dt, crowd, car, elevationAt, camera = null) {
    if (!this.ready || !crowd) return;
    const people = crowd.people;
    const near = this._nearBuf;
    near.length = 0;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p.live) continue;
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      if (d < 40) near.push([d, i]); // Task 0.4: 40m distance limit
    }
    near.sort((a, b) => a[0] - b[0]);
    const take = near.slice(0, this.slots.length).map((n) => n[1]);
    let dirty = false;

    if (camera) camera.getWorldDirection(this._camFwd);

    this.slots.forEach((s, k) => {
      const i = take[k];
      if (i === undefined) { s.obj.visible = false; s.person = null; return; }
      const p = people[i];
      crowd.fleet.hide(i); dirty = true;
      const lift = elevationAt ? elevationAt(p.x, p.z) : 0;
      s.obj.visible = true;
      s.obj.position.set(p.x, lift, p.z);
      s.obj.rotation.y = p.yaw + Math.PI / 2;
      const sc = 0.95 * (p.height || 1);
      s.obj.scale.set(sc, sc, sc);
      if (p.down) this.#play(s, 'die');
      else if (p.panic > 0) this.#play(s, 'sprint', 1.1);
      else if (p.cross || (p.speed > 0.15 && !(p.j && Math.hypot(p.j.x - p.x, p.j.y - p.z) < 7 && p.waitingNow))) this.#play(s, 'walk', 0.9 + (p.speed || 1) * 0.3);
      else this.#play(s, 'idle');
      if (s.person !== p) { s.person = p; s.mixer.setTime(Math.random() * 2); }

      // Skip mixer.update for slots behind camera beyond 20m
      let skip = false;
      if (camera) {
        const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
        if (dx * dx + dz * dz > 400) {
          const dot = dx * this._camFwd.x + dz * this._camFwd.z;
          if (dot < 0) skip = true;
        }
      }
      if (!skip) s.mixer.update(dt);
    });
    if (dirty) crowd.fleet.flush();
  }
}
