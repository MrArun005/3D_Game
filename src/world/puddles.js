import * as THREE from 'three';

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

    const roads = this.district?.data?.roads || [];
    const group = new THREE.Group();

    // Place puddles along road sections
    let count = 0;
    for (const r of roads) {
      if (!r.points || r.points.length < 2) continue;
      for (let i = 0; i < r.points.length - 1; i += 2) {
        if (count >= 120) break;
        const p1 = r.points[i], p2 = r.points[i + 1];
        const mx = (p1[0] + p2[0]) / 2 + (Math.sin(count * 3.7) * 2.5);
        const mz = (p1[1] + p2[1]) / 2 + (Math.cos(count * 2.3) * 2.5);
        const size = 3.5 + (count % 4) * 1.2;

        const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.75), puddleMat);
        quad.rotateX(-Math.PI / 2);
        quad.rotation.z = Math.random() * Math.PI;
        quad.position.set(mx, 0.035, mz);
        quad.receiveShadow = true;
        group.add(quad);
        this.puddles.push({ x: mx, z: mz, radius: size * 0.6 });
        count++;
      }
    }
    this.scene.add(group);
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

    const mat = new THREE.PointsMaterial({
      color: 0xd8eafc,
      size: 0.18,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.sprayParticles = new THREE.Points(geo, mat);
    this.scene.add(this.sprayParticles);
  }

  update(dt, car) {
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
    const shouldSpray = speed > 8 && (inPuddle || Math.random() < 0.35);

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
