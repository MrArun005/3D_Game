import * as THREE from 'three';

/**
 * Wear on the car.
 *
 * This used to be state plus a smoke plume, on the argument that the hull is a
 * lofted surface and denting it properly meant rebuilding it every impact.
 * That argument was wrong: the loft is a plain non-indexed buffer that belongs
 * to this car alone, so a dent is a displacement of the vertices near the
 * contact point and nothing else. Because the displacement is a pure function
 * of vertex POSITION, the duplicated vertices along a seam all move together
 * and the shell never splits.
 *
 * What the player should see, in order: paint dulls, panels crumple where they
 * were actually hit, glass goes milky, a tyre lets go, and then the engine
 * catches. The fire is the last warning, not the end -- see the fuse in
 * update().
 */

const SMOKE = 28;
const FLAME = 64;               // outer body of the flame
const CORE = 30;                // the bright base

/** Soft round sprite. One canvas, shared by both particle systems. */
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.62)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Crumple the shell around a contact point.
 *
 * `local` is the point in the mesh's own space. Vertices inside `radius` are
 * pushed along their own normal, which is what makes a crater rather than a
 * uniform shrink, and jittered a little so the panel reads as torn metal and
 * not as a smooth dish.
 */
function crumple(mesh, local, radius, depth, rng) {
  const pos = mesh.geometry.attributes.position;
  const nrm = mesh.geometry.attributes.normal;
  const r2 = radius * radius;
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - local.x;
    const dy = pos.getY(i) - local.y;
    const dz = pos.getZ(i) - local.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    // smoothstep falloff: a hard edge on the dent looks like a bite mark
    const t = 1 - Math.sqrt(d2) / radius;
    const k = t * t * (3 - 2 * t);
    /* Deterministic per-vertex jitter. Math.random() here would move the
       duplicated vertices of a shared seam by different amounts and tear a
       visible hole in the shell. */
    const j = 0.82 + 0.36 * rng(pos.getX(i), pos.getY(i), pos.getZ(i));
    const s = depth * k * j;
    pos.setXYZ(i,
      pos.getX(i) - nrm.getX(i) * s,
      pos.getY(i) - nrm.getY(i) * s,
      pos.getZ(i) - nrm.getZ(i) * s);
    touched++;
  }
  if (!touched) return false;
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  return true;
}

/** Hashed noise in [0,1) from a position. Stable for identical coordinates. */
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export class Damage {
  constructor(scene) {
    this.value = 0;
    this.dead = false;
    this.critical = false;
    this.fuse = 0;
    this.t = 0;
    this.parts = null;

    const tex = puffTexture();
    this.tex = tex;

    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(SMOKE * 3);
    this.life = new Float32Array(SMOKE);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x2a2a2c, size: 2.4, sizeAttenuation: true, map: tex,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    this.points = pts;

    /* The fire.
       Two additive point clouds and a light. The old fire was one orange
       sphere, which from the chase camera read as a traffic cone balanced on
       the bonnet. What makes a flame legible is that it is TALL, it MOVES, and
       it throws light on the bodywork around it -- so: particles that rise and
       cool through white -> yellow -> orange -> red -> out, a smaller hotter
       cloud at the base, and a point light that flickers with them. */
    /* Particle SIZE is the whole difference between a fire and an orange
       cloud. The first pass used 1.9m puffs: a dozen of them overlapping
       additively saturate straight to white and you get a glowing blob the
       size of a bus. Small and many reads as flame; large and few does not. */
    this.flame = this.#cloud(scene, FLAME, 0.85);
    this.core = this.#cloud(scene, CORE, 0.45);
    const light = new THREE.PointLight(0xff8420, 0, 34, 2);
    light.visible = false;
    scene.add(light);
    this.fireLight = light;

    // the fireball, reused
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true,
        opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
        toneMapped: false }),
    );
    ball.visible = false;
    scene.add(ball);
    this.ball = ball;
    this.blastT = 0;
    for (let i = 0; i < SMOKE; i++) this.life[i] = Math.random();
  }

  /** One additive, vertex-coloured particle cloud. */
  #cloud(scene, n, size) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size, sizeAttenuation: true, map: this.tex, vertexColors: true,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      toneMapped: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.visible = false;
    scene.add(p);
    // life and per-particle lateral drift, kept off the GPU
    return { points: p, pos, col, life: new Float32Array(n).map(() => Math.random()),
      vx: new Float32Array(n), vz: new Float32Array(n), n };
  }

  /**
   * Hand over the car's meshes so damage can actually mark them.
   *
   * Called once, after the hero is built. The original hull vertices are kept
   * so repair() can put the panels back -- without that, respawning would give
   * you a fresh car with the last one's crash still in the bodywork.
   */
  attach(hero) {
    const u = hero.userData;
    const { hull, glass } = u;
    if (!hull) return;
    this.parts = {
      hull,
      glass,
      wheels: u.wheels,
      pristine: hull.geometry.attributes.position.array.slice(),
      glassOpacity: glass ? glass.material.opacity : 0,
      glassRough: glass ? glass.material.roughness : 0,
    };
    this.dentCount = 0;
  }

  /** The garage puts it right: pristine hull, clear glass, round tyres, no fire. */
  repair() {
    const p = this.parts; if (!p) return;
    p.hull.geometry.attributes.position.array.set(p.pristine);
    p.hull.geometry.attributes.position.needsUpdate = true;
    if (p.glass) { p.glass.material.opacity = p.glassOpacity; p.glass.material.roughness = p.glassRough; }
    for (const w of p.wheels || []) w.flat = 0;
    this.value = 0; this.dead = false; this.critical = false; this.fuse = 0; this.dentCount = 0;
  }

  /**
   * `force` is closing speed in m/s, `at` the world contact point if the
   * collider knew one.
   *
   * Deliberately forgiving. One hard shunt used to take nearly a quarter of
   * the car's life and five would finish it, so a single bad corner wrote the
   * car off. A crash should cost you paint and power; it takes a sustained
   * beating to set one on fire.
   */
  hit(force, at = null) {
    if (force <= 1.8) return;                    // kerbs and taps do nothing
    const bite = Math.min(0.11, (force - 1.8) * 0.009);
    this.value = Math.min(1, this.value + bite);
    // a scrape along a wall reports every frame; one dent per 0.12 s is what the eye sees anyway
    if (at && this.t - (this.lastDent ?? -1) > 0.12) { this.lastDent = this.t; this.#dent(force, at); }
  }

  #dent(force, at) {
    const p = this.parts;
    if (!p || this.dentCount > 26) return;       // a shell has only so much give
    const local = p.hull.worldToLocal(new THREE.Vector3(at.x, 0.78, at.z));
    /* The contact point is on the hull's SURFACE, so a sphere centred there
       only catches the near skin -- which is what a dent is. */
    const depth = Math.min(0.15, 0.028 + (force - 1.8) * 0.012);
    const radius = 0.55 + Math.min(0.5, force * 0.028);
    if (crumple(p.hull, local, radius, depth, hash3)) this.dentCount++;
  }

  /**
   * Change the car's paint. The soot pass rewrites paint.color from basePaint
   * every frame, so writing paint.color directly is undone before it is ever
   * drawn -- which is why a stolen car kept your old colour. Set the base.
   */
  setPaint(hex) {
    if (this.basePaint === undefined) this.basePaint = new THREE.Color();
    this.basePaint.setHex(hex);
  }

  repair() {
    this.value = 0;
    this.dead = false;
    this.fuse = 0;
    this.critical = false;
    this.points.visible = false;
    this.flame.points.visible = false;
    this.core.points.visible = false;
    this.fireLight.visible = false;
    this.fireLight.intensity = 0;

    const p = this.parts;
    if (!p) return;
    this.dentCount = 0;
    p.hull.geometry.attributes.position.array.set(p.pristine);
    p.hull.geometry.attributes.position.needsUpdate = true;
    p.hull.geometry.computeVertexNormals();
    if (p.glass) {
      p.glass.material.opacity = p.glassOpacity;
      p.glass.material.roughness = p.glassRough;
      p.glass.material.color.setHex(0x2a3a4c);
    }
    for (const w of p.wheels) {
      w.flat = 0;
      w.spin.scale.set(1, 1, 1);
    }
  }

  /** True once the engine is alight and the countdown has started. */
  get burning() { return this.critical; }
  get secondsLeft() { return Math.max(0, this.fuse); }

  /**
   * Applies the current state to the car and its paint, and returns true on
   * the frame the engine finally gives up.
   */
  update(car, paint, dt) {
    this.t += dt;
    const d = this.value;

    if (paint) {
      // clearcoat is the first thing to go on a car that has been used hard
      paint.roughness = 0.22 + d * 0.55;
      paint.clearcoat = Math.max(0, 1 - d * 1.1);
      paint.metalness = 0.62 - d * 0.35;
      /* Soot. Stripping gloss ALONE made the wreck brighter than the clean
         car -- a rough dielectric in daylight is close to white -- so the
         panels have to be dragged down towards charcoal as well. */
      if (this.basePaint === undefined) this.basePaint = paint.color.clone();
      paint.color.copy(this.basePaint).multiplyScalar(1 - d * 0.62);
    }

    this.#wear(d);

    // a hurt engine will not pull: this is felt long before it is seen
    car.damageTorqueScale = 1 - d * 0.55;

    /* Smoke is the WARNING, and it stops being the story the moment there are
       flames -- a burning car seen through its own soot is just a grey smudge.
       So once it is alight the plume thins right out and rides high, above the
       fire rather than through it. */
    const smoking = d > 0.45;
    this.points.visible = smoking;
    if (smoking) {
      const rate = (d - 0.45) / 0.55;
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      const lift = this.critical ? 2.6 : 0.95;
      for (let i = 0; i < SMOKE; i++) {
        this.life[i] -= dt * (0.5 + rate * 0.8);
        if (this.life[i] <= 0) {
          this.life[i] = 1;
          // reborn at the bonnet, then it drifts back over the roof
          this.pos[i * 3] = car.x + cy * 1.9 + (Math.random() - 0.5) * 0.6;
          this.pos[i * 3 + 1] = lift;
          this.pos[i * 3 + 2] = car.z - sy * 1.9 + (Math.random() - 0.5) * 0.6;
        } else {
          this.pos[i * 3] -= cy * dt * 3.0;
          this.pos[i * 3 + 1] += dt * (1.4 + rate);
          this.pos[i * 3 + 2] += sy * dt * 3.0;
        }
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.material.opacity = this.critical
        ? 0.16                                   // a hint of soot, nothing more
        : 0.2 + rate * 0.45;
      this.points.material.color.setHex(this.critical ? 0x6a6a70 : 0x2a2a2c);
    }

    /* Critical, then a fuse.
       The car does NOT throw you out. It tells you it is going to go, and how
       long you have; staying in is a decision, and it is the decision that
       kills you. */
    if (d >= 0.86 && !this.critical) { this.critical = true; this.fuse = 7.5; }

    if (this.critical && !this.dead) {
      this.fuse -= dt;
      this.#burn(car, dt);
      if (this.fuse <= 0) { this.dead = true; return true; }
    }

    // the blast, once triggered
    if (this.blastT > 0) {
      this.blastT -= dt;
      const k = 1 - this.blastT / 0.9;
      /* A car fire, not an airstrike. At a 10m radius the sphere subtended
         most of the screen from the chase camera and turned the whole frame
         orange -- you could not see the thing that had just killed you. */
      this.ball.scale.setScalar(1.1 + k * 3.4);
      this.ball.material.opacity = Math.max(0, 0.9 * (1 - k) * (1 - k));
      this.ball.visible = this.blastT > 0;
      this.fireLight.visible = true;
      this.fireLight.intensity = Math.max(0, 900 * (1 - k) * (1 - k));
      this.fireLight.position.copy(this.ball.position);
      if (this.blastT <= 0) { this.fireLight.visible = false; this.ball.visible = false; }
    }
    return false;
  }

  /** Panels, glass and rubber. Cosmetic, and all of it keyed off one number. */
  #wear(d) {
    const p = this.parts;
    if (!p) return;

    /* Laminated glass does not vanish, it goes white and stops being a window.
       Fading it to transparent instead would show the cabin MORE clearly the
       harder you crashed. */
    if (p.glass) {
      const shat = Math.max(0, (d - 0.5) / 0.5);
      p.glass.material.opacity = p.glassOpacity + shat * (0.94 - p.glassOpacity);
      p.glass.material.roughness = p.glassRough + shat * 0.6;
      /* Smoke-stained, not bright white. Crazed laminate on a car that has
         just been on fire is grey; taking it to white put a clean roof on a
         charred wreck. */
      p.glass.material.color.setRGB(
        0.165 + shat * 0.30, 0.227 + shat * 0.26, 0.298 + shat * 0.21);
    }

    /* Tyres let go one at a time, and always in the same order for a given
       car, so a wreck looks consistent rather than flickering between states
       as the damage number wobbles. */
    for (let i = 0; i < p.wheels.length; i++) {
      const w = p.wheels[i];
      const threshold = 0.62 + i * 0.09;
      const flat = d >= threshold ? Math.min(1, (d - threshold) / 0.12) : 0;
      if (flat === w.flat) continue;
      w.flat = flat;
      /* Only the RUBBER deflates. Squashing the whole `spin` group shrank the
         rim and brake disc with it, so a flat tyre read as a smaller wheel
         rather than a burst one. The car settling onto it is a ride-height
         change, and that is applied in main.js where the suspension is. */
      w.tyre.scale.set(1, 1 - flat * 0.46, 1 + flat * 0.26);
    }
  }

  /** Advance the flame. `car` gives it somewhere to sit. */
  #burn(car, dt) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    // the bonnet, then licking back over the screen as it gets worse
    const heat = 1 - Math.max(0, this.fuse) / 7.5;
    const bx = car.x + cy * (1.75 - heat * 0.5);
    const bz = car.z - sy * (1.75 - heat * 0.5);

    this.#advance(this.flame, dt, bx, bz, 0.40, 1.5 + heat * 0.9, 0.72, heat);
    this.#advance(this.core, dt, bx, bz, 0.20, 0.8 + heat * 0.4, 1.5, heat);

    /* Flicker. Two detuned sines beat against each other, which gives an
       irregular pulse -- one sine alone reads as a strobe. */
    const f = 0.62 + Math.sin(this.t * 17) * 0.2 + Math.sin(this.t * 6.3) * 0.18;
    this.fireLight.position.set(bx, 1.3, bz);
    this.fireLight.intensity = (55 + heat * 90) * f;
    this.fireLight.visible = true;
  }

  /**
   * One cloud, one step. Particles are born in a disc at the base, rise,
   * wander, and cool along the flame ramp; `hot` biases the whole cloud
   * towards white as the fuse runs down.
   */
  #advance(c, dt, bx, bz, spread, height, speed, hot) {
    for (let i = 0; i < c.n; i++) {
      c.life[i] -= dt * speed;
      const o = i * 3;
      if (c.life[i] <= 0) {
        c.life[i] = 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        c.pos[o] = bx + Math.cos(a) * r;
        c.pos[o + 1] = 0.82;
        c.pos[o + 2] = bz + Math.sin(a) * r;
        c.vx[i] = (Math.random() - 0.5) * 0.5;
        c.vz[i] = (Math.random() - 0.5) * 0.5;
      } else {
        const age = 1 - c.life[i];
        // fire accelerates upward as it becomes buoyant, and spreads as it cools
        c.pos[o + 1] += dt * height * (0.5 + age);
        c.pos[o] += c.vx[i] * dt * (0.4 + age * 1.6);
        c.pos[o + 2] += c.vz[i] * dt * (0.4 + age * 1.6);
      }
      /* The colour ramp IS the flame. Additive blending means a dark colour is
         an invisible particle, so the fade to black at the top of the ramp is
         what gives the plume its soft edge -- no alpha needed. */
      const a = 1 - c.life[i];
      const white = Math.max(0, 1 - a * 4.2) * (0.16 + hot * 0.24);
      const body = Math.max(0, 1 - a * 1.3);
      c.col[o] = Math.min(1.15, body * 1.05 + white);
      c.col[o + 1] = Math.max(0, body * body * 0.52 + white * 0.9);
      c.col[o + 2] = Math.max(0, body * body * body * 0.10 + white * 0.72);
    }
    c.points.geometry.attributes.position.needsUpdate = true;
    c.points.geometry.attributes.color.needsUpdate = true;
    c.points.visible = true;
  }

  /** Set it off where the car is standing. */
  explode(x, z) {
    this.blastT = 0.9;
    this.ball.position.set(x, 1.2, z);
    this.ball.visible = true;
    this.flame.points.visible = false;
    this.core.points.visible = false;
    this.critical = false;
  }
}
