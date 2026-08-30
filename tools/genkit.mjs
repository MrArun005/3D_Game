#!/usr/bin/env node
/**
 * Generate the greybox asset kit into assets/source/.
 *
 *   npm run genkit           write every asset
 *   npm run genkit -- --list print the catalogue without writing
 *   npm run genkit -- bin lamp_arterial   only these
 *
 * One file per asset under tools/assets/<category>/<name>.mjs. There is no
 * registry: adding a file adds an asset. Each file default-exports a builder
 * returning a Mesh, and named-exports `tags`.
 *
 * These are BLOCKOUTS: correct proportions, UVs, library materials and origins,
 * and no surface detail. The workflow is to open one in Blender, keep the
 * proportions, and model on top. Regenerating OVERWRITES — once you have
 * refined an asset by hand, delete its generator file or it will be clobbered.
 * See docs/PIPELINE.md.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeGlb, writeTags } from './lib/gltf.mjs';
import { setDetail } from './lib/mesh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'tools/assets');
const SRC = path.join(ROOT, 'assets/source');

const args = process.argv.slice(2);
const LIST_ONLY = args.includes('--list');
const ONLY = new Set(args.filter((a) => !a.startsWith('--')));

async function discover() {
  const found = [];
  for (const entry of await readdir(ASSETS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;          // tools/assets/README.md is not a category
    const category = entry.name;
    const dir = path.join(ASSETS, category);
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith('.mjs')) continue;
      const name = file.slice(0, -4);
      if (ONLY.size && !ONLY.has(name)) continue;
      const mod = await import(pathToFileURL(path.join(dir, file)).href);
      if (typeof mod.default !== 'function') {
        console.warn(`skip ${category}/${name}: no default-exported builder`);
        continue;
      }
      found.push({ category, name, build: mod.default, tags: mod.tags ?? [] });
    }
  }
  return found;
}

async function main() {
  const assets = await discover();
  const rows = [];

  for (const { category, name, build, tags } of assets) {
    setDetail(0);
    const mesh = build();
    mesh.seat();
    mesh.bakeAO();
    const b = mesh.bounds();
    rows.push({
      category, name, tags, tris: mesh.tris,
      size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    });
    if (LIST_ONLY) continue;
    const dir = path.join(SRC, category, name);
    await writeGlb(mesh, { name, category, dir });
    await writeTags(dir, tags);

    // authored LODs, not decimated ones - see setDetail in lib/mesh.mjs
    for (const level of [1, 2]) {
      setDetail(level);
      const lod = build();
      lod.seat();
      lod.bakeAO();
      await writeGlb(lod, { name: `${name}.lod${level}`, category, dir });
    }
    setDetail(0);
  }

  rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  for (const r of rows) {
    console.log(
      `${r.category.padEnd(7)} ${r.name.padEnd(24)} ${String(r.tris).padStart(4)}t  ` +
      `${r.size.map((v) => v.toFixed(2)).join(' x ')}  ${r.tags.join(' ')}`
    );
  }
  const total = rows.reduce((n, r) => n + r.tris, 0);
  console.log(`\n${rows.length} assets, ${total} triangles` +
    (LIST_ONLY ? ' (nothing written)' : ` -> ${path.relative(ROOT, SRC)}/`));

  const untagged = rows.filter((r) => !r.tags.length).map((r) => r.name);
  if (untagged.length) console.log(`\nuntagged, so never placed: ${untagged.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
