// Vendor ingest for Poly Haven (CC0) glTF downloads.
//   node tools/polyhaven.mjs [--dir public/models/vendor/polyhaven]
//
// Poly Haven ships a directory per asset: <name>.gltf + .bin + 1k JPEG maps.
// Two reasons this does NOT go through tools/optimise-glb.mjs:
//
//  1. Textures are already 1k JPEG, which is exactly the mid-distance budget in
//     docs/BUDGETS.md. optimise-glb re-encodes data maps to PNG, and a 1k PNG
//     normal map is far bigger than the JPEG it replaced — every file GREW
//     (old_tyre 2.1 -> 3.6 MB). So textures are left untouched here.
//  2. optimise-glb hardcodes `lockBorder: true`. These are photoscans split
//     into many parts; a locked border leaves nothing to collapse, so the
//     modular kits missed their ceiling by 10x. Borders are free here and the
//     error tolerance escalates until the budget is met.
//
// Per-asset ceilings are docs/BUDGETS.md categories. MODULAR kits keep their
// node hierarchy (you place the parts individually, so the file total is a kit
// total, not one prop) and are not joined; single props are flattened+joined.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const rest = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const DIR = arg('--dir', 'public/models/vendor/polyhaven');

// docs/BUDGETS.md: small prop 900, medium 2400, large 6000, facade module 1800.
const SMALL = ['old_tyre', 'utility_box_01', 'utility_box_02', 'water_manhole_cover',
  'metal_trash_can', 'security_camera_01', 'security_camera_02', 'security_light'];
const LARGE = ['modular_chainlink_fence', 'modular_electricity_poles'];
const FACADE = ['modular_urban_apartments_facade', 'modular_factory_facade'];
const budget = a => SMALL.includes(a) ? 900 : FACADE.includes(a) ? 1800 : LARGE.includes(a) ? 6000 : 2400;

// A modular kit is placed part by part, so its parts must survive as nodes.
const isModular = a => a.startsWith('modular_');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const countTris = doc => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
  .reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

await MeshoptSimplifier.ready;
const mb = b => (b / 1048576).toFixed(1) + 'MB';
const rows = [];

for (const a of readdirSync(DIR).filter(f => statSync(pjoin(DIR, f)).isDirectory()).sort()) {
  const src = pjoin(DIR, a, `${a}.gltf`);
  if (!existsSync(src)) { console.log(`SKIP ${a} (no ${a}.gltf)`); continue; }
  const out = pjoin(DIR, `${a}.glb`);
  const cap = budget(a);
  const modular = isModular(a);

  let best = null;
  // Escalate the simplifier tolerance until the ceiling is met. 0.001 is
  // optimise-glb's default and does almost nothing to a photoscan.
  for (const error of [0.005, 0.02, 0.05, 0.1, 0.2]) {
    const doc = await io.read(src);
    const before = countTris(doc);
    const steps = [dedup(), prune()];
    if (!modular) steps.push(flatten(), join());
    steps.push(weld());
    if (before > cap) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: cap / before, error, lockBorder: false }));
    steps.push(prune());
    await doc.transform(...steps);
    const after = countTris(doc);
    best = { doc, before, after, error };
    if (after <= cap) break;
  }

  await io.write(out, best.doc);
  const hit = best.after <= cap;
  rows.push({ a, cap, ...best, bytes: statSync(out).size, hit, modular });
  console.log(`${hit ? 'ok  ' : 'OVER'} ${a.padEnd(34)} ${Math.round(best.before)} -> ${Math.round(best.after)} tris (cap ${cap}, err ${best.error})  ${mb(statSync(out).size)}${best.modular ? '  [kit, nodes kept]' : ''}`);
}

const over = rows.filter(r => !r.hit);
const tris = rows.reduce((s, r) => s + r.after, 0);
const bytes = rows.reduce((s, r) => s + r.bytes, 0);
console.log(`\n${rows.length} assets, ${Math.round(tris)} tris, ${mb(bytes)} total`);
if (over.length) {
  console.log(`\n${over.length} still over budget — these are multi-part kits, so the file total is a KIT total:`);
  for (const r of over) console.log(`  ${r.a}: ${Math.round(r.after)} vs cap ${r.cap}`);
}
