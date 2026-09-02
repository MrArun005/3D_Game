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
];

export class Landmarks {
  constructor(scene, district) {
    this.scene = scene; this.district = district; this.placed = [];
    this.#place();
  }

  async #place() {
    const loader = new GLTFLoader();
    const used = new Set();
    for (const lm of LANDMARKS) {
      const lots = this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && b.district === lm.district && !used.has(b) && Math.min(b.w, b.h) >= lm.minW)
        .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
      const lot = lots[0] ?? this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && !used.has(b) && Math.min(b.w, b.h) >= lm.minW).sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))[0];
      if (!lot) { console.warn('landmark: no lot for', lm.file); continue; }
      used.add(lot);
      let gltf; try { gltf = await new Promise((res, rej) => loader.load(BASE + lm.file + '.glb', res, undefined, rej)); } catch (e) { console.warn('landmark', lm.file, e.message); continue; }
      const obj = gltf.scene;
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const k = Math.min((lot.w - 3) / size.x, (lot.h - 3) / size.z, 1.6);        // fit the lot, never blow up a small model
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
    }
  }
}
