import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Landmarks: one-off set pieces the owner brought in (Sketchfab), placed on
 * the empty lot that fits them best in the district they belong to. Whole
 * textured models, drawn once, so a city of repeating kit gets a few places
 * you recognise: the gun shop, the supermarket, the street corner set.
 * Scaled by footprint fit (uniform), base on the kerb, faced to the block.
 * No collision yet: the hull collider only knows footprints from the file.
 */
const BASE = '/models/vendor/sketchfab/props/';
const LANDMARKS = [
  { file: 'gun-shop',    district: 'OLD QUARTER',  minW: 8,  name: "Schneider's Guns" },
  { file: 'supermarket', district: 'THE FLATS',    minW: 30, name: 'Flats Supermarket' },
  { file: 'street-set',  district: 'VELLERY ROW',  minW: 12, name: 'Vellery corner' },
  {
    file: '/models/vendor/kenney/commercial/building-skyscraper-d.glb',
    district: 'KINGSWAY',
    minW: 24,
    targetW: 28,
    name: 'Kingsway Apex Tower',
  },
  {
    file: '/models/vendor/kenney/industrial/water-tower.glb',
    district: 'STEELGATE',
    minW: 20,
    targetW: 22,
    name: 'Steelgate Waterworks & Silo',
  },
  {
    file: '/models/vendor/kenney/industrial/windmill.glb',
    district: 'HARBOUR POINT',
    minW: 20,
    targetW: 20,
    name: 'Harbour Point Turbine & Signal',
  },
];

export class Landmarks {
  constructor(scene, district) {
    this.scene = scene; this.district = district; this.placed = [];
    this.#buildTokyoArch();
    this.#place();
  }

  async #place() {
    const loader = new GLTFLoader();
    const used = new Set();
    await Promise.all(LANDMARKS.map(async (lm) => {
      const lots = this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && b.district === lm.district && !used.has(b) && Math.min(b.w, b.h) >= lm.minW)
        .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
      const lot = lots[0] ?? this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && !used.has(b) && Math.min(b.w, b.h) >= lm.minW).sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))[0];
      if (!lot) { console.warn('landmark: no lot for', lm.file); return; }
      used.add(lot);
      const path = lm.file.startsWith('/') ? lm.file : BASE + lm.file + '.glb';
      let gltf; try { gltf = await new Promise((res, rej) => loader.load(path, res, undefined, rej)); } catch (e) { console.warn('landmark', lm.file, e.message); return; }
      const obj = gltf.scene;
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const maxK = lm.maxScale ?? 1.6;
      const k = lm.targetW ? (lm.targetW / size.x) : Math.min((lot.w - 3) / size.x, (lot.h - 3) / size.z, maxK);        // fit the lot or scale to target dimension
      const wrap = new THREE.Group();
      obj.position.set(-c.x, -bb.min.y, -c.z);
      wrap.add(obj);
      wrap.scale.setScalar(k);
      wrap.position.set(lot.x, 0.15, lot.y);
      wrap.rotation.y = lot.angle;
      wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(wrap);
      this.placed.push({ ...lm, x: lot.x, z: lot.y, scale: k });
      console.info(`landmark ${lm.name} at ${lot.x | 0},${lot.y | 0} (${lm.district}) x${k.toFixed(2)}`);
    }));

    // Place high-detail scanned characters as street walkers / pedestrians
    const STREET_PEOPLE = [
      { file: '/models/characters/cowboy.glb', x: 28, z: 12, yaw: 0.4, name: 'Cowboy on Sidewalk' },
      { file: '/models/characters/navy_jacket.glb', x: 18, z: 15, yaw: -1.2, name: 'Navy Jacket Pedestrian' },
      { file: '/models/characters/cowboy.glb', x: -35, z: 25, yaw: 1.8, name: 'Cowboy at Corner' },
    ];
    for (const sp of STREET_PEOPLE) {
      try {
        const gltf = await new Promise((res, rej) => loader.load(sp.file, res, undefined, rej));
        const obj = gltf.scene;
        obj.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(obj);
        const h = bb.max.y - bb.min.y || 1;
        const scale = 1.78 / h;
        obj.scale.setScalar(scale);
        obj.position.set(sp.x, -bb.min.y * scale + 0.15, sp.z);
        obj.rotation.y = sp.yaw;
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
        this.scene.add(obj);
        console.info(`street walker: ${sp.name} at ${sp.x},${sp.z}`);
      } catch (e) {
        console.warn('street walker', sp.file, e.message);
      }
    }
  }

  #buildTokyoArch() {
    const group = new THREE.Group();
    const vermilionMat = new THREE.MeshStandardMaterial({
      color: 0xcc1a24,
      roughness: 0.42,
      metalness: 0.1,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x1c1816,
      roughness: 0.65,
      metalness: 0.05,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf5b722,
      roughness: 0.28,
      metalness: 0.8,
    });

    // Two main vertical Torii columns spanning the street (16m clear span)
    const span = 16.0;
    for (const s of [-span / 2, span / 2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 10.5, 12), vermilionMat);
      col.position.set(s, 5.25, 0);
      col.castShadow = true; col.receiveShadow = true;

      // Base stone footings
      const baseStone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 1.2, 12), darkWoodMat);
      baseStone.position.set(s, 0.6, 0);
      baseStone.receiveShadow = true;

      // Gold capital ring
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 12), goldMat);
      ring.position.set(s, 8.8, 0);

      group.add(col, baseStone, ring);
    }

    // Lower crossbeam (Nuki)
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(span + 2.2, 0.6, 0.8), vermilionMat);
    nuki.position.set(0, 7.8, 0);
    nuki.castShadow = true;
    group.add(nuki);

    // Upper crossbeam (Kasagi) with curved tips
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(span + 4.5, 0.85, 1.1), vermilionMat);
    kasagi.position.set(0, 9.8, 0);
    kasagi.castShadow = true;
    group.add(kasagi);

    // Top lintel cap
    const capRoof = new THREE.Mesh(new THREE.BoxGeometry(span + 5.2, 0.22, 1.35), darkWoodMat);
    capRoof.position.set(0, 10.3, 0);
    group.add(capRoof);

    // Center illuminated Tokyo Street neon sign
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0812';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 1008, 240);
    ctx.fillStyle = '#ff007f';
    ctx.fillRect(20, 20, 984, 12);
    ctx.font = '900 86px "Hiragino Kaku Gothic Pro", "Noto Sans JP", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('新宿通り · TOKYO STREET · 歌舞伎町', 512, 142);
    const signTex = new THREE.CanvasTexture(canvas);
    signTex.colorSpace = THREE.SRGBColorSpace;

    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      emissiveMap: signTex,
      emissive: 0xffffff,
      emissiveIntensity: 2.8,
      roughness: 0.2,
    });
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.55, 0.28), signMat);
    signBoard.position.set(0, 8.8, 0);
    group.add(signBoard);

    // Hanging lanterns with warm golden glow
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xdd2211,
      emissive: 0xff4411,
      emissiveIntensity: 2.2,
      roughness: 0.35,
    });
    for (const lx of [-4.5, -1.8, 1.8, 4.5]) {
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.65, 10), lanternMat);
      lantern.position.set(lx, 7.1, 0);
      group.add(lantern);
    }

    // Place across the main avenue at Tokyo Street boundary
    group.position.set(2285, 0, 1378);
    group.rotation.y = 0.05;
    this.scene.add(group);
    console.info('Tokyo Gateway Arch placed at 2285, 1378');
  }
}
