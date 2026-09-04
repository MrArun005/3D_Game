import * as THREE from 'three';
import { buildOfficer, PoseBlender, lookAt } from '../world/officer.js';
import { buildWeaponMesh, ARSENAL } from './weapons.js';
import { roadblockPosts, aimJitter, burstFor, hasLineOfSight, shotLands, targetProfile } from './policeAi.js';

/**
 * Roadblocks. At three stars and above the police stop chasing you and start
 * getting in front of you: two cruisers nose-to-nose across the road ~170 m
 * ahead on your heading, a spike strip between them. Drive through the strip
 * and every tyre goes flat; the cruisers are solid to the hull collider via
 * the chunk's parked-car registry. A block lives 45 s or until you are 250 m
 * past it, then the next one can go up 30 s later.
 */
const LIFE = 45, COOLDOWN = 30, AHEAD = 170;

export class Roadblock {
  constructor(scene, assets, district, world, traffic, hero) {
    this.scene = scene; this.assets = assets; this.district = district; this.world = world; this.traffic = traffic; this.hero = hero;
    this.block = null; this.cooldown = 8;
    const kit = assets.geo.stunt.police ?? assets.geo.stunt.sedan;
    this.cars = [0, 1].map(() => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(kit.body, new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4, metalness: 0.2 }));
      g.add(body);
      if (kit.detail && kit.detailMat) g.add(new THREE.Mesh(kit.detail, kit.detailMat));
      // light bar
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 1.1), new THREE.MeshStandardMaterial({ color: 0x102040, emissive: 0x3a7bff, emissiveIntensity: 4 }));
      bar.position.set(-0.2, 1.62, 0); g.add(bar); g.userData.bar = bar;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.visible = false; scene.add(g); return g;
    });
    this.strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, emissive: 0xff7a1a, emissiveIntensity: 1.6, roughness: 0.7 }));
    this.strip.visible = false; scene.add(this.strip);
    /* Two riflemen behind the cruisers. Built once, hidden until a block is
       raised; they crouch behind the cars, peek to fire three-round bursts
       with a line of sight, and can be shot back at (main hands them in as
       targets). Seeds 70/71 so they are the same two faces every time. */
    this.posts = [0, 1].map((i) => {
      const b = buildOfficer(70 + i);
      const gun = buildWeaponMesh('rifle'); gun.position.set(0, -0.58, 0); gun.rotation.z = -Math.PI / 2; b.joints.armR.add(gun);
      b.group.visible = false; scene.add(b.group);
      return { group: b.group, joints: b.joints, blender: new PoseBlender(), gun, hp: 100, down: 0, fireT: 1 + i, burst: 0, poseT: 0, pose: 'crouch' };
    });
  }

  /** The riflemen as weapon targets while a block is up. */
  targets(out) {
    if (!this.block) return;
    for (const p of this.posts) if (p.down <= 0) out.push({ x: p.group.position.x, z: p.group.position.z, y: p.group.position.y + 0.8, r: 0.36, kind: 'officer', ref: p });
  }

  /** A player round hit a rifleman; two rifle rounds put him down. Returns true when he drops. */
  hitPost(p, damage = 26) {
    if (!p || p.down > 0) return false;
    p.hp -= damage;
    if (p.hp <= 0) { p.down = 0.001; this.traffic.chatter?.radioPool?.('down'); return true; }
    return false;
  }

  #segmentAhead(car) {
    const px = car.x + Math.cos(car.yaw) * AHEAD, pz = car.z - Math.sin(car.yaw) * AHEAD;
    let best = null, bd = Infinity;
    for (const s of this.district.segments) {
      if (s.cls === 'freeway' || s.cls === 'ramp') continue;
      const vx = s.bx - s.ax, vz = s.bz - s.az, l2 = vx * vx + vz * vz; if (l2 < 900) continue;
      let t = ((px - s.ax) * vx + (pz - s.az) * vz) / l2; t = Math.max(0.15, Math.min(0.85, t));
      const qx = s.ax + vx * t, qz = s.az + vz * t, d = Math.hypot(qx - px, qz - pz);
      if (d < bd) { bd = d; best = { s, qx, qz, ux: vx / Math.sqrt(l2), uz: vz / Math.sqrt(l2) }; }
    }
    return bd < 60 ? best : null;
  }

  #raise(car) {
    const a = this.#segmentAhead(car); if (!a) return;
    const { s, qx, qz, ux, uz } = a; const nx = -uz, nz = ux, half = s.half;
    const y = this.district.elevationAt(qx, qz);
    const yaw = Math.atan2(-uz, ux);
    const solids = [];
    this.cars.forEach((g, i) => {
      const side = i ? 1 : -1, off = half * 0.42 * side;
      g.position.set(qx + nx * off, y, qz + nz * off);
      g.rotation.y = yaw + side * 0.35 + Math.PI / 2;
      g.visible = true;
      solids.push({ x: g.position.x, z: g.position.z, yaw: -(g.rotation.y), offsets: [-1.3, 0, 1.3], radius: 0.95, reach: 2.6, tag: 'police' });
    });
    this.strip.scale.set(1, 1, half * 2 * 0.86); this.strip.position.set(qx + ux * 3.2, y + 0.04, qz + uz * 3.2); this.strip.rotation.y = yaw; this.strip.visible = true;
    const key = Math.floor(qx / 256) + ',' + Math.floor(qz / 256);
    const list = this.world.parkedByChunk.get(key);
    if (list) list.push(...solids);
    this.block = { qx, qz, ux, uz, half, y, t: 0, key, solids, spiked: false };
    roadblockPosts(qx, qz, ux, uz, half).forEach((pt, i) => {
      const p = this.posts[i];
      p.group.position.set(pt.x, y, pt.z); p.group.rotation.y = -pt.yaw + Math.PI / 2;
      p.group.visible = true; p.hp = 100; p.down = 0; p.fireT = 1 + i; p.burst = 0; p.pose = 'crouch'; p.gun.visible = true;
    });
    this.traffic.hud?.flash?.('ROADBLOCK AHEAD');
  }

  #lower() {
    const b = this.block; if (!b) return;
    for (const g of this.cars) g.visible = false; this.strip.visible = false;
    for (const p of this.posts) p.group.visible = false;
    const list = this.world.parkedByChunk.get(b.key);
    if (list) for (const s of b.solids) { const i = list.indexOf(s); if (i >= 0) list.splice(i, 1); }
    this.block = null; this.cooldown = COOLDOWN;
  }

  update(dt, car) {
    this.cooldown -= dt;
    const stars = this.traffic.wanted | 0;
    if (!this.block) { if (stars >= 3 && this.cooldown <= 0 && Math.abs(car.fwdSpeed) > 5) this.#raise(car); return; }
    const b = this.block; b.t += dt;
    const flash = Math.floor(b.t * 6) % 2;
    this.cars.forEach((g, i) => { g.userData.bar.material.emissiveIntensity = (flash ^ i) ? 5 : 0.3; g.userData.bar.material.emissive.setHex((flash ^ i) ? 0x3a7bff : 0xff3030); });
    // spikes: crossing the strip line at speed flattens every tyre
    const rx = car.x - (b.qx + b.ux * 3.2), rz = car.z - (b.qz + b.uz * 3.2);
    const along = rx * b.ux + rz * b.uz, across = Math.abs(rx * (-b.uz) + rz * b.ux);
    if (!b.spiked && Math.abs(along) < 1.2 && across < b.half * 0.86 && Math.abs(car.fwdSpeed) > 3) {
      b.spiked = true;
      for (const w of this.hero.userData.wheels || []) w.flat = 1;
      this.traffic.reportCrime('police', 4);
      this.traffic.hud?.flash?.('SPIKED · TYRES GONE');
    }
    // the riflemen: crouch, peek, three-round bursts with a line of sight, down when hit
    const lvl = Math.max(3, stars);   // `stars` is the update()'s own read of the wanted level
    const prof = targetProfile(false, false);
    for (const p of this.posts) {
      p.poseT += dt;
      if (p.down > 0) { p.down += dt; p.blender.apply(p.joints, 'fall', Math.min(1, p.down / 0.6), dt, 0.1); p.gun.visible = false; continue; }
      const gx = p.group.position.x, gz = p.group.position.z, gy = p.group.position.y + 1.0;
      const gap = Math.hypot(car.x - gx, car.z - gz);
      const face = Math.atan2(-(car.z - gz), car.x - gx);
      const bldg = this.world?.nearbyBuildings ? this.world.nearbyBuildings(gx, gz) : [];
      const canSee = gap < 120 && hasLineOfSight(gx, gy, gz, car.x, prof.y, car.z, bldg, this.traffic.cars, null);
      p.fireT -= dt;
      if (canSee && p.fireT <= 0) {
        if (p.burst <= 0) p.burst = burstFor('rifle').shots;
        p.burst--;
        p.fireT = p.burst > 0 ? burstFor('rifle').gap : 1.2 + Math.random() * 1.0;
        p.pose = 'peek';
        const w = ARSENAL.rifle;
        const landed = shotLands(gx, gy, gz, car.x, prof.y, car.z, prof.r, aimJitter(lvl, gap, Math.abs(car.fwdSpeed ?? 0)) + w.restSpread, Math.random);
        this.traffic.onShot?.(gap, landed, w.damage, p.group.position, 'rifle');
      } else if (p.burst <= 0 && p.fireT < 0.6) p.pose = 'crouch';
      p.blender.apply(p.joints, p.pose, p.poseT, dt, 0.15);
      lookAt(p.joints, face - (-p.group.rotation.y + Math.PI / 2));
    }
    const past = along > 60 || Math.hypot(rx, rz) > 250;
    if (b.t > LIFE || (past && b.t > 6) || stars === 0) this.#lower();
  }
}
