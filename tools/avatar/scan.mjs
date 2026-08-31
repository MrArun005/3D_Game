/**
 * Scan a folder of converted wardrobe GLBs and report what is in it.
 *
 * Run this first, before any binding code is written. Every character pack
 * names and rigs things its own way, and guessing at that is how you get a
 * jacket bound to the wrong spine bone. This prints the facts:
 *
 *   - which slot each file belongs in, guessed from its name
 *   - triangle count against the per-part budget
 *   - the rig: joint count, naming scheme, and how many of our 67 joints match
 *
 * The match count is the number that decides the strategy:
 *   67/67 identical names -> bind directly, no work
 *   Mixamo names          -> strip the `mixamorig:` prefix and bind
 *   partial               -> map by name, rebind the rest
 *   0                     -> not a humanoid rig, or a static prop; fit by hand
 *
 *   node tools/avatar/scan.mjs <dir> [reference.glb]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
import path from 'node:path';

/** Filename keyword -> slot. First match wins, so order matters. */
const SLOT_RULES = [
  [/beard|goatee|stubble|moustache|mustache|chinstrap/i, 'beard'],
  [/hair|afro|braid|ponytail|bun|dread|buzz|bald/i, 'hair'],
  [/hat|cap|beanie|helmet|hood(?!ie)|headband|bandana/i, 'headwear'],
  [/glass|shade|goggle|monocle/i, 'eyewear'],
  [/jacket|coat|hoodie|blazer|parka|bomber|windbreak/i, 'jacket'],
  [/shirt|tee|top|sweater|jumper|pullover|polo|tank|vest|torso|chest|body|upper/i, 'top'],
  [/trouser|pant|jean|short|skirt|legging|leg(?!acy)|lower/i, 'bottom'],
  [/shoe|boot|sneaker|trainer|sandal|foot/i, 'footwear'],
  [/glove|gauntlet|hand|watch|bracelet/i, 'hands'],
  [/head|face|skull/i, 'head'],
  [/backpack|bag|belt|scarf|tie|necklace|earring|accessor/i, 'accessory'],
];

/** From docs/BUDGETS.md — a wardrobe part is a small prop. */
const BUDGET = { beard: 900, hair: 1500, headwear: 900, eyewear: 400, jacket: 3000,
                 top: 3000, bottom: 3000, footwear: 1200, hands: 900, head: 4000,
                 accessory: 900, '?': 3000 };

const classify = (name) => {
  for (const [re, slot] of SLOT_RULES) if (re.test(name)) return slot;
  return '?';
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(glb|gltf)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function joints(file) {
  const r = (await io.read(file)).getRoot();
  const skin = r.listSkins()[0];
  return {
    root: r,
    names: skin ? skin.listJoints().map((j) => j.getName()) : [],
    tris: r.listMeshes().reduce((t, m) => t + m.listPrimitives()
      .reduce((u, p) => u + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0),
    meshes: r.listMeshes().map((m) => m.getName()),
    morphs: r.listMeshes()[0]?.listPrimitives()[0]?.listTargets().length ?? 0,
    clips: r.listAnimations().map((a) => a.getName()),
    textures: r.listTextures().length,
  };
}

const dir = process.argv[2];
const refPath = process.argv[3] ?? 'public/models/avatar/male.glb';
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node tools/avatar/scan.mjs <dir> [reference.glb]');
  process.exit(2);
}

let ref = [];
if (fs.existsSync(refPath)) {
  ref = (await joints(refPath)).names;
  console.log(`reference rig: ${refPath} — ${ref.length} joints\n`);
} else {
  console.log(`reference rig ${refPath} not found; skipping match column\n`);
}
const refSet = new Set(ref);
const strip = (n) => n.replace(/^mixamorig[:_]?/i, '');
const refStripped = new Set(ref.map(strip));

const files = walk(dir);
if (!files.length) { console.log('no .glb/.gltf under ' + dir); process.exit(1); }

const bySlot = {};
console.log('slot        file                                        tris   budget  joints  match  naming');
console.log('-'.repeat(108));
for (const f of files) {
  const base = path.basename(f).replace(/\.(glb|gltf)$/i, '');
  const slot = classify(base + ' ' + path.dirname(f));
  let j;
  try { j = await joints(f); } catch (e) { console.log(`${slot.padEnd(11)} ${base.padEnd(43)} UNREADABLE ${e.message}`); continue; }
  const exact = j.names.filter((n) => refSet.has(n)).length;
  const viaStrip = j.names.filter((n) => refStripped.has(strip(n))).length;
  const naming = j.names.length === 0 ? 'static'
    : /^mixamorig/i.test(j.names[0]) ? 'mixamo-prefixed'
    : refStripped.has(strip(j.names[0])) ? 'mixamo-clean' : 'custom';
  const over = j.tris > (BUDGET[slot] ?? 3000) ? ' OVER' : '';
  console.log(`${slot.padEnd(11)} ${base.slice(0, 43).padEnd(43)} ${String(j.tris | 0).padStart(6)} ${String(BUDGET[slot] ?? 3000).padStart(7)}${over.padEnd(5)} ${String(j.names.length).padStart(6)} ${String(Math.max(exact, viaStrip)).padStart(6)}  ${naming}`);
  (bySlot[slot] ??= []).push(base);
}

console.log('\nby slot:');
for (const [s, v] of Object.entries(bySlot).sort()) console.log(`  ${s.padEnd(11)} ${v.length}  ${v.slice(0, 8).join(', ')}${v.length > 8 ? ' …' : ''}`);
if (bySlot['?']) console.log('\n  "?" means the filename matched no rule — add a pattern to SLOT_RULES.');
