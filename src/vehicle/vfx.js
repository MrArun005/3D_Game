import * as THREE from 'three';

/**
 * Master Vehicle Visual Effects Suite:
 * 1. Twin Nitrous / Redline Exhaust Flames + Embers & Dynamic Flame Light
 * 2. Volumetric Drift & Burnout Tire Smoke
 * 3. Under-Car Chassis Neon Ground Lighting
 * 4. Glowing Ceramic Brake Discs
 * 5. Headlight Volumetric Fog Beams
 * 6. High-Speed Screen Radial Speed Streaks
 */
export class VehicleVFX {
  constructor(scene, hero) {
    this.scene = scene;
    this.hero = hero;

    this.flameLeft = null;
    this.flameRight = null;
    this.flameLight = null;
    this.neonMesh = null;
    this.neonLight = null;
    this.discs = [];
    this.brakeHeat = 0;

    this.backfireT = 0;
    this.lastRpm = 0;

    this.#buildExhaustFlames();
    this.#buildExhaustSparks();
    this.#buildTireSmoke();
    this.#buildUnderglow();
    this.#buildHeadlightBeams();
    this.#setupBrakeDiscs();
    this.#buildSpeedLines();
  }

  #buildExhaustFlames() {
    const shell = this.hero.userData?.shell;
    if (!shell) return;

    const flameGeo = new THREE.ConeGeometry(0.08, 0.72, 12, 1, true);
    flameGeo.rotateX(Math.PI / 2);
    flameGeo.translate(0, 0, -0.36);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const innerGeo = new THREE.ConeGeometry(0.045, 0.48, 8, 1, true);
    innerGeo.rotateX(Math.PI / 2);
    innerGeo.translate(0, 0, -0.24);

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const makeFlame = (z) => {
      const g = new THREE.Group();
      g.position.set(4.62, 0.36, z);
      const outer = new THREE.Mesh(flameGeo, flameMat);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      g.add(outer, inner);
      shell.add(g);
      return { group: g, outer, inner, flameMat, innerMat };
    };

    this.flameLeft = makeFlame(-0.46);
    this.flameRight = makeFlame(0.46);

    this.flameLight = new THREE.PointLight(0x00c8ff, 0, 9, 2);
    this.flameLight.position.set(5.2, 0.4, 0);
    shell.add(this.flameLight);
  }

  #buildExhaustSparks() {
    const COUNT = 32;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const vel = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      pos[i * 3 + 1] = -100;
      life[i] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkGeo = geo;
    this.sparkVel = vel;
    this.sparkLife = life;

    const mat = new THREE.PointsMaterial({
      color: 0xffea78,
      size: 0.12,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparks = new THREE.Points(geo, mat);
    this.scene.add(this.sparks);
  }

  #buildTireSmoke() {
    // 96 billboard particles for thick billowy tire smoke
    const COUNT = 96;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const vel = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      pos[i * 3 + 1] = -100;
      life[i] = 0;
      size[i] = 0.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.smokeGeo = geo;
    this.smokeVel = vel;
    this.smokeLife = life;
    this.smokeSize = size;

    // Soft smoke puff canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const rad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    rad.addColorStop(0, 'rgba(235, 240, 250, 0.7)');
    rad.addColorStop(0.5, 'rgba(215, 225, 240, 0.35)');
    rad.addColorStop(1, 'rgba(200, 210, 225, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.PointsMaterial({
      map: tex,
      size: 1.6,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.smoke = new THREE.Points(geo, mat);
    this.scene.add(this.smoke);
  }

  #buildUnderglow() {
    const body = this.hero.userData?.body;
    if (!body) return;

    const neonGeo = new THREE.PlaneGeometry(3.6, 1.8);
    neonGeo.rotateX(-Math.PI / 2);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const rad = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    rad.addColorStop(0, 'rgba(0, 220, 255, 0.95)');
    rad.addColorStop(0.4, 'rgba(0, 150, 255, 0.6)');
    rad.addColorStop(0.8, 'rgba(0, 80, 220, 0.2)');
    rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    const neonMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const neonMesh = new THREE.Mesh(neonGeo, neonMat);
    neonMesh.position.set(0, 0.08, 0);
    body.add(neonMesh);
    this.neonMesh = neonMesh;

    this.neonLight = new THREE.PointLight(0x00c8ff, 1.8, 5.5, 1.8);
    this.neonLight.position.set(0, 0.2, 0);
    body.add(this.neonLight);
  }

  #buildHeadlightBeams() {
    const shell = this.hero.userData?.shell;
    if (!shell) return;

    // Translucent angled light cones projecting forward (-X in shell frame)
    const coneGeo = new THREE.CylinderGeometry(0.08, 0.85, 12.0, 16, 1, true);
    coneGeo.rotateZ(Math.PI / 2);
    coneGeo.translate(-6.0, 0, 0);

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfff2cc,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const z of [-0.62, 0.62]) {
      const beam = new THREE.Mesh(coneGeo, coneMat);
      beam.position.set(0.18, 0.72, z);
      shell.add(beam);
    }
  }

  #setupBrakeDiscs() {
    const wheels = this.hero.userData?.wheels || [];
    for (const w of wheels) {
      w.spin.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'CylinderGeometry') {
          o.material = o.material.clone();
          this.discs.push(o.material);
        }
      });
    }
  }

  #buildSpeedLines() {
    const canvas = document.createElement('canvas');
    canvas.id = 'speed-lines';
    canvas.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 55;
      opacity: 0; transition: opacity 0.15s ease-out;
    `;
    document.body.appendChild(canvas);
    this.speedCanvas = canvas;
    this.speedCtx = canvas.getContext('2d');
    this.#resizeSpeedLines();
    window.addEventListener('resize', () => this.#resizeSpeedLines());
  }

  #resizeSpeedLines() {
    if (!this.speedCanvas) return;
    this.speedCanvas.width = window.innerWidth;
    this.speedCanvas.height = window.innerHeight;
  }

  setNeonColor(hex) {
    if (this.neonMesh?.material) this.neonMesh.material.color.setHex(hex);
    if (this.neonLight) this.neonLight.color.setHex(hex);
  }

  update(dt, car, garage) {
    const isNos = !!garage?.nosActive;
    const speed = Math.abs(car.fwdSpeed || 0);

    // --- 1. Exhaust Flames (NOS + Overrun Backfire) ---
    if (car.rpm > 5800 && this.lastRpm > car.rpm + 600 && car.throttle < 0.2) {
      this.backfireT = 0.24;
    }
    this.lastRpm = car.rpm;
    if (this.backfireT > 0) this.backfireT -= dt;

    const showFlame = isNos || this.backfireT > 0;
    const isBlueNos = isNos;

    if (showFlame) {
      const flicker = 0.75 + Math.random() * 0.45;
      const len = isBlueNos ? (1.1 + Math.random() * 0.6) : (0.65 + Math.random() * 0.4);

      for (const f of [this.flameLeft, this.flameRight]) {
        if (!f) continue;
        f.group.scale.set(flicker, flicker, len);
        f.flameMat.opacity = 0.95;
        f.innerMat.opacity = 1.0;
        f.flameMat.color.setHex(isBlueNos ? 0x00d4ff : 0xff7700);
      }

      if (this.flameLight) {
        this.flameLight.intensity = (isBlueNos ? 4.2 : 2.8) * flicker;
        this.flameLight.color.setHex(isBlueNos ? 0x00c8ff : 0xff6600);
      }

      // Spawn spark embers
      const pos = this.sparkGeo.attributes.position.array;
      for (let i = 0; i < this.sparkLife.length; i++) {
        if (this.sparkLife[i] <= 0 && Math.random() < 0.4) {
          const side = (i % 2 === 0 ? 1 : -1) * 0.46;
          const rx = -Math.cos(car.yaw) * 2.2 + Math.sin(car.yaw) * side;
          const rz = Math.sin(car.yaw) * 2.2 + Math.cos(car.yaw) * side;

          pos[i * 3] = car.x + rx;
          pos[i * 3 + 1] = 0.38;
          pos[i * 3 + 2] = car.z + rz;

          this.sparkVel[i * 3] = -Math.cos(car.yaw) * (speed * 0.9 + 8) + (Math.random() - 0.5) * 4;
          this.sparkVel[i * 3 + 1] = 0.8 + Math.random() * 2.0;
          this.sparkVel[i * 3 + 2] = Math.sin(car.yaw) * (speed * 0.9 + 8) + (Math.random() - 0.5) * 4;
          this.sparkLife[i] = 0.25 + Math.random() * 0.2;
        }
      }
    } else {
      for (const f of [this.flameLeft, this.flameRight]) {
        if (!f) continue;
        f.flameMat.opacity = 0;
        f.innerMat.opacity = 0;
      }
      if (this.flameLight) this.flameLight.intensity = 0;
    }

    // Update sparks
    const spos = this.sparkGeo.attributes.position.array;
    for (let i = 0; i < this.sparkLife.length; i++) {
      if (this.sparkLife[i] > 0) {
        this.sparkLife[i] -= dt;
        spos[i * 3] += this.sparkVel[i * 3] * dt;
        spos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        spos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        this.sparkVel[i * 3 + 1] -= 9.8 * dt * 0.6;
      } else {
        spos[i * 3 + 1] = -100;
      }
    }
    this.sparkGeo.attributes.position.needsUpdate = true;

    // --- 2. Volumetric Drift & Burnout Tire Smoke ---
    const isBurnout = car.hand > 0.4 && car.throttle > 0.4;
    const isDrifting = Math.abs(car.slip || 0) > 0.16 || isBurnout;

    const smkPos = this.smokeGeo.attributes.position.array;
    for (let i = 0; i < this.smokeLife.length; i++) {
      if (this.smokeLife[i] > 0) {
        this.smokeLife[i] -= dt * 1.3;
        smkPos[i * 3] += this.smokeVel[i * 3] * dt;
        smkPos[i * 3 + 1] += this.smokeVel[i * 3 + 1] * dt;
        smkPos[i * 3 + 2] += this.smokeVel[i * 3 + 2] * dt;
      } else if (isDrifting && Math.random() < 0.35) {
        const side = (i % 2 === 0 ? 1 : -1) * 0.82;
        const rx = -Math.cos(car.yaw) * 1.5 + Math.sin(car.yaw) * side;
        const rz = Math.sin(car.yaw) * 1.5 + Math.cos(car.yaw) * side;

        smkPos[i * 3] = car.x + rx;
        smkPos[i * 3 + 1] = 0.22;
        smkPos[i * 3 + 2] = car.z + rz;

        this.smokeVel[i * 3] = (Math.random() - 0.5) * 1.4;
        this.smokeVel[i * 3 + 1] = 0.8 + Math.random() * 1.2; // rises
        this.smokeVel[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
        this.smokeLife[i] = 0.8 + Math.random() * 0.6;
      } else {
        smkPos[i * 3 + 1] = -100;
      }
    }
    this.smokeGeo.attributes.position.needsUpdate = true;

    // --- 3. Underglow Neon Pulsing ---
    if (this.neonMesh) {
      const pulse = 0.72 + Math.sin(performance.now() * 0.003) * 0.08;
      this.neonMesh.material.opacity = pulse;
      if (this.neonLight) this.neonLight.intensity = 1.9 * pulse;
    }

    // --- 4. Glowing Ceramic Brake Discs ---
    if (car.brake > 0.4 && speed > 10) {
      this.brakeHeat = Math.min(1.0, this.brakeHeat + car.brake * (speed / 30) * dt * 0.8);
    } else {
      const coolingRate = 0.15 + (speed / 40) * 0.25;
      this.brakeHeat = Math.max(0, this.brakeHeat - coolingRate * dt);
    }
    if (this.discs.length > 0) {
      for (const mat of this.discs) {
        if (this.brakeHeat > 0.05) {
          mat.emissive.setRGB(this.brakeHeat * 1.0, this.brakeHeat * 0.28, 0);
          mat.emissiveIntensity = this.brakeHeat * 3.5;
        } else {
          mat.emissiveIntensity = 0;
        }
      }
    }

    // --- 5. High-Speed Radial Speed Lines ---
    if (this.speedCanvas && this.speedCtx) {
      const kph = speed * 3.6;
      const showSpeed = kph > 85 || isNos;
      if (showSpeed) {
        const targetOpacity = Math.min(0.85, (kph - 80) / 70 + (isNos ? 0.35 : 0));
        this.speedCanvas.style.opacity = targetOpacity.toFixed(2);

        const ctx = this.speedCtx;
        const w = this.speedCanvas.width, h = this.speedCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = isNos ? 'rgba(120, 220, 255, 0.45)' : 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.5;

        const cx = w / 2, cy = h / 2;
        const lineCount = isNos ? 28 : 16;
        for (let i = 0; i < lineCount; i++) {
          const a = Math.random() * Math.PI * 2;
          const r1 = Math.min(w, h) * (0.35 + Math.random() * 0.2);
          const r2 = r1 + 80 + Math.random() * 120;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
          ctx.stroke();
        }
      } else {
        this.speedCanvas.style.opacity = '0';
      }
    }
  }
}
