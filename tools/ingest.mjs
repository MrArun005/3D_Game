#!/usr/bin/env node
/**
 * Asset ingest — assets/source/**.glb  ->  public/models/**.glb + manifest.json
 *
 * Validates against docs/BUDGETS.md, optimises, generates missing LODs, and
 * emits a manifest so the world builder never has to load an asset to know how
 * big it is. See docs/PIPELINE.md.
 *
 *   npm run ingest            build
 *   npm run ingest -- --check validate only, write nothing (use in CI)
 *   npm run ingest -- --only props/bus_shelter
 *
 * Everything here is free and open source: gltf-transform (MIT), meshoptimizer
 * (MIT). KTX2 compression shells out to the gltf-transform CLI if present and
 * is skipped with a warning if not.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/source');
const OUT = path.join(ROOT, 'public/models');
const MANIFEST = path.join(OUT, 'manifest.json');

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

/* ---------------------------------------------------------------- budgets -- */
/* Mirrors docs/BUDGETS.md. Changing a number here is a decision, not a fix.   */

/* Raised 2026-08-30 from the blockout numbers (facade 400 / props 900). Every
 * edge is now chamfered and mouldings are real extruded profiles, which is what
 * takes the kit from "placeholder" to "usable" — and a chamfered box is 44
 * triangles where a sharp one is 12. LOD2 is what the city actually draws at
 * distance, so these ceilings buy detail up close without costing frame rate. */
const TRI_BUDGET = {
  facade: 1800,
  props: 2400,         // medium prop; small 900 / large 6000 by tag, see below
  vehicles: 4000,
  characters: 12000,
};

const TRI_BUDGET_BY_TAG = {
  small: 900,
  large: 6000,
  hero: 20000,
};

const MAX_TEXTURE = 2048;

/* Material library — docs/ART_BIBLE.md. An unknown material name fails ingest,
 * deliberately: a one-off material is how a city stops looking like one city. */
const MATERIALS = new Set([
  'concrete_cast', 'concrete_precast', 'brick_red', 'brick_painted',
  'plaster_worn', 'stone_dressed', 'glass_curtain', 'glass_shop',
  'metal_painted', 'metal_galv', 'metal_rust', 'alloy_polished',
  'asphalt', 'asphalt_wet', 'pavement_slab', 'kerb_stone',
  'timber_painted', 'timber_bare', 'fabric_awning', 'plastic_signage',
  'car_paint', 'car_glass', 'tyre_rubber', 'chrome_trim',
  'foliage', 'bark', 'grass',
  'skin', 'face_skin', 'hair', 'cloth_shirt', 'cloth_trouser', 'shoe_leather',
]);

/* Assets predating the pipeline. Warned about, not failed. Empty this as the
 * library gets rebuilt properly. */
const LEGACY = new Set(['characters']);

/* ------------------------------------------------------------------ util -- */

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

async function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.name.endsWith('.glb') && !/\.lod[12]\.glb$/.test(entry.name)) out.push(full);
  }
  return out;
}

function triCount(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  }
  return Math.round(tris);
}

function bounds(doc) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return { min: [0, 0, 0], max: [0, 0, 0] };
  const b = getBounds(scene);
  return { min: b.min.map(r3), max: b.max.map(r3) };
}

const r3 = (n) => Math.round(n * 1000) / 1000;

/* -------------------------------------------------------------- validate -- */

function validate(doc, { category, name, tags }) {
  const errors = [];
  const warnings = [];
  const legacy = LEGACY.has(category);

  // materials
  const mats = doc.getRoot().listMaterials().map((m) => m.getName()).filter(Boolean);
  for (const m of mats) {
    if (!MATERIALS.has(m)) {
      const msg = `unknown material "${m}" — add it to docs/ART_BIBLE.md or rename`;
      (legacy ? warnings : errors).push(msg);
    }
  }
  if (!mats.length) warnings.push('no named materials');

  // triangles
  const tris = triCount(doc);
  let budget = TRI_BUDGET[category] ?? 1000;
  for (const t of tags) if (TRI_BUDGET_BY_TAG[t]) budget = TRI_BUDGET_BY_TAG[t];
  if (tris > budget) {
    const msg = `${tris} tris over the ${budget} budget for ${category}`;
    (legacy ? warnings : errors).push(msg);
  }

  // textures
  for (const tex of doc.getRoot().listTextures()) {
    const size = tex.getSize();
    if (!size) continue;
    const [w, h] = size;
    if (w > MAX_TEXTURE || h > MAX_TEXTURE) {
      errors.push(`texture "${tex.getName() || '(unnamed)'}" is ${w}x${h}, max ${MAX_TEXTURE}`);
    }
    if ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0) {
      warnings.push(`texture "${tex.getName() || '(unnamed)'}" is ${w}x${h}, not power-of-two`);
    }
  }

  // UVs are load-bearing: materials are bound at runtime and every one of them
  // is textured, so a primitive without TEXCOORD_0 renders untextured
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getAttribute('TEXCOORD_0')) {
        errors.push('a primitive has no TEXCOORD_0 - it cannot take a material');
        break;
      }
    }
  }

  // transforms applied
  for (const node of doc.getRoot().listNodes()) {
    const s = node.getScale();
    if (s.some((v) => Math.abs(v - 1) > 1e-4)) {
      warnings.push(`node "${node.getName()}" has unapplied scale ${s.map(r3).join(',')}`);
    }
  }

  // origin at base
  const b = bounds(doc);
  if (Number.isFinite(b.min[1]) && Math.abs(b.min[1]) > 0.02) {
    const msg = `origin is not at the base — min.y is ${b.min[1]}, expected ~0`;
    (legacy ? warnings : errors).push(msg);
  }

  return { errors, warnings, tris, bounds: b, materials: mats };
}

/* ----------------------------------------------------------------- build -- */

async function makeLod(io, srcPath, ratio) {
  const doc = await io.read(srcPath);
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05, lockBorder: false }),
    prune({ keepAttributes: true }),
  );
  return doc;
}

async function main() {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
  const sources = await walk(SRC);

  if (!sources.length) {
    console.log(c.dim(`no sources under ${path.relative(ROOT, SRC)}/ yet — see docs/PIPELINE.md`));
  }

  const manifest = { version: 1, generated: new Date().toISOString(), assets: {} };
  let failed = 0;

  for (const srcPath of sources) {
    const rel = path.relative(SRC, srcPath);
    const category = rel.split(path.sep)[0];
    const name = path.basename(srcPath, '.glb');
    const key = `${category}/${name}`;
    if (ONLY && key !== ONLY) continue;

    // tags come from a sidecar so authoring tools do not have to carry them
    const tagFile = path.join(path.dirname(srcPath), 'tags.json');
    let tags = [];
    if (existsSync(tagFile)) {
      try { tags = JSON.parse(await (await import('node:fs/promises')).readFile(tagFile, 'utf8')); }
      catch { /* ignore a malformed sidecar; validation will still run */ }
    }

    const doc = await io.read(srcPath);
    const v = validate(doc, { category, name, tags });

    for (const w of v.warnings) console.log(`${c.yellow('warn')}  ${key}: ${w}`);
    for (const e of v.errors) console.log(`${c.red('FAIL')}  ${key}: ${e}`);
    if (v.errors.length) { failed++; continue; }

    if (CHECK_ONLY) {
      console.log(`${c.green('ok')}    ${key} ${c.dim(`${v.tris} tris`)}`);
      continue;
    }

    await doc.transform(
      weld(),
      dedup(),
      // keepAttributes: the materials are bound at runtime from the library, so
      // ingest cannot tell a UV is "unused" - it would delete every TEXCOORD_0
      prune({ keepAttributes: true }),
      meshopt({ encoder: MeshoptEncoder }),
    );

    const outDir = path.join(OUT, category);
    await mkdir(outDir, { recursive: true });
    await io.write(path.join(outDir, `${name}.glb`), doc);

    const lodTris = { lod0: v.tris };
    for (const [suffix, ratio] of [['lod1', 0.5], ['lod2', 0.2]]) {
      // an authored LOD beside the source wins: a normal-blind simplifier
      // cannot reduce chamfered geometry, but the generator can rebuild it
      const authored = path.join(path.dirname(srcPath), `${name}.${suffix}.glb`);
      const lodDoc = existsSync(authored)
        ? await io.read(authored)
        : await makeLod(io, srcPath, ratio);
      await lodDoc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder }));
      await io.write(path.join(outDir, `${name}.${suffix}.glb`), lodDoc);
      lodTris[suffix] = triCount(lodDoc);
    }

    manifest.assets[key] = {
      url: `/models/${category}/${name}.glb`,
      lods: [`/models/${category}/${name}.lod1.glb`, `/models/${category}/${name}.lod2.glb`],
      lodDistances: [0, 40, 110],
      bounds: v.bounds,
      tris: lodTris,
      materials: v.materials,
      tags,
    };

    const size = (await stat(path.join(outDir, `${name}.glb`))).size;
    console.log(`${c.green('ok')}    ${key} ${c.dim(`${v.tris}/${lodTris.lod1}/${lodTris.lod2} tris · ${(size / 1024).toFixed(0)} KB`)}`);
  }

  if (!CHECK_ONLY) {
    await mkdir(OUT, { recursive: true });
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(c.dim(`\nmanifest: ${Object.keys(manifest.assets).length} assets -> ${path.relative(ROOT, MANIFEST)}`));
  }

  if (!existsSync('/usr/local/bin/toktx') && !CHECK_ONLY && sources.length) {
    console.log(c.yellow('\nnote: KTX2 compression skipped (toktx not found).'));
    console.log(c.dim('      install KTX-Software, then: npx @gltf-transform/cli uastc <in> <out>'));
  }

  if (failed) {
    console.log(c.red(`\n${failed} asset(s) failed validation.`));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
