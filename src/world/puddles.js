import * as THREE from 'three';
import { additive } from '../core/additive.js';
import { spriteCloud } from '../core/spriteCloud.js';

/**
 * Realistic wet road puddles and water splashes.
 * Puddles catch environmental reflections with mirror-like specular highlights.
 */
export class PuddleSystem {
  constructor(scene, district) {
    this.scene = scene;
    this.district = district;
    this.puddles = [];
    this.sprayParticles = null;
    this.sprayGeo = null;

    this.#buildPuddles();
    this.#buildSpraySystem();
  }

  #buildPuddles() {
    // Generate soft, organic puddle decal texture
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Organic blob
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);

    const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 115);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.7)');
    grad.addColorStop(0.9, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    // Perturb circle points to create organic puddle shape
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const r = 100 + Math.sin(a * 4) * 12 + Math.cos(a * 7) * 8;
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    const puddleAlpha = new THREE.CanvasTexture(canvas);
    puddleAlpha.wrapS = puddleAlpha.wrapT = THREE.ClampToEdgeWrapping;

    // Glassy water material: ultra-low roughness catches HDR reflections
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x050b12,
      roughness: 0.04,
      metalness: 0.12,
      alphaMap: puddleAlpha,
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 2.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    const segments = this.district?.segments || [];
    const MAX_PUDDLES = 120;
    const instGeom = new THREE.PlaneGeometry(3.5, 2.6);
    instGeom.rotateX(-Math.PI / 2);
    const puddleMesh = new THREE.InstancedMesh(instGeom, puddleMat, MAX_PUDDLES);
    puddleMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let count = 0;
    for (let i = 0; i < segments.length && count < MAX_PUDDLES; i += 3) {
      const s = segments[i];
      if (!s || s.cls === 'freeway' || s.cls === 'ramp') continue;
      const mx = (s.ax + s.bx) / 2 + (Math.sin(count * 3.7) * 2.2);
      const mz = (s.az + s.bz) / 2 + (Math.cos(count * 2.3) * 2.2);
      const size = 0.85 + (count % 4) * 0.25;

      dummy.position.set(mx, 0.035, mz);
      dummy.rotation.set(0, (count * 1.37) % Math.PI, 0);
      dummy.scale.set(size, 1, size * 0.75);
      dummy.updateMatrix();

      puddleMesh.setMatrixAt(count, dummy.matrix);
      this.puddles.push({ x: mx, z: mz, radius: 2.0 * size });
      count++;
    }
    puddleMesh.count = count;
    puddleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(puddleMesh);
    this.mesh = puddleMesh;   // hidden on dry days: puddles come with the rain and dry out over ~3 min (update)
    console.info(`puddles: 2 draws (1 instanced puddle decal, 1 spray points; ${count} puddles)`);
  }

  #buildSpraySystem() {
    // 64 instanced water spray droplets behind rear wheels
    const COUNT = 64;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const vels = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -100;
      pos[i * 3 + 2] = 0;
      life[i] = 0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sprayVels = vels;
    this.sprayLife = life;

    const mat = additive(new THREE.PointsMaterial({
      color: 0xd8eafc,
      size: 0.18,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));

    this.sprayParticles = new THREE.Points(geo, mat);
    spriteCloud(this.sprayParticles);   // WebGPU draws Points at 1 px
    this.scene.add(this.sprayParticles);
  }

  /** `rain` 0..1 is how hard it is raining now (weather.amount): the road-wide spray scales with it; a puddle sprays regardless. */
  update(dt, car, rain = 1) {
    // wetness follows the rain up at once and dries at 1/180 per second; the puddles show while the ground is wet
    this.wetness = rain > (this.wetness ?? 0) ? rain : Math.max(0, (this.wetness ?? 0) - dt / 180);
    if (this.mesh) this.mesh.visible = this.wetness > 0.1;
    const speed = Math.abs(car.fwdSpeed || 0);
    const pos = this.sprayParticles?.geometry.attributes.position;
    if (!pos) return;

    const arr = pos.array;
    const vels = this.sprayVels;
    const life = this.sprayLife;

    // Check if car is over a puddle
    let inPuddle = false;
    for (const p of this.puddles) {
      if (Math.hypot(car.x - p.x, car.z - p.z) < p.radius + 1.5) {
        inPuddle = true;
        break;
      }
    }

    // Spawn spray if moving fast over wet road
    const shouldSpray = speed > 8 && (inPuddle || Math.random() < 0.35 * rain);

    for (let i = 0; i < life.length; i++) {
      if (life[i] > 0) {
        life[i] -= dt * 2.2;
        arr[i * 3] += vels[i * 3] * dt;
        arr[i * 3 + 1] += vels[i * 3 + 1] * dt;
        arr[i * 3 + 2] += vels[i * 3 + 2] * dt;
        vels[i * 3 + 1] -= 9.8 * dt * 0.4; // gravity
      } else if (shouldSpray && Math.random() < 0.25) {
        // Spawn behind wheels
        const side = (i % 2 === 0 ? 1 : -1) * 0.85;
        const rx = -Math.cos(car.yaw) * 1.8 + Math.sin(car.yaw) * side;
        const rz = Math.sin(car.yaw) * 1.8 + Math.cos(car.yaw) * side;

        arr[i * 3] = car.x + rx;
        arr[i * 3 + 1] = 0.15;
        arr[i * 3 + 2] = car.z + rz;

        vels[i * 3] = -Math.cos(car.yaw) * (speed * 0.4) + (Math.random() - 0.5) * 2;
        vels[i * 3 + 1] = 1.5 + Math.random() * 2.5;
        vels[i * 3 + 2] = Math.sin(car.yaw) * (speed * 0.4) + (Math.random() - 0.5) * 2;

        life[i] = 0.4 + Math.random() * 0.3;
      }
    }
    pos.needsUpdate = true;
  }
}
