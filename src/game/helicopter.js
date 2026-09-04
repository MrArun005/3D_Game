import * as THREE from 'three';
import { M4, mergeGeos } from '../core/geometry.js';
import { hasLineOfSight } from './policeAi.js';

/**
 * Police air support.
 *
 * Turns up at three stars and changes what a pursuit means: on the ground you
 * can break line of sight by turning a corner, and the cars lose you. The
 * helicopter does not lose you, so while it is overhead the heat never bleeds
 * off -- you have to actually get away from it, or wait it out somewhere it
 * cannot see.
 *
 * It flies a lead-and-orbit: aim for where the car is going, not where it is,
 * and circle once it gets there. Chasing the current position produces a
 * machine that trails permanently behind and never gets ahead of you.
 */

/* Geometry, not taste.
   At 62m up and a 58m orbit the machine sits 43 degrees above the camera's
   centre line, while a chase camera pitched 7 degrees down with a 60 degree
   field of view can only see about 23 degrees up. It was permanently just
   off the top of the screen. Lower and further out puts it at roughly 22
   degrees -- inside the frame, against the buildings, where you see it. */
const ALTITUDE = 34;
const ORBIT = 84;
const SPEED = 46;                  // m/s flat out; a car will not outrun it
const CALLED_AT = 3;               // stars

export class Helicopter {
  constructor(scene, day = true) {
    this._car = new THREE.Vector3();   // per-frame scratch; never allocate inside update()
    this.day = day;
    this.live = false;
    this.landing = false;
    this.landed = false;
    this.sight = 0;
    this.t = 0;
    this.angle = 0;
    this.pos = new THREE.Vector3(0, ALTITUDE, 0);
    this.vel = new THREE.Vector3();

    const group = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x14202f, roughness: 0.5, metalness: 0.3 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xe6eaf0, roughness: 0.5 });

    group.add(new THREE.Mesh(hullGeometry(), dark));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.34, 0.06), trim);
    stripe.position.set(-0.2, 0.1, 1.02);
    group.add(stripe);
    const stripe2 = stripe.clone(); stripe2.position.z = -1.02;
    group.add(stripe2);

    // skids
    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.12), dark);
      skid.position.set(-0.1, -1.35, side * 0.85);
      group.add(skid);
      for (const at of [-0.9, 0.7]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), dark);
        leg.position.set(at, -0.98, side * 0.85);
        group.add(leg);
      }
    }

    // main rotor: four blades plus a disc, because four blades alone strobe
    const rotor = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.07, 0.42), dark);
      blade.rotation.y = (i / 4) * Math.PI * 2;
      rotor.add(blade);
    }
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(5.9, 28),
      new THREE.MeshBasicMaterial({ color: 0x8fa0b4, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    rotor.add(disc);
    rotor.position.set(-0.1, 1.5, 0);
    group.add(rotor);
    this.rotor = rotor;

    const tail = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.22), dark);
      blade.rotation.x = (i / 3) * Math.PI * 2;
      tail.add(blade);
    }
    tail.position.set(-5.3, 0.55, 0.22);
    group.add(tail);
    this.tail = tail;

    /* The searchlight is two things: a real spot so the beam actually lands on
       geometry, and an additive cone so the shaft is visible in the air. In
       daylight the cone is nearly invisible, which is correct. */
    const spot = new THREE.SpotLight(0xf2f6ff, day ? 120 : 900, 190, 0.20, 0.55, 1.3);
    spot.position.set(0, -1.2, 0);
    group.add(spot, spot.target);
    this.spot = spot;

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true,
        opacity: day ? 0.05 : 0.14, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide }),
    );
    this.cone = cone;
    scene.add(cone);

    /* The pool on the road is the part you notice without looking up at all,
       so in daylight it has to be strong enough to read against tarmac. */
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true,
        opacity: day ? 0.30 : 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    this.pool = pool;
    scene.add(pool);

    group.visible = false;
    cone.visible = false;
    pool.visible = false;
    scene.add(group);
    this.group = group;
  }

  /**
   * Somewhere it can actually sit: open tarmac, clear of buildings. Spiral
   * outwards from the player so the machine comes down somewhere you can
   * plausibly walk to rather than three districts away.
   */
  #findPad(car) {
    const d = this.district;
    if (!d) return { x: car.x, z: car.z };
    for (let r = 14; r <= 90; r += 12) {
      for (let a = 0; a < 12; a++) {
        const th = (a / 12) * Math.PI * 2 + r;
        const x = car.x + Math.cos(th) * r, z = car.z + Math.sin(th) * r;
        // on the carriageway and not inside anything solid
        if (d.roadDepth(x, z) > -3) continue;
        const boxes = this.nearbyBuildings ? this.nearbyBuildings(x, z) : [];
        let clear = true;
        for (const b of boxes) {
          const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
          const rx = x - b.x, rz = z - b.z;
          const lx = rx * ca + rz * sa, lz = -rx * sa + rz * ca;
          if (Math.abs(lx) < b.hw + 7 && Math.abs(lz) < b.hd + 7) { clear = false; break; }
        }
        if (clear) return { x, z };
      }
    }
    return { x: car.x, z: car.z };
  }

  /** Take it. Returns false if it is still in the air. */
  board() {
    if (!this.landed) return false;
    this.live = false;
    this.landing = false;
    this.landed = false;
    this.group.visible = false;
    return true;
  }

  /**
   * True while it can actually SEE the player.
   *
   * This used to be a bare distance test, and the machine orbits at about 91
   * metres -- permanently inside 240 -- so it latched true the moment it
   * arrived and the wanted level could never decay again above three stars.
   * The docstring promised you could "wait it out somewhere it cannot see";
   * this is the code that was missing behind that sentence.
   */
  get eyesOn() { return this.live && this.sight > 0; }

  /** Sample the line down to the car for anything tall in the way. */
  /* The same line-of-sight rule the officers use (policeAi.hasLineOfSight):
     an exact slab test against the buildings around the car, one lookup
     instead of up to 23 sampled ones with their own rotate-into-box maths that
     had drifted from the officers' (opposite angle sign). The searchlight and
     the door gunner now agree on what 'seen' means. */
  #lineOfSight(car) {
    if (!this.nearbyBuildings) return true;
    return hasLineOfSight(this.pos.x, this.pos.y, this.pos.z, car.x, (car.y ?? 0) + 0.9, car.z, this.nearbyBuildings(car.x, car.z), [], null);
  }

  update(car, traffic, dt) {
    // scratch vector hoisted out of the frame path (allocation guard test)
    this._car.set(car.x, 0, car.z);
    const want = traffic.wanted >= CALLED_AT;

    /* Landing.
       It used to simply vanish when the heat cleared, which meant the one
       machine in the city you might actually want was permanently out of
       reach. Now it puts down where it is and waits, rotors turning, until
       you either take it or leave. */
    if (!want && this.live && !this.landing) {
      this.landing = true;
      this.pad = this.#findPad(car);
    }
    if (this.landing) {
      this.t += dt;
      // fly to the pad first, then put down; descending wherever it happened
      // to be parked it inside a building, where boarding was impossible
      const pad = this.pad ?? { x: this.pos.x, z: this.pos.z };
      const dxp = pad.x - this.pos.x, dzp = pad.z - this.pos.z;
      const far = Math.hypot(dxp, dzp);
      if (far > 3) {
        const sp = Math.min(26, far * 1.2);
        this.vel.x += ((dxp / far) * sp - this.vel.x) * Math.min(1, dt * 1.6);
        this.vel.z += ((dzp / far) * sp - this.vel.z) * Math.min(1, dt * 1.6);
        this.pos.y += (14 - this.pos.y) * Math.min(1, dt * 0.7);
      } else {
        this.vel.multiplyScalar(Math.max(0, 1 - dt * 3.2));
        this.pos.y += (1.15 - this.pos.y) * Math.min(1, dt * 0.9);
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.group.position.copy(this.pos);
      this.group.rotation.set(0, this.group.rotation.y, 0);
      this.rotor.rotation.y += dt * (this.pos.y < 2 ? 10 : 26);
      this.tail.rotation.x += dt * (this.pos.y < 2 ? 14 : 40);
      this.cone.visible = false;
      this.pool.visible = false;
      this.spot.intensity = 0;
      this.landed = this.pos.y < 1.6;
      return;
    }

    if (want && !this.live) {
      // arrive from off to one side, not out of thin air over your roof
      this.live = true;
      this.angle = Math.atan2(-car.vz, car.vx) + Math.PI;
      this.pos.set(car.x + Math.cos(this.angle) * 320, ALTITUDE, car.z + Math.sin(this.angle) * 320);
      this.vel.set(0, 0, 0);
      this.group.visible = true;
      this.cone.visible = true;
      this.pool.visible = true;
      this.landing = false;
      this.landed = false;
      this.spot.intensity = this.day ? 120 : 900;
      if (this.onArrive) this.onArrive();
    }
    if (!this.live) return;

    /* Sight decays rather than switching: a moment behind one tower should
       not reset the pursuit, but four seconds out of view should. */
    const seen = this.#lineOfSight(car)
      && Math.hypot(car.x - this.pos.x, car.z - this.pos.z) < 240;
    this.sight = seen ? 1 : Math.max(0, (this.sight ?? 1) - dt / 4);

    this.t += dt;
    // lead the car, then orbit the lead point
    const lead = 1.6;
    const tx = car.x + car.vx * lead, tz = car.z + car.vz * lead;
    const gap = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    let aimX, aimZ;
    if (gap > ORBIT * 1.4) {
      aimX = tx; aimZ = tz;                          // still closing
    } else {
      this.angle += dt * 0.42;                       // on station: circle
      aimX = tx + Math.cos(this.angle) * ORBIT;
      aimZ = tz + Math.sin(this.angle) * ORBIT;
    }

    const dx = aimX - this.pos.x, dz = aimZ - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const cruise = Math.min(SPEED, d * 1.3);
    const wantVx = (dx / d) * cruise, wantVz = (dz / d) * cruise;
    const ax = (wantVx - this.vel.x) * 1.4, az = (wantVz - this.vel.z) * 1.4;
    this.vel.x += ax * dt;
    this.vel.z += az * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += (ALTITUDE + Math.sin(this.t * 0.6) * 2.2 - this.pos.y) * Math.min(1, dt * 1.4);

    // nose into the flight path, bank into the turn
    const heading = Math.atan2(-this.vel.z, this.vel.x);
    const lateral = (-ax * Math.sin(heading) - az * Math.cos(heading));
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, heading, 0);
    this.group.rotateZ(Math.max(-0.5, Math.min(0.5, lateral * 0.035)));
    this.group.rotateX(-Math.min(0.16, this.vel.length() * 0.003));

    this.rotor.rotation.y += dt * 34;
    this.tail.rotation.x += dt * 52;

    // searchlight, held on the car
    this.spot.target.position.set(car.x - this.pos.x, -this.pos.y, car.z - this.pos.z);
    this.spot.target.updateMatrixWorld();
    const h = this.pos.y;
    const beam = Math.hypot(car.x - this.pos.x, car.z - this.pos.z, h);
    this.cone.position.set((this.pos.x + car.x) / 2, h / 2, (this.pos.z + car.z) / 2);
    this.cone.scale.set(3.4, beam, 3.4);
    this.cone.lookAt(car.x, 0, car.z);
    this.cone.rotateX(-Math.PI / 2);
    this.pool.position.set(car.x, 0.06, car.z);
    const s = 4 + beam * 0.05;
    this.pool.scale.set(s, s, 1);
  }
}

/** Fuselage: a nose, a cabin, a tapering tail boom, a fin. */
function hullGeometry() {
  const parts = [];
  const cabin = new THREE.SphereGeometry(1.5, 12, 9);
  cabin.applyMatrix4(M4(0, 0, 0, 0, 0, 0, 1.5, 0.95, 1));
  parts.push(cabin);
  const nose = new THREE.SphereGeometry(1.05, 10, 8);
  nose.applyMatrix4(M4(1.85, -0.16, 0, 0, 0, 0, 1.2, 0.8, 0.92));
  parts.push(nose);
  const boom = new THREE.CylinderGeometry(0.22, 0.44, 4.4, 8);
  boom.applyMatrix4(M4(-3.2, 0.45, 0, 0, 0, Math.PI / 2));
  parts.push(boom);
  const fin = new THREE.BoxGeometry(1.0, 1.5, 0.12);
  fin.applyMatrix4(M4(-5.3, 1.05, 0));
  parts.push(fin);
  const mast = new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8);
  mast.applyMatrix4(M4(-0.1, 1.1, 0));
  parts.push(mast);
  return mergeGeos(parts);
}
