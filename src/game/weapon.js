import * as THREE from 'three';

/**
 * Shooting, on foot and from the car.
 *
 * Hitscan, not projectiles: at pistol range over a 4km city the flight time of
 * a bullet is irrelevant and a travelling object would cost far more than the
 * ray it replaces. What sells it is the feedback -- a flash at the muzzle, a
 * tracer you can see, and something reacting at the far end.
 *
 * The gun does not know what a pedestrian or a police car is. It is handed a
 * list of candidates with a position and a radius, and reports what it hit;
 * deciding whether that is a crime is somebody else's job.
 */

const RANGE = 90;
const COOLDOWN = 0.16;

export class Weapon {
  constructor(scene) {
    this.cool = 0;
    this.flashFor = 0;

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, toneMapped: false }),
    );
    flash.visible = false;
    scene.add(flash);
    this.flash = flash;

    // Dynamic muzzle flash light
    this.light = new THREE.PointLight(0xffe080, 0, 16, 2);
    scene.add(this.light);

    // Impact spark particles
    const SPARK_COUNT = 24;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(SPARK_COUNT * 3);
    const sparkVel = new Float32Array(SPARK_COUNT * 3);
    const sparkLife = new Float32Array(SPARK_COUNT);
    for (let i = 0; i < SPARK_COUNT; i++) { sparkPos[i * 3 + 1] = -100; sparkLife[i] = 0; }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    this.sparkGeo = sparkGeo;
    this.sparkVel = sparkVel;
    this.sparkLife = sparkLife;
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffe270, size: 0.14, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.sparks = new THREE.Points(sparkGeo, sparkMat);
    scene.add(this.sparks);

    // one reused tracer: at this fire rate you never see two at once
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 0.9, toneMapped: false,
    }));
    tracer.frustumCulled = false;
    tracer.visible = false;
    scene.add(tracer);
    this.tracer = tracer;
  }

  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (this.flashFor > 0) {
      this.flashFor -= dt;
      if (this.flashFor <= 0) {
        this.flash.visible = false;
        this.tracer.visible = false;
        this.light.intensity = 0;
      }
    }
    // Update sparks
    const pos = this.sparkGeo.attributes.position.array;
    for (let i = 0; i < this.sparkLife.length; i++) {
      if (this.sparkLife[i] > 0) {
        this.sparkLife[i] -= dt;
        pos[i * 3] += this.sparkVel[i * 3] * dt;
        pos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        this.sparkVel[i * 3 + 1] -= 9.8 * dt * 0.5;
      } else {
        pos[i * 3 + 1] = -100;
      }
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
  }

  get ready() { return this.cool <= 0; }

  /**
   * `targets` is [{ x, z, y?, r, ref }]. Returns the nearest one the ray
   * passes within `r` of, or null.
   */
  fire(ox, oy, oz, dx, dy, dz, targets) {
    if (this.cool > 0) return null;
    this.cool = COOLDOWN;

    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;

    let hit = null, hitT = RANGE;
    for (const t of targets) {
      const px = t.x - ox, py = (t.y ?? 0.9) - oy, pz = t.z - oz;
      const along = px * dx + py * dy + pz * dz;
      if (along < 1.2 || along > hitT) continue;
      const cx = px - dx * along, cy = py - dy * along, cz = pz - dz * along;
      if (Math.hypot(cx, cy, cz) > t.r) continue;
      hitT = along; hit = t;
    }

    const end = hit ? hitT : RANGE;
    const fx = ox + dx * 0.6, fy = oy + dy * 0.6, fz = oz + dz * 0.6;
    this.flash.position.set(fx, fy, fz);
    this.flash.visible = true;
    this.light.position.set(fx, fy, fz);
    this.light.intensity = 4.5;

    const p = this.tracer.geometry.attributes.position;
    p.setXYZ(0, ox + dx * 0.8, oy + dy * 0.8, oz + dz * 0.8);
    p.setXYZ(1, ox + dx * end, oy + dy * end, oz + dz * end);
    p.needsUpdate = true;
    this.tracer.visible = true;
    this.flashFor = 0.055;

    // Spawn impact spark burst at hit point
    const hx = ox + dx * end, hy = oy + dy * end, hz = oz + dz * end;
    const spos = this.sparkGeo.attributes.position.array;
    for (let i = 0; i < this.sparkLife.length; i++) {
      spos[i * 3] = hx;
      spos[i * 3 + 1] = hy;
      spos[i * 3 + 2] = hz;
      this.sparkVel[i * 3] = -dx * (2 + Math.random() * 4) + (Math.random() - 0.5) * 6;
      this.sparkVel[i * 3 + 1] = 1.5 + Math.random() * 4.0;
      this.sparkVel[i * 3 + 2] = -dz * (2 + Math.random() * 4) + (Math.random() - 0.5) * 6;
      this.sparkLife[i] = 0.22 + Math.random() * 0.18;
    }

    return hit;
  }
}
