import * as THREE from 'three';

/**
 * Something to actually do.
 *
 * Everything built so far is a place; this is the first thing that is a game.
 * A course is a chain of checkpoints laid along the road graph, and the only
 * rules are drive through them in order and beat the clock. It is deliberately
 * the simplest possible objective, because the point is to prove the loop --
 * start, chase a target, succeed or fail, see a number, go again -- before
 * anything more elaborate hangs off it.
 *
 * Courses are built from the graph rather than hand-placed, so every run is a
 * different route through a real city.
 */

const RING_R = 7.0;
const COUNT = 8;

export class Mission {
  constructor(scene, district) {
    this.district = district;
    this.active = false;
    this.points = [];
    this.index = 0;
    this.time = 0;
    this.best = Number(localStorage.getItem('hb.best') || 0) || null;
    this.message = '';
    this.messageFor = 0;

    // the ring you drive through: a torus, plus a column so you can see it
    // over a building from three streets away
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING_R, 0.42, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc23c, toneMapped: false }),
    );
    ring.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_R * 0.92, RING_R * 0.92, 60, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc23c, transparent: true, opacity: 0.13,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    beam.position.y = 30;
    const g = new THREE.Group();
    g.add(ring, beam);
    g.visible = false;
    scene.add(g);
    this.marker = g;
    this.ring = ring;

    // the next one along, dimmer, so you know which way the course runs
    const next = g.clone();
    next.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.setHex(0x4aa3ff);
      if (o.material.opacity < 1) o.material.opacity = 0.07;
    });
    next.visible = false;
    scene.add(next);
    this.nextMarker = next;
  }

  /** Lay a course out from wherever the car is standing. */
  start(car, seed) {
    const nodes = this.district.graph.nodes.filter(
      (n) => n.kind === 'cross' || n.kind === 'tee',
    );
    if (!nodes.length) return;

    // walk outward: each leg 180-420m from the last, so a course crosses the
    // city instead of circling one block
    /* Seeded, so two players given the same room id lay out the same course
       from the same graph without exchanging a single checkpoint. */
    this.seed = seed ?? ((Math.random() * 0xffffffff) >>> 0);
    let st = this.seed;
    const rnd = () => {
      st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0;
      return st / 4294967296;
    };

    const pts = [];
    /* The FIRST point has to come out of the seeded stream too.
       It used to be the player's own position, so two players sharing a room
       -- and therefore sharing a seed -- still walked two different courses
       from two different starts and raced each other on separate routes. The
       anchor is now a seeded node, so the same seed is the same course
       wherever either player happens to be standing. */
    const anchor = nodes[(rnd() * nodes.length) | 0];
    let from = { x: anchor.x, y: anchor.y };
    for (let i = 0; i < COUNT; i++) {
      let best = null, bestScore = -Infinity;
      for (let k = 0; k < 220; k++) {
        const n = nodes[(rnd() * nodes.length) | 0];
        const d = Math.hypot(n.x - from.x, n.y - from.y);
        if (d < 180 || d > 420) continue;
        // prefer somewhere we have not been
        const near = pts.reduce((m, p) => Math.min(m, Math.hypot(p.x - n.x, p.y - n.y)), 1e9);
        const score = Math.min(near, 400) - Math.abs(d - 300) * 0.4;
        if (score > bestScore) { bestScore = score; best = n; }
      }
      if (!best) break;
      pts.push(best);
      from = best;
    }
    if (pts.length < 3) return;

    this.points = pts;
    this.index = 0;
    this.time = 0;
    this.active = true;
    this.#say(`RUN STARTED · ${pts.length} CHECKPOINTS`);
    this.#place();
  }

  stop(reason) {
    this.active = false;
    this.marker.visible = false;
    this.nextMarker.visible = false;
    if (reason) this.#say(reason);
  }

  #say(text) { this.message = text; this.messageFor = 3.4; }

  #place() {
    const p = this.points[this.index];
    if (!p) return;
    this.marker.position.set(p.x, 0, p.y);
    this.marker.visible = true;
    const n = this.points[this.index + 1];
    if (n) {
      this.nextMarker.position.set(n.x, 0, n.y);
      this.nextMarker.visible = true;
    } else this.nextMarker.visible = false;
  }

  update(car, dt) {
    if (this.messageFor > 0) this.messageFor -= dt;
    if (!this.active) return;
    this.time += dt;

    this.ring.rotation.z += dt * 0.9;
    const pulse = 1 + Math.sin(this.time * 4) * 0.04;
    this.marker.scale.set(pulse, pulse, pulse);

    const p = this.points[this.index];
    if (Math.hypot(car.x - p.x, car.z - p.y) > RING_R) return;

    this.index++;
    if (this.index >= this.points.length) {
      const t = this.time;
      const record = !this.best || t < this.best;
      if (record) { this.best = t; try { localStorage.setItem('hb.best', String(t)); } catch { /* private mode */ } }
      this.stop(`${record ? 'NEW BEST' : 'FINISHED'} · ${t.toFixed(1)}s`);
      /* Tell the room. Without this a race had no finish condition at all:
         both players ran the course and nothing ever ended for the loser. */
      if (this.onFinish) this.onFinish(t);
      return;
    }
    this.#say(`CHECKPOINT ${this.index}/${this.points.length}`);
    this.#place();
  }

  /** What the HUD should show, or null. */
  status() {
    if (this.active) {
      return {
        line: `${this.index + 1}/${this.points.length}`,
        time: this.time,
        best: this.best,
      };
    }
    return this.best ? { line: '', time: null, best: this.best } : null;
  }
}
