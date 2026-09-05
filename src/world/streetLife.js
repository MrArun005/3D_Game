import * as THREE from 'three';
import { additive } from '../core/additive.js';

/**
 * Street-level urban atmosphere & chaos:
 * 1. Manhole Sewer Steam Vents
 * 2. Explosive Fire Hydrants with 10m pressurized water geysers
 * 3. Swirling Wind Debris (flying newspapers & flyers)
 */
const _hPos = new THREE.Vector3();
const _hQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.3));
const _hS = new THREE.Vector3(1, 1, 1);
const _hMat = new THREE.Matrix4();

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
    console.info('streetLife: 4 draws (steam, hydrants instanced, geyser, debris)');
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
    const spots = [];
    for (const r of roads) {
      if (!r.points || r.points.length < 2) continue;
      for (let i = 0; i < r.points.length - 1; i += 2) {
        if (spots.length >= 24) break;
        const p1 = r.points[i], p2 = r.points[i + 1];
        const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L;

        // Place on pavement curb edge
        const cx = (p1[0] + p2[0]) / 2 + nx * (r.width / 2 + 0.8);
        const cz = (p1[1] + p2[1]) / 2 + nz * (r.width / 2 + 0.8);
        spots.push({ x: cx, z: cz });
      }
    }

    const count = spots.length || 1;
    this.hydrantMesh = new THREE.InstancedMesh(hydrantGeo, redMat, count);
    this.hydrantMesh.castShadow = false;
    this.hydrantMesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      pos.set(sp.x, 0.15, sp.z);
      m.compose(pos, q, s);
      this.hydrantMesh.setMatrixAt(i, m);
      this.hydrants.push({ idx: i, x: sp.x, z: sp.z, broken: false });
    }
    this.hydrantMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.hydrantMesh);

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

    const gMat = additive(new THREE.PointsMaterial({
      color: 0xcee7ff,
      size: 0.35,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
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
    let hydUpdated = false;

    for (const h of this.hydrants) {
      if (!h.broken && Math.hypot(car.x - h.x, car.z - h.z) < 2.3) {
        h.broken = true;
        _hPos.set(h.x, 0.08, h.z);
        _hMat.compose(_hPos, _hQ, _hS);
        this.hydrantMesh.setMatrixAt(h.idx, _hMat);
        hydUpdated = true;
        this.activeGeysers.push({ x: h.x, z: h.z, t: 18.0 });
      }
    }
    if (hydUpdated) this.hydrantMesh.instanceMatrix.needsUpdate = true;

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
