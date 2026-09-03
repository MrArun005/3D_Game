// In-place glTF slimming for big vendor files: weld + simplify + 1k textures.
// node tools/optimise-glb.mjs <file.glb> [--tris N] [--tex 1024]
// Geometry stays plain (no meshopt encoding) so every GLTFLoader in src/ can read it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, resample, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? +rest[i + 1] : d; };
const TRIS = opt("--tris", 0), TEX = opt("--tex", 1024), KEEP = rest.includes("--keep-nodes"), ERR = opt("--error", 0.001);   // --error: simplifier tolerance; many tiny instanced parts need ~0.02 to shrink at all   // --keep-nodes: callers hide parts by node name

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const tris = () => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
  .reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const before = { bytes: statSync(file).size, tris: tris() };

const skinned = doc.getRoot().listSkins().length > 0;
const steps = [dedup(), prune(), resample()];
if (!skinned && !KEEP) steps.push(flatten(), join());   // static props: fewer draws too
steps.push(weld());
if (TRIS && before.tris > TRIS) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: TRIS / before.tris, error: ERR, lockBorder: true }));
steps.push(
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 85, resize: [TEX, TEX], slots: /baseColor|emissive|diffuse/i }),
  textureCompress({ encoder: sharp, targetFormat: 'png', resize: [TEX, TEX], slots: /normal|metallicRoughness|occlusion|specular/i }),
  prune(),
);
await doc.transform(...steps);
await io.write(file, doc);
const after = { bytes: statSync(file).size, tris: tris() };
const mb = b => (b / 1048576).toFixed(1) + 'MB';
console.log(`${file.split('/').pop()}: ${mb(before.bytes)} -> ${mb(after.bytes)}, ${Math.round(before.tris)} -> ${Math.round(after.tris)} tris${skinned ? ' (skinned)' : ''}`);
