import * as THREE from 'three';

/**
 * Street-level urban atmosphere & chaos:
 * 1. Manhole Sewer Steam Vents
 * 2. Explosive Fire Hydrants with 10m pressurized water geysers
 * 3. Swirling Wind Debris (flying newspapers & flyers)
 */
export class StreetLife {
  constructor(scene, district) {
    this.scene = scene;
    this.district = district;

    this.manholes = [];
    this.hydrants = [];
    this.activeGeysers = [];

    this.#buildManholeSteam();
    this.#buildHydrants();
    this.#buildWindDebris();
  }

  #buildManholeSteam() {
    // 16 manhole locations around main roads
    const STEAM_COUNT = 80;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(STEAM_COUNT * 3);
    const vel = new Float32Array(STEAM_COUNT * 3);
    const life = new Float32Array(STEAM_COUNT);

    for (let i = 0; i < STEAM_COUNT; i++) {
      pos[i * 3 + 1] = -100;
      life[i] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.steamGeo = geo;
    this.steamVel = vel;
    this.steamLife = life;

    // Soft puff canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const rad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    rad.addColorStop(0, 'rgba(240, 245, 255, 0.55)');
    rad.addColorStop(0.5, 'rgba(220, 230, 245, 0.25)');
    rad.addColorStop(1, 'rgba(200, 210, 230, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);

    const mat = new THREE.PointsMaterial({
      map: tex,
      size: 2.2,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.steamMesh = new THREE.Points(geo, mat);
    this.scene.add(this.steamMesh);

    // Pick 12 manhole centers
    const roads = this.district?.data?.roads || [];
    let count = 0;
    for (const r of roads) {
      if (!r.points || r.points.length < 2) continue;
      for (let i = 0; i < r.points.length - 1; i += 3) {
        if (count >= 12) break;
        const p = r.points[i];
        this.manholes.push({ x: p[0] + 1.2, z: p[1] + 1.2 });
        count++;
      }
    }
  }

  #buildHydrants() {
    const hydrantGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.75, 10);
    hydrantGeo.translate(0, 0.375, 0);
    const topCap = new THREE.SphereGeometry(0.18, 8, 8);
    topCap.translate(0, 0.75, 0);

    const redMat = new THREE.MeshStandardMaterial({
      color: 0xcc1111,
      roughness: 0.35,
      metalness: 0.6,
    });

    const roads = this.district?.data?.roads || [];
    let count = 0;
    for (const r of roads) {
      if (!r.points || r.points.length < 2) continue;
      for (let i = 0; i < r.points.length - 1; i += 2) {
        if (count >= 24) break;
        const p1 = r.points[i], p2 = r.points[i + 1];
        const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L;

        // Place on pavement curb edge
        const cx = (p1[0] + p2[0]) / 2 + nx * (r.width / 2 + 0.8);
        const cz = (p1[1] + p2[1]) / 2 + nz * (r.width / 2 + 0.8);

        const group = new THREE.Group();
        const base = new THREE.Mesh(hydrantGeo, redMat);
        const top = new THREE.Mesh(topCap, redMat);
        group.add(base, top);
        group.position.set(cx, 0.15, cz);
        group.castShadow = true;
        this.scene.add(group);

        this.hydrants.push({ group, x: cx, z: cz, broken: false });
        count++;
      }
    }

    // Water geyser particles (96 droplets)
    const G_COUNT = 96;
    const gGeo = new THREE.BufferGeometry();
    const gPos = new Float32Array(G_COUNT * 3);
    const gVel = new Float32Array(G_COUNT * 3);
    const gLife = new Float32Array(G_COUNT);
    for (let i = 0; i < G_COUNT; i++) { gPos[i * 3 + 1] = -100; gLife[i] = 0; }
    gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
    this.geyserGeo = gGeo;
    this.geyserVel = gVel;
    this.geyserLife = gLife;

    const gMat = new THREE.PointsMaterial({
      color: 0xcee7ff,
      size: 0.35,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geyserMesh = new THREE.Points(gGeo, gMat);
    this.scene.add(this.geyserMesh);
  }

  #buildWindDebris() {
    // 32 fluttering paper newspapers & flyers
    const D_COUNT = 32;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(D_COUNT * 3);
    const vel = new Float32Array(D_COUNT * 3);

    for (let i = 0; i < D_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = 0.1 + Math.random() * 0.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
      vel[i * 3] = (Math.random() - 0.5) * 2.0;
      vel[i * 3 + 1] = 0;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.debrisGeo = geo;
    this.debrisVel = vel;

    const mat = new THREE.PointsMaterial({
      color: 0xf5f3e6,
      size: 0.3,
      transparent: true,
      opacity: 0.8,
    });
    this.debrisMesh = new THREE.Points(geo, mat);
    this.scene.add(this.debrisMesh);
  }

  update(dt, car) {
    // --- 1. Manhole Steam Update ---
    const sPos = this.steamGeo.attributes.position.array;
    for (let i = 0; i < this.steamLife.length; i++) {
      if (this.steamLife[i] > 0) {
        this.steamLife[i] -= dt * 0.7;
        sPos[i * 3] += this.steamVel[i * 3] * dt;
        sPos[i * 3 + 1] += this.steamVel[i * 3 + 1] * dt;
        sPos[i * 3 + 2] += this.steamVel[i * 3 + 2] * dt;
      } else if (this.manholes.length > 0 && Math.random() < 0.25) {
        const mh = this.manholes[i % this.manholes.length];
        sPos[i * 3] = mh.x + (Math.random() - 0.5) * 0.4;
        sPos[i * 3 + 1] = 0.12;
        sPos[i * 3 + 2] = mh.z + (Math.random() - 0.5) * 0.4;

        this.steamVel[i * 3] = (Math.random() - 0.5) * 0.6;
        this.steamVel[i * 3 + 1] = 1.6 + Math.random() * 1.4; // upward drift
        this.steamVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
        this.steamLife[i] = 1.0 + Math.random() * 0.8;
      } else {
        sPos[i * 3 + 1] = -100;
      }
    }
    this.steamGeo.attributes.position.needsUpdate = true;

    // --- 2. Fire Hydrant Collision & Water Geyser ---
    for (const h of this.hydrants) {
      if (!h.broken && Math.hypot(car.x - h.x, car.z - h.z) < 2.3) {
        h.broken = true;
        h.group.rotation.z = 1.3; // knocked over
        h.group.position.y = 0.1;
        this.activeGeysers.push({ x: h.x, z: h.z, t: 18.0 });
      }
    }

    // Geyser particles
    const gPos = this.geyserGeo.attributes.position.array;
    for (let i = 0; i < this.geyserLife.length; i++) {
      if (this.geyserLife[i] > 0) {
        this.geyserLife[i] -= dt * 1.5;
        gPos[i * 3] += this.geyserVel[i * 3] * dt;
        gPos[i * 3 + 1] += this.geyserVel[i * 3 + 1] * dt;
        gPos[i * 3 + 2] += this.geyserVel[i * 3 + 2] * dt;
        this.geyserVel[i * 3 + 1] -= 9.8 * dt * 1.8; // gravity drop
      } else if (this.activeGeysers.length > 0) {
        const gz = this.activeGeysers[i % this.activeGeysers.length];
        gPos[i * 3] = gz.x + (Math.random() - 0.5) * 0.5;
        gPos[i * 3 + 1] = 0.4;
        gPos[i * 3 + 2] = gz.z + (Math.random() - 0.5) * 0.5;

        this.geyserVel[i * 3] = (Math.random() - 0.5) * 3.5;
        this.geyserVel[i * 3 + 1] = 9.0 + Math.random() * 7.0; // 10m high blast!
        this.geyserVel[i * 3 + 2] = (Math.random() - 0.5) * 3.5;
        this.geyserLife[i] = 0.9 + Math.random() * 0.5;
      } else {
        gPos[i * 3 + 1] = -100;
      }
    }
    this.geyserGeo.attributes.position.needsUpdate = true;

    // --- 3. Wind Debris Swirl Near Car ---
    const dPos = this.debrisGeo.attributes.position.array;
    const speed = Math.abs(car.fwdSpeed || 0);
    for (let i = 0; i < dPos.length / 3; i++) {
      const px = dPos[i * 3], pz = dPos[i * 3 + 2];
      const dist = Math.hypot(car.x - px, car.z - pz);
      if (dist < 14 && speed > 10) {
        // Blown away by car draft
        this.debrisVel[i * 3] += (px - car.x) * dt * 4;
        this.debrisVel[i * 3 + 2] += (pz - car.z) * dt * 4;
      }
      dPos[i * 3] += this.debrisVel[i * 3] * dt;
      dPos[i * 3 + 2] += this.debrisVel[i * 3 + 2] * dt;
      this.debrisVel[i * 3] *= 0.96;
      this.debrisVel[i * 3 + 2] *= 0.96;
    }
    this.debrisGeo.attributes.position.needsUpdate = true;
  }
}
