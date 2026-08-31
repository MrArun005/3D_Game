/**
 * Mesh -> .glb, one primitive per material.
 *
 * Materials carry only their library name and a flat greybox base colour. The
 * real PBR sets are bound by name at load time from the material library, so a
 * blockout never ships a texture. See docs/ART_BIBLE.md.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/* Greybox tints. Deliberately desaturated and close in value: a blockout you
 * can read the FORM of, not a colour rehearsal. Halstead Bay's palette is set
 * in ART_BIBLE.md and gets applied when real materials land. */
export const TINT = {
  concrete_cast: [0.62, 0.62, 0.60], concrete_precast: [0.70, 0.70, 0.68],
  brick_red: [0.52, 0.36, 0.30], brick_painted: [0.66, 0.62, 0.58],
  plaster_worn: [0.72, 0.70, 0.66], stone_dressed: [0.68, 0.66, 0.61],
  glass_curtain: [0.32, 0.38, 0.44], glass_shop: [0.40, 0.46, 0.50],
  metal_painted: [0.38, 0.40, 0.42], metal_galv: [0.60, 0.62, 0.64],
  metal_rust: [0.45, 0.32, 0.24], alloy_polished: [0.72, 0.73, 0.75],
  asphalt: [0.22, 0.22, 0.23], asphalt_wet: [0.14, 0.15, 0.16],
  pavement_slab: [0.55, 0.55, 0.53], kerb_stone: [0.60, 0.60, 0.58],
  timber_painted: [0.58, 0.55, 0.50], timber_bare: [0.50, 0.40, 0.30],
  fabric_awning: [0.48, 0.44, 0.42], plastic_signage: [0.65, 0.63, 0.60],
  car_paint: [0.40, 0.42, 0.46], car_glass: [0.30, 0.34, 0.38],
  tyre_rubber: [0.12, 0.12, 0.13], chrome_trim: [0.75, 0.76, 0.78],
  foliage: [0.13, 0.19, 0.10], bark: [0.19, 0.15, 0.12], grass: [0.17, 0.23, 0.12],
  skin: [0.23, 0.14, 0.10], hair: [0.05, 0.04, 0.03],
  cloth_shirt: [0.12, 0.13, 0.16], cloth_trouser: [0.05, 0.06, 0.09],
  shoe_leather: [0.04, 0.035, 0.03],
};

const METAL = new Set(['metal_painted', 'metal_galv', 'metal_rust', 'alloy_polished', 'chrome_trim']);

export async function writeGlb(mesh, { name, category, dir }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const gmesh = doc.createMesh(`${category}_${name}`);

  for (const [matName, g] of mesh.groups) {
    if (!g.idx.length) continue;
    const tint = TINT[matName] ?? [0.6, 0.6, 0.6];
    const material = doc.createMaterial(matName)
      .setBaseColorFactor([...tint, 1])
      .setRoughnessFactor(METAL.has(matName) ? 0.4 : 0.85)
      .setMetallicFactor(METAL.has(matName) ? 1 : 0);

    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor()
        .setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor()
        .setType('VEC3').setArray(new Float32Array(g.nrm)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor()
        .setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer))
      // COLOR_0 carries the baked AO. glTF multiplies it into base colour, so
      // it needs no material setup and survives straight into the game.
      .setAttribute('COLOR_0', doc.createAccessor()
        .setType('VEC4').setArray(new Float32Array(
          g.ao.flatMap((a) => [a, a, a, 1]))).setBuffer(buffer))
      .setIndices(doc.createAccessor()
        .setType('SCALAR').setArray(new Uint32Array(g.idx)).setBuffer(buffer))
      .setMaterial(material);
    gmesh.addPrimitive(prim);
  }

  const node = doc.createNode(`${category}_${name}`).setMesh(gmesh);
  doc.createScene().addChild(node);

  await mkdir(dir, { recursive: true });
  await new NodeIO().write(path.join(dir, `${name}.glb`), doc);
}

export async function writeTags(dir, tags) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'tags.json'), JSON.stringify(tags) + '\n');
}
