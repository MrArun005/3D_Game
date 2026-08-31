#!/usr/bin/env node
/**
 * Character generator — parametric, rigged, Mixamo-compatible.
 *
 *   npm run genchar                 build the cast in PRESETS
 *   npm run genchar -- --list       print the parameter set
 *
 * Output: rigged .glb per character into assets/source/characters/, then
 * `npm run ingest` as usual. The skeleton uses Mixamo joint names in a T-pose,
 * so animation clips downloaded free from Mixamo retarget with no bone mapping.
 *
 * The mesh is REBUILT from the parameters rather than morphed between targets,
 * which is why every slider is continuous and why adding a parameter costs
 * nothing at runtime.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBody, DEFAULTS } from './lib/body.mjs';
import { PREFIX } from './lib/rig.mjs';
import { TINT } from './lib/gltf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/source/characters');

/* A cast, not a character. The point of a parametric body is variety, and a
 * crowd of one figure is the thing it exists to avoid. */
export const PRESETS = {
  hero:        { height: 1.82, build: 0.42, muscle: 0.72, shoulders: 0.74, chest: 0.62, hair: 0.5, posture: 0.85 },
  civ_tall:    { height: 1.90, build: 0.30, shoulders: 0.62, legLength: 0.75, hair: 0.55, posture: 0.7 },
  civ_short:   { height: 1.58, build: 0.55, hips: 0.62, legLength: 0.3, hair: 0.7, posture: 0.55 },
  civ_heavy:   { height: 1.72, build: 0.92, belly: 0.88, hips: 0.78, muscle: 0.3, hair: 0.35, posture: 0.4 },
  civ_slight:  { height: 1.64, build: 0.16, muscle: 0.28, shoulders: 0.32, hair: 0.85, posture: 0.72 },
  civ_broad:   { height: 1.78, build: 0.7, muscle: 0.88, shoulders: 0.95, chest: 0.85, hair: 0.2, posture: 0.8 },
  civ_older:   { height: 1.70, build: 0.62, belly: 0.7, muscle: 0.25, hair: 0.12, posture: 0.28 },
  civ_youth:   { height: 1.66, build: 0.26, muscle: 0.4, shoulders: 0.38, headSize: 0.62, hair: 0.9, posture: 0.78 },
  officer:     { height: 1.80, build: 0.58, muscle: 0.8, shoulders: 0.86, chest: 0.7, hair: 0.15, posture: 0.95,
                 sleeve: 0.86, trouser: 0.99, footSize: 0.75 },
};

/* -------------------------------------------------------------- exporter -- */

async function writeCharacter(name, params) {
  const { mesh, rig } = buildBody(params);

  // seat mesh AND rig together — weights are computed in world space, so the
  // two must not drift apart
  const drop = mesh.bounds().min[1];
  for (const g of mesh.groups.values()) for (let i = 1; i < g.pos.length; i += 3) g.pos[i] -= drop;
  for (const n of rig.order) rig.world[n][1] -= drop;
  // No AO bake here. bakeAO ray-tests against one AABB per loft, and a limb's
  // AABB contains its own surface — every vertex reads as fully occluded and
  // the per-vertex noise that survives reads as a checkerboard. Cavity AO for
  // a body comes from the material's ORM map instead.

  const doc = new Document();
  const buffer = doc.createBuffer();

  /* joints */
  const nodes = rig.order.map((n) => doc.createNode(PREFIX + n).setTranslation(rig.local(n)));
  rig.order.forEach((n, i) => {
    const p = rig.parent[n];
    if (p) nodes[rig.index[p]].addChild(nodes[i]);
  });

  const skin = doc.createSkin('body')
    .setInverseBindMatrices(doc.createAccessor()
      .setType('MAT4').setArray(rig.inverseBind()).setBuffer(buffer))
    .setSkeleton(nodes[0]);
  for (const n of nodes) skin.addJoint(n);

  /* geometry, one primitive per material */
  const gmesh = doc.createMesh(`character_${name}`);
  for (const [matName, g] of mesh.groups) {
    if (!g.idx.length) continue;
    const count = g.pos.length / 3;
    const joints = new Uint8Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      const w = rig.weigh([g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]]);
      joints.set(w.joints, v * 4);
      weights.set(w.weights, v * 4);
    }
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    gmesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(g.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nrm)))
      .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)))
      .setAttribute('COLOR_0', acc('VEC4', new Float32Array(g.ao.flatMap((a) => [a, a, a, 1]))))
      .setAttribute('JOINTS_0', acc('VEC4', joints))
      .setAttribute('WEIGHTS_0', acc('VEC4', weights))
      .setIndices(acc('SCALAR', new Uint32Array(g.idx)))
      // distinct base colours are not decoration: ingest runs dedup(), which
      // merges materials that differ only by name — five identical white
      // materials collapse into one and the library binding then misses four
      .setMaterial(doc.createMaterial(matName)
        .setBaseColorFactor([...(TINT[matName] ?? [0.5, 0.5, 0.5]), 1])
        .setRoughnessFactor(0.85).setMetallicFactor(0)));
  }

  const body = doc.createNode(`character_${name}`).setMesh(gmesh).setSkin(skin);
  doc.createScene().addChild(nodes[0]).addChild(body);

  const dir = path.join(SRC, name);
  await mkdir(dir, { recursive: true });
  await new NodeIO().write(path.join(dir, `${name}.glb`), doc);
  await writeFile(path.join(dir, 'tags.json'), JSON.stringify(['character', 'crowd']) + '\n');
  await writeFile(path.join(dir, 'params.json'), JSON.stringify({ ...DEFAULTS, ...params }, null, 2) + '\n');
  return { tris: mesh.tris, joints: rig.order.length };
}

async function main() {
  if (process.argv.includes('--list')) {
    console.log('parameters:\n' + Object.entries(DEFAULTS)
      .map(([k, v]) => `  ${k.padEnd(12)} ${v}`).join('\n'));
    return;
  }
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));
  for (const [name, p] of Object.entries(PRESETS)) {
    if (only.size && !only.has(name)) continue;
    const r = await writeCharacter(name, p);
    console.log(`${name.padEnd(12)} ${String(r.tris).padStart(5)}t  ${r.joints} joints`);
  }
  console.log(`\n-> ${path.relative(ROOT, SRC)}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
