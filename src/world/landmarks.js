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
}
