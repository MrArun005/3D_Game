// Pack a .gltf + its external .bin/textures into one self-contained .glb.
// node tools/pack-gltf.mjs <file.gltf> [out.glb]
//
// Poly Haven (and most CC0 sites) ship glTF as a directory of loose files. The
// vendor loaders in src/ all expect a single .glb, and one request beats twenty.
// Geometry stays plain — run tools/optimise-glb.mjs afterwards to slim it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';

const [file, outArg] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/pack-gltf.mjs <file.gltf> [out.glb]'); process.exit(2); }
const out = outArg ?? file.replace(/\.gltf$/i, '.glb');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
await io.write(out, doc);

const mb = b => (b / 1048576).toFixed(1) + 'MB';
console.log(`${file.split(/[\\/]/).pop()} -> ${out.split(/[\\/]/).pop()} (${mb(statSync(out).size)})`);
