import * as THREE from 'three';

/**
 * Giant Animated Times Square & Akihabara Neon Billboards
 * and Skyscraper Rooftop Neon Signs.
 */
export class BillboardSystem {
  constructor(scene, district) {
    this.scene = scene;
    this.district = district;
    this.billboards = [];
    this.animations = [];

    this.#buildBillboards();
    this.#buildRooftopNeons();
  }

  #createAnimatedCanvas(drawFn, width = 512, height = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    this.animations.push((t) => {
      drawFn(ctx, width, height, t);
      texture.needsUpdate = true;
    });

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.1,
    });

    return { canvas, texture, mat };
  }

  #buildBillboards() {
    const group = new THREE.Group();

    // 1. CYBER COLA (cyan & magenta fizzing soda)
    const cola = this.#createAnimatedCanvas((ctx, w, h, t) => {
      ctx.fillStyle = '#08081a';
      ctx.fillRect(0, 0, w, h);

      // Gradient glow
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#00d4ff');
      g.addColorStop(1, '#ff007f');
      ctx.strokeStyle = g;
      ctx.lineWidth = 14;
      ctx.strokeRect(8, 8, w - 16, h - 16);

      // Bubbles
      for (let i = 0; i < 15; i++) {
        const bx = (i * 35 + t * 45) % (w - 40) + 20;
        const by = h - 25 - ((i * 28 + t * 80) % (h - 50));
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 220, 255, 0.75)' : 'rgba(255, 0, 150, 0.75)';
        ctx.beginPath();
        ctx.arc(bx, by, 6 + (i % 5), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#fff';
      ctx.font = '900 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.fillText('CYBER COLA', w / 2, h / 2 - 6);
      ctx.font = '700 22px sans-serif';
      ctx.fillStyle = '#ffb3ff';
      ctx.shadowColor = '#ff00aa';
      ctx.fillText('⚡ 100% SYNTHETIC ENERGY ⚡', w / 2, h / 2 + 36);
    }, 512, 256);

    // 2. DRAGON RAMEN (steaming ramen & glowing kanji)
    const ramen = this.#createAnimatedCanvas((ctx, w, h, t) => {
      ctx.fillStyle = '#180404';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#ff3300';
      ctx.lineWidth = 12;
      ctx.strokeRect(8, 8, w - 16, h - 16);

      ctx.fillStyle = '#ffaa00';
      ctx.font = '900 52px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 24;
      ctx.fillText('龍 麺 · DRAGON RAMEN', w / 2, h / 2 - 10);

      const blink = Math.sin(t * 6) > 0;
      ctx.font = '800 24px sans-serif';
      ctx.fillStyle = blink ? '#ffff00' : '#ff4400';
      ctx.shadowColor = '#ffaa00';
      ctx.fillText('HOT & SPICY BROTH · OPEN 24 HOURS', w / 2, h / 2 + 38);
    }, 512, 256);

    // 3. FEDERAL CASINO 777 (jackpot neon lights)
    const casino = this.#createAnimatedCanvas((ctx, w, h, t) => {
      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, w, h);

      // Flashing border bulbs
      const bulbs = 24;
      for (let i = 0; i < bulbs; i++) {
        const on = Math.floor(t * 8 + i) % 2 === 0;
        ctx.fillStyle = on ? '#ffd700' : '#443300';
        ctx.beginPath();
        const px = (i / bulbs) * w;
        ctx.arc(px, 12, 5, 0, Math.PI * 2);
        ctx.arc(px, h - 12, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#ffd700';
      ctx.font = '900 46px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ffae00';
      ctx.shadowBlur = 22;
      ctx.fillText('★ FEDERAL CASINO ★', w / 2, h / 2 - 10);

      const roll = (Math.floor(t * 3) % 9) + 1;
      ctx.font = '900 32px sans-serif';
      ctx.fillStyle = '#ff2255';
      ctx.shadowColor = '#ff0033';
      ctx.fillText(`JACKPOT: $77${roll},000`, w / 2, h / 2 + 36);
    }, 512, 256);

    // 4. SCHNEIDER'S TACTICAL (gun shop reticle)
    const guns = this.#createAnimatedCanvas((ctx, w, h, t) => {
      ctx.fillStyle = '#0a1008';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#00ff66';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, w - 16, h - 16);

      // Rotating reticle
      const cx = 90, cy = h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 1.5);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, Math.PI * 2);
      ctx.moveTo(-45, 0); ctx.lineTo(45, 0);
      ctx.moveTo(0, -45); ctx.lineTo(0, 45);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#00ff66';
      ctx.font = '900 40px sans-serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = '#00ff44';
      ctx.shadowBlur = 20;
      ctx.fillText("SCHNEIDER'S GUNS", 150, h / 2 - 6);
      ctx.font = '700 20px sans-serif';
      ctx.fillStyle = '#aaffcc';
      ctx.fillText("TACTICAL WEAPONS & ARMOUR", 150, h / 2 + 32);
    }, 512, 256);

    // Mount boards to prominent building facades
    const BOARDS = [
      { mat: cola.mat, x: 35, y: 16, z: -40, w: 18, h: 9, yaw: 0 },
      { mat: ramen.mat, x: -35, y: 18, z: 28, w: 20, h: 10, yaw: Math.PI / 2 },
      { mat: casino.mat, x: 45, y: 22, z: 85, w: 22, h: 11, yaw: -Math.PI / 2 },
      { mat: guns.mat, x: -90, y: 14, z: -70, w: 18, h: 9, yaw: Math.PI },
      { mat: cola.mat, x: 120, y: 24, z: 140, w: 22, h: 11, yaw: Math.PI * 0.75 },
      { mat: ramen.mat, x: -140, y: 20, z: 120, w: 20, h: 10, yaw: -Math.PI * 0.25 },
    ];

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x22252c, metalness: 0.8, roughness: 0.4 });

    for (const b of BOARDS) {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, b.y, b.z);
      bGroup.rotation.y = b.yaw;

      // Screen plane
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), b.mat);
      screen.castShadow = false;
      screen.receiveShadow = false;

      // Outer bezel frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.8, b.h + 0.8, 0.4), frameMat);
      frame.position.z = -0.22;

      bGroup.add(frame, screen);
      group.add(bGroup);
    }

    this.scene.add(group);
  }

  #buildRooftopNeons() {
    // 3D glowing rooftop signs on tall skyscrapers
    const group = new THREE.Group();
    const ROOFS = [
      { text: 'HOTEL NOIR', col: 0xff0055, x: 25, y: 56, z: -45, yaw: 0 },
      { text: 'BANK OF HALSTEAD', col: 0x00e5ff, x: -45, y: 72, z: 35, yaw: Math.PI / 2 },
      { text: 'NIGHTFALL TOWER', col: 0xffaa00, x: 85, y: 64, z: 90, yaw: -Math.PI * 0.4 },
    ];

    for (const r of ROOFS) {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = `#${r.col.toString(16).padStart(6, '0')}`;
      ctx.font = '900 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 24;
      ctx.fillText(r.text, 256, 76);

      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const sign = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), mat);
      sign.position.set(r.x, r.y, r.z);
      sign.rotation.y = r.yaw;
      group.add(sign);
    }
    this.scene.add(group);
  }

  update(time) {
    for (const anim of this.animations) anim(time);
  }
}
