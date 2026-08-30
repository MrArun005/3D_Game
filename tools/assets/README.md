# tools/assets

One file per asset. **There is no registry** — adding a file adds an asset,
deleting a file removes it. `tools/genkit.mjs` discovers everything here.

```
tools/assets/<category>/<name>.mjs
```

`category` decides the triangle budget (`facade` 400, `props` 300/900/2500 by
tag — see `docs/BUDGETS.md`) and where the output lands.

Each file looks like this:

```js
import { Mesh } from '../../lib/mesh.mjs';

/** One line saying what this is and when to use it. */

export const tags = ['street', 'kerb', 'clutter'];

export default () => new Mesh()
  .cylinder('metal_painted', { r: [0.24, 0.28], h: 0.86, seg: 10 })
  .box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [0, 0.25, 0.3] });
```

- **default export** — a function returning a `Mesh`. `genkit` calls `.seat()`
  on it, so build from y=0 upward and do not worry about the exact origin.
- **`tags`** — the placement vocabulary. Rules ask for "something tagged `kerb`",
  never for an asset by name. An untagged asset is generated but never placed.
- **materials** — names must come from the library in `docs/ART_BIBLE.md`.
  `tools/ingest.mjs` fails on anything else, deliberately.

Facade modules import shared parts (`BAY`, storey heights, `opening`,
`punched`) from `../../lib/facade-parts.mjs`. Those constants are a contract
with the assembly code — changing them changes every building.

## Adding an asset

1. Write the file.
2. `npm run genkit -- <name>` to build just that one, or `npm run genkit` for all.
3. `npm run ingest` to validate, optimise, LOD and add it to the manifest.

## Refining an asset by hand

These are blockouts. When you open one in Blender and model on top of it,
**delete its generator file** — otherwise the next `npm run genkit` overwrites
your work. The `.glb` in `assets/source/` then becomes the authored source and
lives in git like any other art file.

## Building geometry

`tools/lib/mesh.mjs` gives you `box`, `cylinder`, `wedge`, `slab`, `quad` and
`repeatX`. UVs are planar-projected from world dimensions, so texel density is
correct automatically — a bin and a wall sampling the same concrete show the
same grain size. Use `skip: ['py','ny']` on a box to drop faces nobody sees.

## Chamfers, AO and LODs

Three things happen automatically and you mostly should not fight them:

- **Every box is chamfered** (12 mm by default). A razor-sharp 90-degree edge
  cannot catch a highlight and nothing built has one. Pass `bevel: 0.05` for a
  softer piece, `bevel: 0` for the rare thing that genuinely wants a hard edge.
  A large bevel rounds a box into a blob — that is how the tree canopy clusters
  are made.
- **Ambient occlusion is baked to vertex colour** by `genkit`. glTF multiplies
  COLOR_0 into base colour, so it needs no material setup and survives into the
  game. It is what stops parts reading as separate objects floating next to
  each other before Tier 2 lands real AO maps.
- **LODs are authored, not decimated.** Chamfered geometry has split normals at
  every edge, so a normal-blind simplifier sees every edge as a border and
  reduces nothing. `genkit` instead rebuilds each asset at `setDetail(1)` and
  `setDetail(2)` — chamfers off, cylinders coarser — and `ingest` uses those in
  preference to simplifying. Across the kit that is 31k triangles at LOD0 and
  9.5k at LOD2.

## Mouldings

`profile()` extrudes a 2D section along X. A cornice, kerb, sill, coping or
handrail *is* a moulded section run to a length — a stack of boxes cannot make
one, which is why the first pass of toppers read as plain bars. Use it for
anything with a run and a section.
