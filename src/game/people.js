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
const BASE = '/models/vendor/kenney/characters/';
const VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export class People {
  constructor(scene, count = 16) {
    this.scene = scene; this.count = count;
    this.slots = [];          // { obj, mixer, actions, current, person }
    this.ready = false;
    this.#load();
  }

  async #load() {
    const loader = new GLTFLoader();
    const load = (f) => new Promise((res, rej) => loader.load(BASE + f + '.glb', res, undefined, rej));
    const kits = [];
    for (const v of VARIANTS) {
      try { kits.push(await load('character-' + v)); } catch (e) { console.warn('character', v, e.message); }
    }
    if (!kits.length) return;
    for (let i = 0; i < this.count; i++) {
      const k = kits[i % kits.length];
      const obj = k.scene.clone(true);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      obj.visible = false;
      this.scene.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const actions = {};
      for (const name of ['idle', 'walk', 'sprint', 'die']) {
        const clip = THREE.AnimationClip.findByName(k.animations, name);
        if (clip) { actions[name] = mixer.clipAction(clip); if (name === 'die') { actions[name].setLoop(THREE.LoopOnce); actions[name].clampWhenFinished = true; } }
      }
      this.slots.push({ obj, mixer, actions, current: null, person: null });
    }
    this.ready = true;
    console.info(`people: ${this.slots.length} near-field characters from ${kits.length} bodies`);
  }

  #play(slot, name, rate = 1) {
    const a = slot.actions[name] || slot.actions.idle;
    if (!a) return;
    if (slot.current !== a) { if (slot.current) slot.current.fadeOut(0.15); a.reset().fadeIn(0.15).play(); slot.current = a; }
    a.timeScale = rate;
  }

  /** After crowd.update(): take over the nearest people, hide their fleet instances. */
  update(dt, crowd, car, elevationAt) {
    if (!this.ready || !crowd) return;
    const people = crowd.people;
    const near = [];
    for (let i = 0; i < people.length; i++) { const p = people[i]; if (!p.live) continue; near.push([Math.hypot(p.x - car.x, p.z - car.z), i]); }
    near.sort((a, b) => a[0] - b[0]);
    const take = near.slice(0, this.slots.length).map((n) => n[1]);
    let dirty = false;
    this.slots.forEach((s, k) => {
      const i = take[k];
      if (i === undefined) { s.obj.visible = false; s.person = null; return; }
      const p = people[i];
      crowd.fleet.hide(i); dirty = true;
      const lift = elevationAt ? elevationAt(p.x, p.z) : 0;
      s.obj.visible = true;
      s.obj.position.set(p.x, lift, p.z);
      s.obj.rotation.y = p.yaw + Math.PI / 2;
      const sc = 0.65 * (p.height || 1);
      s.obj.scale.set(sc, sc, sc);
      if (p.down) this.#play(s, 'die');
      else if (p.panic > 0) this.#play(s, 'sprint', 1.1);
      else if (p.cross || (p.speed > 0.15 && !(p.j && Math.hypot(p.j.x - p.x, p.j.y - p.z) < 7 && p.waitingNow))) this.#play(s, 'walk', 0.9 + (p.speed || 1) * 0.3);
      else this.#play(s, 'idle');
      if (s.person !== p) { s.person = p; s.mixer.setTime(Math.random() * 2); }
      s.mixer.update(dt);
    });
    if (dirty) crowd.fleet.flush();
  }
}
