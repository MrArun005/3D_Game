import * as THREE from 'three';
import { roofsNear } from './districtWorld.js';

/**
 * Giant Animated Times Square & Akihabara Neon Billboards
 * and Skyscraper Rooftop Neon Signs.
 */
export class BillboardSystem {
  constructor(scene, district, anchor = { x: 0, z: 0 }) {
    this.scene = scene;
    this.district = district;
    /* Real roofs, not hard-coded coordinates: the first version placed six
       screens and three neons around the world ORIGIN, 2 km from Kingsway,
       floating in the air. Now the nine tallest buildings within 350 m of the
       spawn anchor wear them, screens on the facade top, neons on the roof. */
    this.roofs = roofsNear(district, anchor.x, anchor.z, 350, 9);
    this.billboards = [];
    this.animations = [];

    this.#buildBillboards();
    this.#buildRooftopNeons();
    console.info('billboards: 15 draws (6 screens, 6 frames, 3 rooftop neons)');
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
    const mats = [cola.mat, ramen.mat, casino.mat, guns.mat, cola.mat, ramen.mat];
    const BOARDS = this.roofs.slice(3, 9).map((r, i) => {
      const w = Math.min(22, r.w * 0.8), h = w / 2;
      // hang on the facade that faces +local-z, just under the parapet
      const fx = Math.sin(r.angle) * -1, fz = Math.cos(r.angle);
      return { mat: mats[i % mats.length], x: r.x + fx * (r.d / 2 + 0.3), y: Math.max(6, r.h - h / 2 - 1.5), z: r.z + fz * (r.d / 2 + 0.3), w, h, yaw: r.angle };
    });

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
    const NAMES = [['HOTEL NOIR', 0xff0055], ['BANK OF HALSTEAD', 0x00e5ff], ['NIGHTFALL TOWER', 0xffaa00]];
    const ROOFS = this.roofs.slice(0, 3).map((r, i) => ({ text: NAMES[i][0], col: NAMES[i][1], x: r.x, y: r.h + 3.5, z: r.z, yaw: r.angle }));

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
