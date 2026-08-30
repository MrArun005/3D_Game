import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { M4 } from '../core/geometry.js';
import {
  CELL, ROAD_HALF, PARKING, WALK_W, CORR_HALF, KERB_H, BLOCK,
} from './metrics.js';
import { KINDS, ARCH, TOWER, MID, LOFT, DECK, PODIUM } from './facades.js';
import { signalHeads, signalState, LAMP_COLOURS } from './signals.js';
import { PAINT_COLOURS, BODY_KEYS, BODY_TYPES } from '../vehicle/config.js';

/**
 * Instanced draw with culling disabled.
 * three culls an InstancedMesh by its GEOMETRY's bounding sphere — a unit box at
 * the cell origin — not by where the instances actually are, so a cell's contents
 * would vanish whenever that one point left the frustum. The pool is bounded
 * (25 cells), so switching culling off is correct rather than merely convenient.
 */
/**
 * Per-instance UV scale.
 * Box UVs run 0..1 over each face, so a shared facade texture was stretched
 * over the whole building — a 78m tower ended up with 20m windows. This feeds
 * a per-instance scale into the shader so the tile repeats at its real size.
 */
export function makeTileable(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUvScale;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv *= aUvScale;
#endif
#ifdef USE_EMISSIVEMAP
  vEmissiveMapUv *= aUvScale;
#endif`);
  };
  material.customProgramCacheKey = () => 'tiled-facade';
  return material;
}

/**
 * Free a streamed-out cell.
 *
 * This file called dispose() exactly zero times, so every cell that left the
 * radius leaked its InstancedMesh buffers and its cloned per-instance
 * geometry. Only geometry we cloned is ours -- the shared assets.geo.* is
 * still being drawn by every other live cell.
 */
function releaseCell(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry?.userData?.owned) o.geometry.dispose();
  });
}

function addInstanced(parent, geometry, material, matrices, shadow = false,
                      colours = null, uvScales = null) {
  if (!matrices.length) return null;
  // the attribute is per-instance, so the geometry cannot be shared
  // a per-instance attribute cannot live on shared geometry, so this clone is
  // ours and has to be freed when the cell streams out
  const geo = uvScales ? geometry.clone() : geometry;
  if (uvScales) geo.userData.owned = true;
  const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
  if (uvScales) {
    geo.setAttribute('aUvScale',
      new THREE.InstancedBufferAttribute(new Float32Array(uvScales), 2));
  }
  mesh.frustumCulled = false;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  if (colours) {
    const c = new THREE.Color();
    colours.forEach((hex, i) => mesh.setColorAt(i, c.setHex(hex)));
    mesh.instanceColor.needsUpdate = true;
  }
  if (shadow) mesh.castShadow = true;
  // Facades bake their own light. Receiving the sun shadow map on those
  // walls is what crawls as acne when two faces share a plane.
  mesh.receiveShadow = !uvScales;
  parent.add(mesh);
  return mesh;
}

export class City {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.cells = new Map();
    this.parked = new Map();     // cell key -> collision bodies for parked cars
    this.nearRadius = 1;
    this.farRadius = 2;
  }

  /**
   * Parked cars near a point, as collision bodies. Only the nine surrounding
   * cells are consulted, so this stays a handful of candidates however far the
   * city streams.
   */
  nearbyParked(x, z) {
    const ci = Math.round(x / CELL), cj = Math.round(z / CELL);
    const out = [];
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.parked.get(`${i},${j}`);
        if (list) out.push(...list);
      }
    }
    return out;
  }

  update(x, z) {
    const pci = Math.round(x / CELL);
    const pcj = Math.round(z / CELL);
    for (let i = pci - this.farRadius; i <= pci + this.farRadius; i++) {
      for (let j = pcj - this.farRadius; j <= pcj + this.farRadius; j++) {
        const key = `${i},${j}`;
        const near = Math.max(Math.abs(i - pci), Math.abs(j - pcj)) <= this.nearRadius;
        const existing = this.cells.get(key);
        if (existing && existing.userData.near !== near) {
          this.scene.remove(existing);
          releaseCell(existing);
          this.cells.delete(key);
          this.parked.delete(key);
        }
        if (!this.cells.has(key)) this.cells.set(key, this.buildCell(i, j, near));
      }
    }
    for (const [key, group] of [...this.cells]) {
      const [i, j] = key.split(',').map(Number);
      if (Math.abs(i - pci) > this.farRadius || Math.abs(j - pcj) > this.farRadius) {
        this.scene.remove(group);
        releaseCell(group);
        this.cells.delete(key);
        this.parked.delete(key);
      }
    }
  }

  /** Recolour every visible signal lens for the current phase. */
  updateSignals(t) {
    const c = new THREE.Color();
    for (const group of this.cells.values()) {
      const sig = group.userData.signals;
      if (!sig) continue;
      for (const m of sig.meta) {
        const cols = LAMP_COLOURS[signalState(sig.i, sig.j, m.axis, t)];
        for (let k = 0; k < 3; k++) sig.mesh.setColorAt(m.base + k, c.setHex(cols[k]));
      }
      sig.mesh.instanceColor.needsUpdate = true;
    }
  }

  buildCell(ci, cj, near) {
    const A = this.assets;
    const group = new THREE.Group();
    const ox = ci * CELL, oz = cj * CELL;
    const rand = mulberry32((((ci & 1023) << 11) ^ (cj & 1023) ^ 0x9e37) >>> 0 || 17);

    this.#carriageway(group, ox, oz);
    this.#pavements(group, ox, oz);
    this.#buildings(group, ci, cj, ox, oz, rand, near);
    if (near) this.#streetLife(group, ox, oz, rand, `${ci},${cj}`, ci, cj);

    group.userData = { ci, cj, near };
    this.scene.add(group);
    return group;
  }

  // --- roads: the intersection plus the two arms this cell owns ---------
  #carriageway(group, ox, oz) {
    const A = this.assets;
    const inter = new THREE.Mesh(A.geo.plane, A.mat.intersection);
    inter.rotation.x = -Math.PI / 2;
    inter.scale.set(ROAD_HALF * 2, ROAD_HALF * 2, 1);
    inter.position.set(ox, 0, oz);
    inter.receiveShadow = true;
    group.add(inter);

    const armLen = CELL - ROAD_HALF * 2;
    // arm along +Z
    const armZ = new THREE.Mesh(A.geo.plane, A.mat.road);
    armZ.rotation.x = -Math.PI / 2;
    armZ.scale.set(ROAD_HALF * 2, armLen, 1);
    armZ.position.set(ox, 0, oz + ROAD_HALF + armLen / 2);
    armZ.receiveShadow = true;
    group.add(armZ);
    // arm along +X. The z-rotation swaps the local axes before the plane is laid
    // down, so the lane markings still run with the road.
    const armX = new THREE.Mesh(A.geo.plane, A.mat.road);
    armX.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    armX.scale.set(ROAD_HALF * 2, armLen, 1);
    armX.position.set(ox + ROAD_HALF + armLen / 2, 0, oz);
    armX.receiveShadow = true;
    group.add(armX);
  }

  #pavements(group, ox, oz) {
    const A = this.assets;
    const bx = ox + CELL / 2, bz = oz + CELL / 2;
    const kerbs = [];
    // The two X-side strips run long and cover the corners; the Z-side strips
    // stop at the block edge. Running all four long made them overlap in the
    // four corner squares at exactly y=KERB_H — two coplanar surfaces fighting
    // for the depth buffer, which reads as flashing pavement and kerbs.
    for (const [sx, sz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const long = BLOCK + WALK_W * 2;
      const runLen = sx ? long : BLOCK;
      const px = bx - sx * (BLOCK / 2 + WALK_W / 2);
      const pz = bz - sz * (BLOCK / 2 + WALK_W / 2);
      const walk = new THREE.Mesh(A.geo.plane, A.mat.walk);
      walk.rotation.x = -Math.PI / 2;
      if (!sx) walk.rotation.z = Math.PI / 2;
      walk.scale.set(WALK_W, runLen, 1);
      walk.position.set(px, KERB_H, pz);
      walk.receiveShadow = true;
      group.add(walk);
      kerbs.push(M4(
        px + sx * (WALK_W / 2 - 0.07), 0, pz + sz * (WALK_W / 2 - 0.07),
        0, 0, 0,
        sx ? 0.14 : runLen, KERB_H, sx ? runLen : 0.14,
      ));
    }
    addInstanced(group, A.geo.box, A.mat.kerb, kerbs);
  }

  // --- perimeter blocks, in runs that share an archetype ----------------
  #buildings(group, ci, cj, ox, oz, rand, near) {
    const A = this.assets;
    const bx = ox + CELL / 2, bz = oz + CELL / 2;
    const facades = {};        // key -> { m: matrices, uv: uv scales }
    const bases = {};
    const roofs = [];
    const glassRoofs = [];
    const crowns = [];
    const masts = [];
    const plant = { ac: [], tank: [], hut: [] };
    const BASE = A.baseHeight;

    for (const [sx, sz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      // North/south faces own the corners. East/west stop short so two
      // street walls never occupy the same lot — that is the z-fight.
      const inset = sx ? 19 : 0;
      let t = -BLOCK / 2 + inset, runLeft = 0, kind = MID, variant = 0, runH = 0;
      while (t < BLOCK / 2 - inset - 4) {
        if (runLeft <= 0) {
          kind = KINDS[Math.floor(rand() * KINDS.length)];
          variant = (ci * 5 + cj * 3 + kind.length + 300) % 3;
          const spec = ARCH[kind];
          const storeys =
            kind === TOWER ? 16 + Math.floor(rand() * 28)
            : kind === MID ? 8 + Math.floor(rand() * 8)
            : kind === LOFT ? 7 + Math.floor(rand() * 9)
            : kind === DECK ? 5 + Math.floor(rand() * 5)
            : 2 + Math.floor(rand() * 2);
          runH = Math.round(storeys / spec.floors) * spec.floors * spec.storey;
          runLeft = kind === TOWER ? 1 : 1 + Math.floor(rand() * 2);
        }
        const spec = ARCH[kind];
        const w = spec.wide * (0.88 + rand() * 0.28);
        if (t + w > BLOCK / 2 - inset) break;
        const depth = kind === TOWER ? 10 + rand() * 6 : 11 + rand() * 7;
        const h = Math.max(BASE + 4, runH * (0.96 + rand() * 0.08));

        const fx = bx - sx * (BLOCK / 2 - depth / 2);
        const fz = bz - sz * (BLOCK / 2 - depth / 2);
        const px = bx + (t + w / 2);
        const pz = bz + (t + w / 2);
        const rot = sx ? 0 : Math.PI / 2;
        const X = sx ? fx : px;
        const Z = sx ? pz : fz;

        const rb = rand();
        const baseKey = kind === PODIUM || kind === DECK ? 1
                      : rb < 0.62 ? 0 : rb < 0.88 ? 1 : 2;
        const tileW = spec.wide, tileH = spec.floors * spec.storey;
        const baseH = BASE + (rand() - 0.5) * 0.5;
        const baseBucket = (bases[baseKey] ??= { m: [], uv: [] });
        baseBucket.m.push(M4(X, 0, Z, 0, rot, 0, depth + 0.12, baseH, w + 0.12));
        baseBucket.uv.push((w + 0.12) / 9.0, baseH / BASE);

        const key = `${kind}|${variant}`;
        const bucket = (facades[key] ??= { m: [], uv: [] });
        const SINK = 0.35;
        const y0 = baseH - SINK;
        const shaftH = h - y0;
        const glassTop = kind === TOWER || kind === MID;

        const stage = (yy, hh, dk, wk) => {
          bucket.m.push(M4(X, yy, Z, 0, rot, 0, depth * dk, hh, w * wk));
          bucket.uv.push((w * wk) / tileW, hh / tileH);
        };

        let topK = 1;
        if (kind === TOWER && shaftH > 48 && rand() < 0.75) {
          const a = shaftH * 0.42, b = shaftH * 0.32;
          const k1 = 0.84 + rand() * 0.06, k2 = 0.66 + rand() * 0.08;
          stage(y0, a, 1, 1);
          stage(y0 + a - SINK, b, k1, k1);
          stage(y0 + a + b - SINK * 2, h - (y0 + a + b - SINK * 2), k2, k2);
          (glassTop ? glassRoofs : roofs).push(
            M4(X, y0 + a - SINK, Z, 0, rot, 0, depth + 0.1, 0.5 + SINK, w + 0.1),
            M4(X, y0 + a + b - SINK * 2, Z, 0, rot, 0, depth * k1 + 0.1, 0.5 + SINK, w * k1 + 0.1),
            M4(X, h - SINK, Z, 0, rot, 0, depth * k2 + 0.1, 0.7 + SINK, w * k2 + 0.1),
          );
          topK = k2;
        } else if ((kind === TOWER || kind === MID) && shaftH > 28 && rand() < 0.7) {
          const split = shaftH * (0.58 + rand() * 0.14);
          const k = 0.78 + rand() * 0.08;
          stage(y0, split, 1, 1);
          stage(y0 + split - SINK, h - (y0 + split - SINK), k, k);
          (glassTop ? glassRoofs : roofs).push(
            M4(X, y0 + split - SINK, Z, 0, rot, 0, depth + 0.1, 0.5 + SINK, w + 0.1),
            M4(X, h - SINK, Z, 0, rot, 0, depth * k + 0.1, 0.7 + SINK, w * k + 0.1),
          );
          topK = k;
        } else {
          stage(y0, shaftH, 1, 1);
          (glassTop ? glassRoofs : roofs).push(
            M4(X, h - SINK, Z, 0, rot, 0, depth + 0.1, 0.7 + SINK, w + 0.1),
          );
        }

        if (kind === TOWER) {
          crowns.push(M4(
            X, h + 0.55, Z, 0, rot, 0,
            depth * topK * 0.52, 1.4 + rand() * 1.6, w * topK * 0.52,
          ));
          if (rand() < 0.55) {
            masts.push(M4(X, h + 3.2 + rand() * 4, Z, 0, 0, 0, 0.16, 8 + rand() * 14, 0.16));
          }
        }

        if (near && w > 7 && kind !== TOWER) {
          const n = 1 + Math.floor(rand() * 2);
          for (let i = 0; i < n; i++) {
            const jx = (rand() - 0.5) * (sx ? depth * 0.5 : w * 0.5);
            const jz = (rand() - 0.5) * (sx ? w * 0.5 : depth * 0.5);
            const r = rand();
            const pick = r < 0.6 ? 'ac' : r < 0.85 ? 'tank' : 'hut';
            plant[pick].push(M4(X + jx, h + 0.8, Z + jz, 0, rand() * 6.28, 0));
          }
        }

        t += w + 0.18;
        runLeft--;
      }
    }
    for (const key of Object.keys(facades)) {
      const [kind, variant] = key.split('|');
      const b = facades[key];
      addInstanced(group, A.geo.box, A.facades[kind][+variant], b.m, false, null, b.uv);
    }
    for (const key of Object.keys(bases)) {
      const b = bases[key];
      addInstanced(group, A.geo.box, A.base.materials[+key], b.m, false, null, b.uv);
    }
    addInstanced(group, A.geo.box, A.mat.roof, roofs);
    addInstanced(group, A.geo.box, A.mat.roofGlass, glassRoofs);
    addInstanced(group, A.geo.box, A.mat.crown, crowns);
    addInstanced(group, A.geo.box, A.mat.pole, masts);
    addInstanced(group, A.geo.ac, A.mat.plant, plant.ac, true);
    addInstanced(group, A.geo.tank, A.mat.plant, plant.tank, true);
    addInstanced(group, A.geo.hut, A.mat.plant, plant.hut, true);
  }

  // --- lamps, trees, signals, parked cars --------------------------------
  #streetLife(group, ox, oz, rand, cellKey, ci, cj) {
    const A = this.assets;
    const bx = ox + CELL / 2, bz = oz + CELL / 2;
    const lamps = [], heads = [], trees = [], canopies = [];
    const bollards = [], bins = [], shelters = [], signals = [];
    const lampPoints = [];
    const parked = {};                 // body style -> { m: [], c: [] }
    const bodies = [];                 // collision proxies for the same cars
    const addParked = (x, z, yaw) => {
      const key = BODY_KEYS[Math.floor(rand() * BODY_KEYS.length)];
      const bucket = (parked[key] ??= { m: [], c: [] });
      bucket.m.push(M4(x, 0, z, 0, yaw, 0));
      bucket.c.push(PAINT_COLOURS[Math.floor(rand() * PAINT_COLOURS.length)]);
      const spec = BODY_TYPES[key];
      bodies.push({
        x, z, yaw,
        offsets: [-spec.L * 0.31, 0, spec.L * 0.31],
        radius: Math.max(0.92, spec.wMax * 1.02),
        reach: spec.L * 0.5 + 0.6,
      });
    };

    for (const [sx, sz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const px0 = bx - sx * (BLOCK / 2 + WALK_W * 0.72);
      const pz0 = bz - sz * (BLOCK / 2 + WALK_W * 0.72);
      const yaw = sx ? (sx > 0 ? Math.PI : 0) : (sz > 0 ? -Math.PI / 2 : Math.PI / 2);

      for (let t = -BLOCK / 2 + 8; t < BLOCK / 2 - 6; t += 26) {
        const jx = sx ? px0 : bx + t;
        const jz = sx ? bz + t : pz0;
        lamps.push(M4(jx, KERB_H, jz, 0, yaw, 0));
        heads.push(M4(jx, KERB_H, jz, 0, yaw, 0));
        lampPoints.push([jx + Math.sin(yaw) * 1.42, 8.36 + KERB_H, jz + Math.cos(yaw) * 1.42]);

        if (rand() < 0.75) {
          const tt = t + 13;
          const tx = sx ? px0 : bx + tt;
          const tz = sx ? bz + tt : pz0;
          const m = M4(tx, KERB_H, tz, 0, rand() * 6.28, 0, 1, 0.9 + rand() * 0.3, 1);
          trees.push(m); canopies.push(m);
        }
        if (rand() < 0.35) {
          bins.push(M4(sx ? px0 : bx + t + 5, KERB_H, sx ? bz + t + 5 : pz0, 0, rand() * 6.28, 0));
        }
      }
      if (rand() < 0.45) {
        const t = -BLOCK / 2 + 22 + rand() * (BLOCK - 50);
        shelters.push(M4(sx ? px0 : bx + t, KERB_H, sx ? bz + t : pz0, 0, yaw + Math.PI / 2, 0));
      }
      for (let t = -BLOCK / 2 + 4; t < BLOCK / 2 - 4; t += 3.4) {
        if (rand() >= 0.22) continue;
        bollards.push(M4(
          sx ? bx - sx * (BLOCK / 2 + WALK_W - 0.55) : bx + t, KERB_H,
          sx ? bz + t : bz - sz * (BLOCK / 2 + WALK_W - 0.55), 0, 0, 0,
        ));
      }
    }

    // parked cars in the kerbside bays of the two arms this cell owns.
    // Each faces the legal direction for the side of the road it is on.
    const bay = ROAD_HALF - PARKING / 2;
    const armFrom = ROAD_HALF + 6, armTo = CELL - ROAD_HALF - 6;
    for (let d = armFrom; d < armTo; d += 6.4) {
      for (const side of [-1, 1]) {
        if (rand() < 0.5) {
          const yaw = side < 0 ? -Math.PI / 2 : Math.PI / 2;   // along the +Z arm
          addParked(ox + side * bay, oz + d, yaw + (rand() - 0.5) * 0.03);
        }
        if (rand() < 0.5) {
          const yaw = side < 0 ? Math.PI : 0;                  // along the +X arm
          addParked(ox + d, oz + side * bay, yaw + (rand() - 0.5) * 0.03);
        }
      }
    }

    // one signal per approach, mounted over the lane it governs
    const posts = signalHeads(ox, oz);
    const lampM = [], lampMeta = [];
    for (const h of posts) {
      signals.push(M4(h.x, KERB_H, h.z, 0, h.yaw, 0));
      const hx = h.x + Math.cos(h.yaw) * 3.25;
      const hz = h.z - Math.sin(h.yaw) * 3.25;
      lampMeta.push({ axis: h.axis, base: lampM.length });
      for (let k = 0; k < 3; k++) {
        lampM.push(M4(hx, KERB_H + 5.05 + 0.28 - k * 0.28, hz));
      }
    }

    addInstanced(group, A.geo.lamp, A.mat.pole, lamps, true);
    addInstanced(group, A.geo.lampHead, A.mat.lampGlow, heads);
    addInstanced(group, A.geo.signal, A.mat.pole, signals, true);
    const lampMesh = addInstanced(group, A.geo.signalLamp, A.mat.signalLamp, lampM,
                                  false, lampM.map(() => 0x111111));
    if (lampMesh) {
      group.userData.signals = { mesh: lampMesh, meta: lampMeta, i: ci, j: cj };
    }
    addInstanced(group, A.geo.tree, A.mat.bark, trees, true);
    addInstanced(group, A.geo.canopy, A.mat.leaf, canopies, true);
    addInstanced(group, A.geo.bollard, A.mat.pole, bollards);
    addInstanced(group, A.geo.bin, A.mat.bin, bins);
    addInstanced(group, A.geo.shelter, A.mat.pole, shelters, true);
    for (const key of Object.keys(parked)) {
      const b = parked[key];
      addInstanced(group, A.geo.stunt[key].body, A.mat.parked, b.m, true, b.c);
    }
    this.parked.set(cellKey, bodies);

    const pools = lampPoints.map((p) => M4(p[0], 0.03, p[2], -Math.PI / 2, 0, 0, 13, 13, 1));
    const poolMesh = addInstanced(group, A.geo.plane, A.mat.pool, pools);
    if (poolMesh) poolMesh.renderOrder = 2;
    const lenses = lampPoints.map((p) => M4(p[0], p[1], p[2], 0, 0, 0, 2.6, 0.9, 1.6));
    addInstanced(group, A.geo.lens, A.mat.lampGlow, lenses);
    // a faint cone of haze under each head, so the lamps light something
    const cones = lampPoints.map((p) => M4(p[0], p[1] - 4.2, p[2]));
    const coneMesh = addInstanced(group, A.geo.lampCone, A.mat.lampCone, cones);
    if (coneMesh) coneMesh.renderOrder = 3;
  }
}
