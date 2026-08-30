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
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, toneMapped: false }),
    );
    flash.visible = false;
    scene.add(flash);
    this.flash = flash;

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
      if (this.flashFor <= 0) { this.flash.visible = false; this.tracer.visible = false; }
    }
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
    this.flash.position.set(ox + dx * 0.6, oy + dy * 0.6, oz + dz * 0.6);
    this.flash.visible = true;
    const p = this.tracer.geometry.attributes.position;
    p.setXYZ(0, ox + dx * 0.8, oy + dy * 0.8, oz + dz * 0.8);
    p.setXYZ(1, ox + dx * end, oy + dy * end, oz + dz * end);
    p.needsUpdate = true;
    this.tracer.visible = true;
    this.flashFor = 0.055;

    return hit;
  }
}
