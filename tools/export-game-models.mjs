#!/usr/bin/env node
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

import { HelicopterVehicle } from '../src/game/flight.js';
import { Helicopter as PoliceHelicopter } from '../src/game/helicopter.js';
import { buildCar, buildMaterials } from '../src/vehicle/model.js';
import { buildWeaponMesh, WEAPON_KINDS } from '../src/game/weapons.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets/models');

/**
 * Converts a Three.js Object3D tree into a glTF-Transform Document and exports as GLB.
 */
function threeToGlb(rootObject, name = 'Model') {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);

  const matMap = new Map();

  function getGltfMaterial(threeMat) {
    if (!threeMat) {
      threeMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    }
    if (matMap.has(threeMat)) return matMap.get(threeMat);

    const m = doc.createMaterial(threeMat.name || `Mat_${matMap.size + 1}`);
    const color = threeMat.color ? [threeMat.color.r, threeMat.color.g, threeMat.color.b] : [0.8, 0.8, 0.8];
    const opacity = threeMat.opacity !== undefined ? threeMat.opacity : 1.0;
    m.setBaseColorFactor([...color, opacity]);

    if (threeMat.roughness !== undefined) m.setRoughnessFactor(threeMat.roughness);
    if (threeMat.metalness !== undefined) m.setMetallicFactor(threeMat.metalness);
    if (threeMat.transparent) m.setAlphaMode('BLEND');

    if (threeMat.emissive && (threeMat.emissive.r > 0 || threeMat.emissive.g > 0 || threeMat.emissive.b > 0)) {
      const ei = threeMat.emissiveIntensity !== undefined ? threeMat.emissiveIntensity : 1.0;
      m.setEmissiveFactor([
        Math.min(1.0, threeMat.emissive.r * ei),
        Math.min(1.0, threeMat.emissive.g * ei),
        Math.min(1.0, threeMat.emissive.b * ei),
      ]);
    }

    if (threeMat.side === THREE.DoubleSide) {
      m.setDoubleSided(true);
    }

    matMap.set(threeMat, m);
    return m;
  }

  function convertObject(obj) {
    // Skip helper lights or cameras
    if (obj.isLight || obj.isCamera) return null;

    const node = doc.createNode(obj.name || 'Node');
    node.setTranslation([obj.position.x, obj.position.y, obj.position.z]);
    node.setRotation([obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w]);
    node.setScale([obj.scale.x, obj.scale.y, obj.scale.z]);

    if (obj.isMesh && obj.geometry) {
      const geo = obj.geometry.clone();
      if (!geo.attributes.normal) geo.computeVertexNormals();

      const gmesh = doc.createMesh(obj.name ? `${obj.name}_mesh` : 'Mesh');
      const prim = doc.createPrimitive();

      // Positions
      const posAttr = geo.attributes.position;
      const posAccessor = doc.createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(posAttr.array))
        .setBuffer(buffer);
      prim.setAttribute('POSITION', posAccessor);

      // Normals
      if (geo.attributes.normal) {
        const nrmAccessor = doc.createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(geo.attributes.normal.array))
          .setBuffer(buffer);
        prim.setAttribute('NORMAL', nrmAccessor);
      }

      // UVs
      if (geo.attributes.uv) {
        const uvAccessor = doc.createAccessor()
          .setType('VEC2')
          .setArray(new Float32Array(geo.attributes.uv.array))
          .setBuffer(buffer);
        prim.setAttribute('TEXCOORD_0', uvAccessor);
      }

      // Vertex Colors
      if (geo.attributes.color) {
        const colAttr = geo.attributes.color;
        let colArr;
        if (colAttr.itemSize === 3) {
          const count = colAttr.count;
          colArr = new Float32Array(count * 4);
          for (let i = 0; i < count; i++) {
            colArr[i * 4] = colAttr.array[i * 3];
            colArr[i * 4 + 1] = colAttr.array[i * 3 + 1];
            colArr[i * 4 + 2] = colAttr.array[i * 3 + 2];
            colArr[i * 4 + 3] = 1.0;
          }
        } else {
          colArr = new Float32Array(colAttr.array);
        }
        const colAccessor = doc.createAccessor()
          .setType('VEC4')
          .setArray(colArr)
          .setBuffer(buffer);
        prim.setAttribute('COLOR_0', colAccessor);
      }

      // Indices
      if (geo.index) {
        const idxArr = geo.index.count > 65535
          ? new Uint32Array(geo.index.array)
          : new Uint16Array(geo.index.array);
        const idxAccessor = doc.createAccessor()
          .setType('SCALAR')
          .setArray(idxArr)
          .setBuffer(buffer);
        prim.setIndices(idxAccessor);
      } else {
        const count = posAttr.count;
        const idxArr = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
        for (let i = 0; i < count; i++) idxArr[i] = i;
        const idxAccessor = doc.createAccessor()
          .setType('SCALAR')
          .setArray(idxArr)
          .setBuffer(buffer);
        prim.setIndices(idxAccessor);
      }

      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      prim.setMaterial(getGltfMaterial(mat));
      gmesh.addPrimitive(prim);
      node.setMesh(gmesh);
    }

    for (const child of obj.children) {
      const childNode = convertObject(child);
      if (childNode) node.addChild(childNode);
    }

    return node;
  }

  const rootNode = convertObject(rootObject);
  if (rootNode) scene.addChild(rootNode);

  return doc;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const io = new NodeIO();

  console.log('🚀 Exporting 3D Game Models to GLB in:', OUT_DIR);

  // 1. Player Helicopter
  console.log('🚁 Building Player Helicopter...');
  const dummyScene = new THREE.Scene();
  const heliVehicle = new HelicopterVehicle(dummyScene, null);
  const heliDoc = threeToGlb(heliVehicle.mesh, 'PlayerHelicopter');
  const heliPath = path.join(OUT_DIR, 'helicopter.glb');
  await io.write(heliPath, heliDoc);
  console.log('   ✅ Saved:', heliPath);

  // 2. Police Helicopter
  console.log('🚁 Building Police Helicopter...');
  const policeHeli = new PoliceHelicopter(dummyScene, false);
  const policeDoc = threeToGlb(policeHeli.group, 'PoliceHelicopter');
  const policePath = path.join(OUT_DIR, 'police_helicopter.glb');
  await io.write(policePath, policeDoc);
  console.log('   ✅ Saved:', policePath);

  // 3. Player Car
  console.log('🏎️  Building Player Sports Car...');
  const mats = buildMaterials();
  const car = buildCar(mats, 0x1f4b8e); // Midnight metallic blue
  const carDoc = threeToGlb(car, 'SportsCar');
  const carPath = path.join(OUT_DIR, 'player_car.glb');
  await io.write(carPath, carDoc);
  console.log('   ✅ Saved:', carPath);

  // 4. Weapon Arsenal
  console.log('🔫 Building Weapons Arsenal...');
  const weaponsGroup = new THREE.Group();
  weaponsGroup.name = 'WeaponsArsenal';
  let offset = 0;
  for (const kind of WEAPON_KINDS) {
    const wMesh = buildWeaponMesh(kind);
    wMesh.name = kind.toUpperCase();
    wMesh.position.set(0, 0, offset);
    weaponsGroup.add(wMesh);
    offset += 0.8;
  }
  const weaponsDoc = threeToGlb(weaponsGroup, 'WeaponsArsenal');
  const weaponsPath = path.join(OUT_DIR, 'weapons_arsenal.glb');
  await io.write(weaponsPath, weaponsDoc);
  console.log('   ✅ Saved:', weaponsPath);

  console.log('\n🎉 All 3D models exported successfully to assets/models/!');
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
