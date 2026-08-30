import * as THREE from 'three';

/**
 * Wear on the car.
 *
 * No mesh deformation -- the hull is a lofted surface and denting it properly
 * would mean rebuilding it every impact. What a damage model actually has to
 * do is make consequences accumulate: the paint goes, the engine loses its
 * edge, smoke starts, and eventually the thing dies and you are on foot in the
 * middle of whatever you were running from. All of that is state plus a
 * particle system, and none of it needs a new vertex.
 */

const SMOKE = 28;

export class Damage {
  constructor(scene) {
    this.value = 0;
    this.dead = false;
    this.critical = false;
    this.fuse = 0;
    this.t = 0;

    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(SMOKE * 3);
    this.life = new Float32Array(SMOKE);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x2a2a2c, size: 2.4, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    this.points = pts;

    // flame under the bonnet once it goes critical: the visible warning
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true,
        opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
        toneMapped: false }),
    );
    fire.visible = false;
    scene.add(fire);
    this.fire = fire;

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

  /** `force` is closing speed in m/s at the moment of contact. */
  /**
   * `force` is closing speed in m/s.
   *
   * Deliberately forgiving. One hard shunt used to take nearly a quarter of
   * the car's life and five would finish it, so a single bad corner wrote the
   * car off. A crash should cost you paint and power; it takes a sustained
   * beating to set one on fire.
   */
  hit(force) {
    if (force <= 1.8) return;                    // kerbs and taps do nothing
    const bite = Math.min(0.11, (force - 1.8) * 0.009);
    this.value = Math.min(1, this.value + bite);
  }

  repair() {
    this.value = 0;
    this.dead = false;
    this.fuse = 0;
    this.critical = false;
    this.points.visible = false;
    this.fire.visible = false;
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
    }

    // a hurt engine will not pull: this is felt long before it is seen
    car.damageTorqueScale = 1 - d * 0.55;

    const smoking = d > 0.45;
    this.points.visible = smoking;
    if (smoking) {
      const rate = (d - 0.45) / 0.55;
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      for (let i = 0; i < SMOKE; i++) {
        this.life[i] -= dt * (0.5 + rate * 0.8);
        if (this.life[i] <= 0) {
          this.life[i] = 1;
          // reborn at the bonnet, then it drifts back over the roof
          this.pos[i * 3] = car.x + cy * 1.9 + (Math.random() - 0.5) * 0.6;
          this.pos[i * 3 + 1] = 0.95;
          this.pos[i * 3 + 2] = car.z - sy * 1.9 + (Math.random() - 0.5) * 0.6;
        } else {
          this.pos[i * 3] -= cy * dt * 3.0;
          this.pos[i * 3 + 1] += dt * (1.4 + rate);
          this.pos[i * 3 + 2] += sy * dt * 3.0;
        }
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.material.opacity = 0.2 + rate * 0.45;
    }

    /* Critical, then a fuse.
       The car does NOT throw you out. It tells you it is going to go, and how
       long you have; staying in is a decision, and it is the decision that
       kills you. */
    if (d >= 0.86 && !this.critical) { this.critical = true; this.fuse = 7.5; }

    if (this.critical && !this.dead) {
      this.fuse -= dt;
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      const flick = 0.55 + Math.sin(this.t * 22) * 0.25 + Math.random() * 0.2;
      this.fire.position.set(car.x + cy * 1.75, 0.85, car.z - sy * 1.75);
      this.fire.scale.setScalar(flick * (1 + (7.5 - this.fuse) * 0.06));
      this.fire.material.opacity = 0.55 + Math.random() * 0.3;
      this.fire.visible = true;
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
    }
    return false;
  }

  /** Set it off where the car is standing. */
  explode(x, z) {
    this.blastT = 0.9;
    this.ball.position.set(x, 1.2, z);
    this.ball.visible = true;
    this.fire.visible = false;
    this.critical = false;
  }
}
