import * as THREE from 'three';
import { M4, mergeGeos } from '../core/geometry.js';

/** Street lamp: column, base, and the arm that reaches over the kerb. */
export function buildStreetLamp() {
  const parts = [];
  const column = new THREE.CylinderGeometry(0.075, 0.115, 8.2, 10);
  column.translate(0, 4.1, 0);
  const base = new THREE.CylinderGeometry(0.16, 0.2, 0.42, 10);
  base.translate(0, 0.21, 0);
  const arm = new THREE.CylinderGeometry(0.055, 0.055, 1.5, 8);
  arm.rotateZ(Math.PI / 2 - 0.2);
  arm.translate(0.72, 8.28, 0);
  parts.push(column, base, arm);
  return mergeGeos(parts);
}

export function buildLampHead() {
  const g = new THREE.BoxGeometry(0.62, 0.11, 0.3);
  g.translate(1.42, 8.36, 0);
  return g;
}

export function buildTrafficPost() {
  const parts = [];
  const post = new THREE.CylinderGeometry(0.075, 0.09, 5.6, 8);
  post.translate(0, 2.8, 0);
  const arm = new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8);
  arm.rotateZ(Math.PI / 2);
  arm.translate(1.7, 5.5, 0);
  const head = new THREE.BoxGeometry(0.3, 0.86, 0.26);
  head.translate(3.1, 5.05, 0);
  const visor = new THREE.BoxGeometry(0.36, 0.1, 0.3);
  visor.translate(3.12, 5.46, 0);
  parts.push(post, arm, head, visor);
  return mergeGeos(parts);
}

export function buildTree() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.19, 3.0, 8);
  trunk.translate(0, 1.5, 0);
  parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const branch = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6);
    branch.applyMatrix4(M4(0, 3.0, 0, 0.5, i * 2.1, 0));
    parts.push(branch);
  }
  return mergeGeos(parts);
}

export function buildCanopy() {
  const parts = [];
  // overlapping icosahedrons, not a box: a cube canopy is the daylight still
  // that kills the street. More smaller blobs beat one big gem.
  const blobs = [
    [0, 4.5, 0, 1.42],
    [0.85, 4.15, 0.4, 0.95],
    [-0.8, 4.2, -0.35, 0.92],
    [0.15, 5.15, -0.55, 0.88],
    [-0.45, 4.85, 0.7, 0.78],
    [0.55, 3.75, -0.7, 0.7],
    [-0.15, 5.5, 0.2, 0.62],
  ];
  for (const [x, y, z, s] of blobs) {
    const g = new THREE.IcosahedronGeometry(s, 1);
    g.applyMatrix4(M4(x, y, z, y * 0.12, x * 1.6, z * 0.18, 1, 0.78, 1));
    parts.push(g);
  }
  return mergeGeos(parts);
}

/**
 * Four species, not one tree repeated.
 *
 * A street planted with a single silhouette reads as wallpaper no matter how
 * good that silhouette is -- the eye picks up the repeat long before it picks
 * up the detail. Each species is returned as a {trunk, canopy} pair so the two
 * halves can be instanced against different materials.
 */
export const TREE_SPECIES = ['plane', 'pine', 'poplar', 'palm'];

export function buildSpecies(kind) {
  if (kind === 'pine') {
    const trunk = new THREE.CylinderGeometry(0.13, 0.22, 3.4, 7);
    trunk.translate(0, 1.7, 0);
    const tiers = [];
    for (let i = 0; i < 4; i++) {
      const r = 2.15 - i * 0.42, h = 2.0 - i * 0.25;
      const cone = new THREE.ConeGeometry(r, h, 9);
      cone.translate(0, 3.1 + i * 1.35 + h / 2, 0);
      tiers.push(cone);
    }
    return { trunk, canopy: mergeGeos(tiers) };
  }

  if (kind === 'poplar') {
    // tall, narrow, formal: the tree you line an avenue with
    const trunk = new THREE.CylinderGeometry(0.1, 0.17, 4.2, 7);
    trunk.translate(0, 2.1, 0);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.IcosahedronGeometry(1.0 - i * 0.11, 1);
      g.applyMatrix4(M4(0, 4.2 + i * 1.15, 0, 0, i * 1.1, 0, 0.72, 1.25, 0.72));
      parts.push(g);
    }
    return { trunk, canopy: mergeGeos(parts) };
  }

  if (kind === 'palm') {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.CylinderGeometry(0.13 - i * 0.008, 0.17 - i * 0.008, 1.1, 7);
      // a leaning trunk is what makes a palm read as a palm
      seg.applyMatrix4(M4(Math.sin(i * 0.5) * 0.22, 0.55 + i * 1.05, 0, 0, 0, i * 0.035));
      parts.push(seg);
    }
    const fronds = [];
    for (let i = 0; i < 9; i++) {
      const f = new THREE.ConeGeometry(0.34, 3.0, 4);
      f.applyMatrix4(M4(0, 6.6, 0, -1.15, (i / 9) * 6.283, 0, 1, 1, 0.28));
      f.translate(Math.cos((i / 9) * 6.283) * 1.25, -0.35, Math.sin((i / 9) * 6.283) * 1.25);
      fronds.push(f);
    }
    return { trunk: mergeGeos(parts), canopy: mergeGeos(fronds) };
  }

  // 'plane': the broad street tree, the default everywhere
  return { trunk: buildTree(), canopy: buildCanopy() };
}

export function buildBollard() {
  const g = new THREE.CylinderGeometry(0.08, 0.1, 0.95, 8);
  g.translate(0, 0.475, 0);
  return g;
}

export function buildBin() {
  const g = new THREE.CylinderGeometry(0.26, 0.22, 0.95, 10);
  g.translate(0, 0.475, 0);
  return g;
}

export function buildShelter() {
  const parts = [];
  const roof = new THREE.BoxGeometry(4.2, 0.12, 1.55);
  roof.translate(0, 2.62, 0);
  parts.push(roof);
  for (const x of [-1.95, 1.95]) {
    for (const z of [-0.68, 0.68]) {
      const post = new THREE.BoxGeometry(0.1, 2.6, 0.1);
      post.translate(x, 1.3, z);
      parts.push(post);
    }
  }
  const back = new THREE.BoxGeometry(4.0, 2.0, 0.06);
  back.translate(0, 1.35, -0.72);
  const bench = new THREE.BoxGeometry(3.4, 0.09, 0.42);
  bench.translate(0, 0.52, -0.42);
  parts.push(back, bench);
  return mergeGeos(parts);
}

/* --- roof plant. Victorian skylines were chimneys; modern ones are this. --- */

export function buildAcUnit() {
  const parts = [];
  const body = new THREE.BoxGeometry(1.5, 0.85, 1.2);
  body.translate(0, 0.425, 0);
  parts.push(body);
  const fan = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12);
  fan.translate(0, 0.9, 0);
  parts.push(fan);
  for (const x of [-0.55, 0.55]) {
    const leg = new THREE.BoxGeometry(0.12, 0.22, 1.1);
    leg.translate(x, 0.11, 0);
    parts.push(leg);
  }
  return mergeGeos(parts);
}

export function buildWaterTank() {
  const parts = [];
  const drum = new THREE.CylinderGeometry(1.05, 1.05, 1.9, 12);
  drum.translate(0, 2.35, 0);
  parts.push(drum);
  const lid = new THREE.ConeGeometry(1.12, 0.42, 12);
  lid.translate(0, 3.5, 0);
  parts.push(lid);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const leg = new THREE.BoxGeometry(0.13, 1.4, 0.13);
    leg.translate(Math.cos(a) * 0.78, 0.7, Math.sin(a) * 0.78);
    parts.push(leg);
  }
  return mergeGeos(parts);
}

export function buildRoofHut() {
  const parts = [];
  const hut = new THREE.BoxGeometry(3.0, 2.6, 2.4);
  hut.translate(0, 1.3, 0);
  parts.push(hut);
  const cap = new THREE.BoxGeometry(3.3, 0.16, 2.7);
  cap.translate(0, 2.66, 0);
  parts.push(cap);
  const flue = new THREE.CylinderGeometry(0.17, 0.17, 1.5, 8);
  flue.translate(1.1, 3.4, 0.7);
  parts.push(flue);
  const mast = new THREE.BoxGeometry(0.09, 4.2, 0.09);
  mast.translate(-1.2, 4.7, -0.8);
  parts.push(mast);
  return mergeGeos(parts);
}
