import * as THREE from 'three';
import { ARSENAL, spreadFor, heatAfterShot, heatAfterRest } from './weapons.js';

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

/* Range and rate now come from ARSENAL per weapon (game/weapons.js). These
   remain only as the fallback for a weapon id that does not exist. */
const RANGE = 90;
const COOLDOWN = 0.16;
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Weapon {
  constructor(scene) {
    this.cool = 0;
    this.flashFor = 0;
    /* Handling state. `heat` is the accumulated spread from firing, 0..1; it
       is what separates holding the trigger from squeezing it. `kick` is the
       camera recoil the frame loop reads and decays -- the gun does not own
       the camera, it just reports how hard it just pushed. */
    this.kind = 'pistol';
    this.ammo = ARSENAL.pistol.mag;
    this.heat = 0;
    this.reloadT = 0;
    this.kick = 0;
    this.shake = 0;

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

    /* Body hits: a second, smaller pool in dark red with NORMAL blending -- an
       additive red on a dark street reads as orange sparks, which is the wrong
       message. Same shape as the sparks so update() ticks both with one loop. */
    const BLOOD = 18;
    const bloodGeo = new THREE.BufferGeometry();
    this.bloodPos = new Float32Array(BLOOD * 3);
    this.bloodVel = new Float32Array(BLOOD * 3);
    this.bloodLife = new Float32Array(BLOOD);
    for (let i = 0; i < BLOOD; i++) this.bloodPos[i * 3 + 1] = -100;
    bloodGeo.setAttribute('position', new THREE.BufferAttribute(this.bloodPos, 3));
    this.bloodGeo = bloodGeo;
    const blood = new THREE.Points(bloodGeo, new THREE.PointsMaterial({ color: 0x6e0f14, size: 0.11, transparent: true, opacity: 0.85, depthWrite: false }));
    blood.frustumCulled = false;
    scene.add(blood);
    this.blood = blood;
  }

  /** A puff at a body hit, thrown along the shot with a little spread and a drop. */
  bloodAt(x, y, z, dx, dz) {
    const n = this.bloodLife.length;
    for (let i = 0; i < n; i++) {
      this.bloodPos[i * 3] = x; this.bloodPos[i * 3 + 1] = y; this.bloodPos[i * 3 + 2] = z;
      this.bloodVel[i * 3] = dx * (1.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.8;
      this.bloodVel[i * 3 + 1] = 0.6 + Math.random() * 1.6;
      this.bloodVel[i * 3 + 2] = dz * (1.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.8;
      this.bloodLife[i] = 0.28 + Math.random() * 0.22;
    }
    this.bloodGeo.attributes.position.needsUpdate = true;
  }

  /** Swap weapon. Reloads are cancelled: you are drawing a different gun. */
  switchTo(kind) {
    if (!ARSENAL[kind] || kind === this.kind) return false;
    this.kind = kind;
    this.ammo = ARSENAL[kind].mag;
    this.reloadT = 0;
    this.heat = 0;
    this.cool = 0.25;                 // the draw itself takes a beat
    return true;
  }

  cycle(dir = 1) {
    const ks = Object.keys(ARSENAL);
    const i = ks.indexOf(this.kind);
    return this.switchTo(ks[(i + dir + ks.length) % ks.length]);
  }

  reload() {
    const w = ARSENAL[this.kind];
    if (this.reloadT > 0 || this.ammo >= w.mag) return false;
    this.reloadT = w.reload;
    return true;
  }

  get spec() { return ARSENAL[this.kind] ?? ARSENAL.pistol; }
  get reloading() { return this.reloadT > 0; }
  get magSize() { return this.spec.mag; }

  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    // spread recovers whenever you are not firing; recoil always decays
    this.heat = heatAfterRest(this.kind, this.heat, dt);
    this.kick *= Math.max(0, 1 - dt * 7);
    this.shake *= Math.max(0, 1 - dt * 9);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; this.ammo = this.spec.mag; }
    }
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
    // blood ticks the same way, falls faster, and parks underground when spent
    const bp = this.bloodPos;
    for (let i = 0; i < this.bloodLife.length; i++) {
      if (this.bloodLife[i] > 0) {
        this.bloodLife[i] -= dt;
        bp[i * 3] += this.bloodVel[i * 3] * dt;
        bp[i * 3 + 1] += this.bloodVel[i * 3 + 1] * dt;
        bp[i * 3 + 2] += this.bloodVel[i * 3 + 2] * dt;
        this.bloodVel[i * 3 + 1] -= 9.8 * dt * 0.8;
      } else bp[i * 3 + 1] = -100;
    }
    this.bloodGeo.attributes.position.needsUpdate = true;
  }

  get ready() { return this.cool <= 0 && this.reloadT <= 0 && this.ammo > 0; }

  /**
   * `targets` is [{ x, z, y?, r, ref }]. Returns the nearest one the ray
   * passes within `r` of, or null.
   */
  fire(ox, oy, oz, dx, dy, dz, targets) {
    if (!this.ready) {
      // empty magazine is not a dead trigger: it starts the reload for you
      if (this.ammo <= 0 && this.reloadT <= 0) this.reload();
      return null;
    }
    const w = this.spec;
    this.cool = w.cooldown ?? COOLDOWN;
    this.ammo = Math.max(0, this.ammo - 1);
    const range = w.range ?? RANGE;

    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;

    /* Spread, applied per pellet in the plane normal to the shot. One ray for
       a rifle, eight for a shotgun -- the same loop either way, which is why
       buckshot needed no special case. The nearest thing any pellet touches is
       what the caller is told about. */
    _dir.set(dx, dy, dz);
    _side.crossVectors(_dir, _up);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    const upv = new THREE.Vector3().crossVectors(_side, _dir).normalize();
    const cone = spreadFor(this.kind, this.heat);
    const pellets = Math.max(1, w.pellets | 0);

    let hit = null, hitT = range;
    for (let s = 0; s < pellets; s++) {
      let rx = dx, ry = dy, rz = dz;
      if (cone > 0) {
        const a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * cone;
        rx += (_side.x * Math.cos(a) + upv.x * Math.sin(a)) * m;
        ry += (_side.y * Math.cos(a) + upv.y * Math.sin(a)) * m;
        rz += (_side.z * Math.cos(a) + upv.z * Math.sin(a)) * m;
        const l = Math.hypot(rx, ry, rz) || 1; rx /= l; ry /= l; rz /= l;
      }
      for (const t of targets) {
        const px = t.x - ox, py = (t.y ?? 0.9) - oy, pz = t.z - oz;
        const along = px * rx + py * ry + pz * rz;
        if (along < 1.2 || along > hitT) continue;
        const cx = px - rx * along, cy = py - ry * along, cz = pz - rz * along;
        if (Math.hypot(cx, cy, cz) > t.r) continue;
        hitT = along; hit = t;
      }
    }

    this.heat = heatAfterShot(this.kind, this.heat);
    this.kick = w.recoil ?? 0.02;
    this.shake = w.shake ?? 0.3;
    if (this.ammo <= 0) this.reload();

    const end = hit ? hitT : range;
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
