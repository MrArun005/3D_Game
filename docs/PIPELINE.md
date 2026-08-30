# Asset pipeline

From "I want a bus shelter" to "it is in the game". Every asset goes through this.
No exceptions, no hand-placed one-offs.

## Directory contract

```
assets/source/<category>/<name>/     authoring files. .blend, Material Maker
                                    graphs, reference. NOT shipped, NOT in dist.
public/models/<category>/<name>.glb  ingested output. Shipped.
public/models/manifest.json          the catalogue the world builder reads.
```

Categories: `facade` `props` `vehicles` `characters`.

## Blender conventions

Non-negotiable, because `tools/ingest.mjs` assumes them and the world builder
places things by them.

| Rule | Value |
| --- | --- |
| Unit scale | Metres. Scene unit = 1 m. |
| Up axis | Blender Z-up; glTF export converts to Y-up. Use the default. |
| Forward | +X. Vehicles and characters face +X. |
| Origin | Base of the object, centred in XZ. A wall-mounted asset's origin sits on the mounting plane. |
| Transforms | Applied. Scale must be 1,1,1 and rotation 0 before export. |
| Naming | `<category>_<name>` on the object, e.g. `props_bus_shelter`. Lowercase, underscores. |
| Materials | Named exactly as the library list in `ART_BIBLE.md`. The ingest step fails on an unknown material name. |
| Modifiers | Applied, except Decimate on LOD collections. |

**Collections** drive the LOD chain and the collider:

```
LOD0      the game mesh (required)
LOD1      ~50% triangles (optional; generated if absent)
LOD2      ~20% triangles (optional; generated if absent)
COL       convex collision proxy (optional)
```

## The authoring loop

1. **Reference and blockout.** Grey box it in Blender against the 1.78 m figure.
   Check it against `ART_BIBLE.md` silhouette rules before spending time.
2. **High-poly.** Sculpt or model the detail. This exists only to be baked.
3. **Low-poly.** Retopologise to the budget in `BUDGETS.md`.
4. **UV unwrap.** Hit the texel density for the asset's viewing distance.
   Blender's UV checker at 512 px/m is the reference.
5. **Bake** high-poly to low-poly in Blender: normal + AO. This is the step that
   makes a simple mesh read as detailed. Never skip it.
6. **Material** from the library. If it needs a new material, author it in
   Material Maker, add it to the library list, and register it once — never
   author a texture that serves one asset.
7. **Export glTF** (`.glb`, +Y up, apply modifiers, export collections as above).
   Into `assets/source/<category>/<name>/<name>.glb`.
8. **Ingest**: `npm run ingest`. This validates, optimises, compresses, generates
   missing LODs, and rewrites `public/models/manifest.json`.
9. **Place**: the world builder reads the manifest and instances it. No code
   change should be needed to add an asset of an existing kind.

## What `tools/ingest.mjs` does

For every `.glb` under `assets/source/`:

- **Validates** against `docs/BUDGETS.md` — triangle count, texture dimensions,
  material names, transform applied, origin at base. Fails loudly with the reason.
- **Weld + dedupe + prune** — merges identical vertices, drops orphan data.
- **Meshopt compression** on geometry.
- **KTX2 / Basis** texture compression, with colour space preserved per slot.
- **Generates LOD1/LOD2** by simplification if the source did not provide them.
- **Emits** to `public/models/<category>/<name>.glb`.
- **Rewrites** `public/models/manifest.json` with dimensions, LOD distances,
  material list and triangle counts, so the world builder never has to load an
  asset to know how big it is.

Run it with `npm run ingest`. Run `npm run ingest -- --check` in CI or before a
commit to validate without writing.

## Manifest format

```json
{
  "version": 1,
  "assets": {
    "props/bus_shelter": {
      "url": "/models/props/bus_shelter.glb",
      "bounds": { "min": [-1.6, 0, -0.7], "max": [1.6, 2.4, 0.7] },
      "tris": { "lod0": 780, "lod1": 390, "lod2": 150 },
      "lodDistances": [0, 40, 110],
      "materials": ["metal_painted", "glass_shop"],
      "collider": "convex",
      "tags": ["street", "transit"]
    }
  }
}
```

`tags` is what the procedural placement rules query. A rule says "put something
tagged `street` every 30 m on an arterial pavement" — it does not name assets.
That is how the city gets more varied without any code change.

## Why the manifest matters

The world builder must never `await` a GLB to find out how big it is. Chunk
building is synchronous inside `districtWorld.update()`; a network round-trip
there is a guaranteed hitch. Bounds and triangle counts live in the manifest so
placement can be decided before anything loads.

## The greybox kit

`tools/assets/` holds 91 procedurally-generated blockouts — facade modules,
street furniture, roadworks, harbour, park, signage. One file per asset, no
registry: adding a file adds an asset. See `tools/assets/README.md`.

```bash
npm run genkit              # build every blockout into assets/source/
npm run genkit -- --list    # catalogue only, writes nothing
npm run genkit -- bin       # rebuild one
npm run ingest              # validate, optimise, LOD, manifest
```

These are the starting point for authoring, not the finished article. When you
refine one in Blender, **delete its generator file** or the next `genkit` run
overwrites your work. `docs/kit-contact-sheet.png` shows all 91.
