# CLAUDE.md — Halstead Bay

Read this before touching anything. It is the contract between me (Arun) and any
Claude session working on this repo.

## What this is

A browser open-world driving game on three.js. A hand-planned 4.2 x 3.0 km
district ("Halstead Bay") loaded from `public/halstead-bay.district.json`,
streamed in 256 m chunks. Driveable car with a real tyre/suspension model,
on-foot mode, police, traffic, pedestrians, a helicopter, checkpoint missions.

**Target: GTA-level graphics, stylised — not photoreal.** Reference bar is
"GTA IV-era geometry under modern lighting". See `docs/ART_BIBLE.md`.

**Constraint: everything must be free.** Free tools, free/CC0 assets, or
authored by me. No paid licences anywhere in the pipeline.

## Hard rules

1. **Never regress frame rate to buy fidelity.** 60fps at 1440x860 is the floor.
   If a change costs frames, it must state what it costs and what pays for it.
2. **No new `onBeforeCompile`.** We are migrating to WebGPU + TSL. Custom shader
   work written against the WebGL material system is migration debt. If a shader
   is unavoidable, write it so the TSL port is mechanical, and say so in a comment.

   **Standing debt against this rule** (all pre-date the contract):
   `world/city.js:25` `onBeforeCompile` for `aUvScale`; `core/grade.js` six
   `ShaderMaterial`s — vignette, grain, lens, and the three added for bloom
   (bright-pass, separable blur, blit); `world/skidmarks.js:32` one. The bloom
   chain is deliberately the most mechanical port on the list: threshold, two
   nine-tap gaussians, additive composite.

   Note that `world/districtWorld.js` no longer needs `aUvScale` for its
   authored dressing — the asset kit carries its own UVs — so the only
   `onBeforeCompile` left is the legacy grid's.
3. **Procedural for layout, authored for detail.** The city assembly logic stays
   procedural. Anything the player sees inside ~30 m should come from the asset
   catalogue, not from a `BoxGeometry` in code.
4. **Every mesh gets UVs.** `core/geometry.js:fromTris`/`mergeGeos` currently
   write an all-zero UV attribute. Anything new must carry real UVs or it can
   never take a normal map, a decal or a texture.
5. **Dispose what you allocate.** See "Known bugs" — we already leak.
6. **Budgets are in `docs/BUDGETS.md` and are enforced by `tools/ingest.mjs`.**
   Do not raise a budget to make an asset fit.

## Architecture map

```
src/
  main.js              wiring + frame loop. Fixed 1/120 physics step, clamped dt.
  core/
    renderer.js        renderer, tone mapping, day/night light rigs
    sky.js             sky dome + PMREM env map
    geometry.js        M4, mergeGeos, loft() (the car hull)
    grade.js           in-canvas colour grade (NOT a CSS overlay - captures need it)
    rng.js             seeded PRNG
  world/
    district.js        parses the district JSON into a road graph
    districtWorld.js   the 256m chunk streamer. THE hot file.
    catalogue.js       loads manifest.json + textures/library.json; binds
                       materials by name; merges placements by material
    dressing.js        WHERE the 91 assets go. Tables, not conditionals.
    city.js            legacy 130m procedural grid streamer. Being retired.
    metrics.js         roadDepth() - "am I on tarmac", two modulos and a min
    facades.js         building facade texture + material generation
    props.js           lamps, signals, trees, shelters, bins, bollards
    textures.js        procedural texture generation. toTex() is the correct path.
    water.js beach.js surrounds.js weather.js places.js signals.js skidmarks.js
  vehicle/
    config.js          hull cross-sections, gears, tyre, spring rates
    model.js           the lofted car, wheels, materials
    dynamics.js        engine, driveline, tyres, weight transfer. 4-ray suspension.
    collision.js       8-probe hull collision
  game/
    traffic.js         path-following cars + police. Largest game file.
    crowd.js figure.js instanced part-based pedestrians (6 parts, 6 draw calls)
    character.js       the one skinned GLB character + AnimationMixer
    onfoot.js camera.js input.js mission.js weapon.js helicopter.js
    audio.js engine-samples.js autopilot.js cinematic.js recorder.js multiplayer.js
  ui/hud.js            tachometer, minimap, readouts
tools/ingest.mjs       asset pipeline: glTF -> optimised, KTX2, LODs, manifest
assets/source/         authoring source (.blend, node graphs). Not shipped.
public/models/         ingested, shipped assets + manifest.json
docs/                  ART_BIBLE, PIPELINE, BUDGETS, ROADMAP
```

## Conventions

- **Units are metres.** Y is up. Vehicles and characters face **+X**.
- **Asset origin sits at the base**, centred in XZ, unless it hangs from something.
- Material names come from the library list in `docs/ART_BIBLE.md`. Do not invent one.
- Textures: colour maps are `SRGBColorSpace`, data maps (normal/roughness/AO)
  are `NoColorSpace`. Route every texture through `world/textures.js:toTex()` so
  it inherits anisotropy. Four files currently bypass it — that is a bug, not a pattern.
- Seeded randomness only, via `core/rng.js`. Same seed, same city, every reload.

## Current state

- Tests: `npm test` — 20/20 passing. Node's built-in runner, no framework.
- `npm run dev` (vite, :5173), `npm run build`, `npm run preview`.
- three r185, WebGL renderer. WebGPU migration is Tier 0 of `docs/ROADMAP.md`.
- ~900-1000 draw calls and ~4.1M triangles facing downtown with the full
  authored kit placed (budgets: 1400 draws, 4.0M triangles). Triangles came
  DOWN from 5.7M while the city gained ~14,000 props, because the profile
  showed 748 parked cars at 2444 triangles each were 54% of the scene: they
  now have a 492-triangle LOD and shadow casting is gated to the chunk you
  stand in. The older "720 draws / 1.8M tris" figure is long dead.
- Frame rate cannot be measured from an automated browser: an EMPTY
  requestAnimationFrame loop there runs at 22.8 ms (44 fps). Any fps number
  taken under Playwright is an artefact of the harness. Report draws and
  triangles, which are deterministic, and measure fps by hand.

## Known bugs — do not "discover" these again, just fix them when in the area

### Open

- `core/geometry.js:mergeGeos` writes an all-zero UV attribute, so the car hull
  and every merged prop can never take a normal map, decal or livery. Blocks
  Tier 2 outright.
- Multiplayer walks the checkpoint course from each player's own position, so a
  shared seed still yields two different courses; `{k:'stop'}` is never sent, so
  a race has no finish condition.
- `character.js` loads `hit` and `punch` clips that are never played. Five of the
  six shipped GLB characters are never loaded (Tier 3.5 covers the pool).
- LODs in the manifest are worthless: across all 91 assets lod2 saves 2.5% of
  lod0's triangles, and 62 of them are byte-identical. The props are already
  84-300 triangles, so there is nothing for a decimator to remove. Distance
  culling is the only lever that works on them; do not reach for the LOD chain
  expecting it to pay.
- KTX2 is still not generated — `tools/ingest.mjs` skips it without the `toktx`
  binary, so the 97 texture PNGs ship uncompressed (~18 MB).

### Fixed 2026-08-31 (verified, kept here so they are not re-reported)

- **The 91 assets are live.** `world/catalogue.js` + `world/dressing.js` place
  all 91 (audited: `dressing.js` + `districtWorld.js` reference 91/91).
  Materials bind by name — 32 library materials for 91 assets.
- **Vertex quantization.** `ingest.mjs` runs KHR_mesh_quantization, so
  positions arrive as normalized int16. `applyMatrix4` wrote floats back into
  an Int16Array and truncated every coordinate to -1/0/1 — 837 props per chunk
  collapsed into one 2m cube at the origin. `catalogue.js:deQuantize` fixes it.
  Anything else that loads these glTFs must do the same.
- **Catalogue geometry is shared between chunks** and is deliberately NOT
  marked `geometry.userData.owned`, or the release sweep would free a bench
  out from under every other live chunk.
- **`loft()` emits real UVs** — cylindrical, U along the hull in metres, V by
  cumulative section perimeter. The all-zero attribute is gone and the car now
  carries the library's `car_paint` normal/ORM maps. `mergeGeos` still zero-
  fills for inputs that have no UVs of their own.
- **PCFSoftShadowMap really is deprecated in r185.** The browser warns on every
  load and silently falls back. An earlier comment in `renderer.js` claiming
  the deprecation was invented was itself wrong; it now sets `PCFShadowMap`.
- **Pavements.** `A.mat.walk` carries `repeat` for the legacy 130m grid, but
  districtWorld writes its own tile-count UVs — the two multiplied and crushed
  the slab pattern to ~1/50th of a texel, which aliased into black corrugation
  at grazing angles. districtWorld uses `A.mat.walkDistrict`, tiled once.
- **All six parked silhouettes** are used, not just `sedan`.
- **All six characters** load; `?me=N` and K cycle them.
- **Multiplayer is a real race**: the course anchor comes out of the seeded
  stream (same seed = same course, verified from two points 1.4km apart), and
  finishing sends `{k:'stop'}`.
- **Damage is visible**: hull vertices crumple at the real contact point
  (plumbed out of `collision.js`, which already computed it), tyres deflate,
  glass goes milky, a proper particle fire burns, then the blast — and death
  fades through black to downtown Kingsway.

### Fixed 2026-08-30 (verified, kept here so they are not re-reported)

- `resetCar()` off-map teleport — `main.js:respawnCar()` now places the car on
  the nearest graph node. Verified: R from (2600,1500) lands 13 m inside a
  carriageway.
- Wanted decay at 3+ stars — `helicopter.js` has a real sampled line-of-sight
  test and `sight` decays over 4 s. Verified: wanted fell 4 → 3.23 while fleeing.
- On-foot police target — `main.js` passes a `quarry` proxy to `traffic.update()`
  and `onShot()` routes to a player health bar. Verified: one shot at 4 m took
  health to 87.6%.
- `districtWorld` disposal — scoped to `geometry.userData.owned`, so shared
  `assets.geo.*` is no longer freed under live chunks.
- `receiveShadow` — set on the car, its driver, traffic and the rigged character.
- Frustum culling restored via `computeBoundingSphere()`; the blanket
  `castShadow` on 1.2 km of facades is gone.
- `renderer.js` PCFSoft comment — the claim was false and is removed; the
  renderer is on `PCFSoftShadowMap` now.
- `world/city.js` disposal — `releaseCell()` frees InstancedMesh buffers and the
  cloned per-instance geometry. Both streamers also call `InstancedMesh.dispose()`.
- Film mode route — `autopilot.js` walks the real road graph when a district is
  loaded, and `main.js` rebuilds `ROUTE` after the car reaches its spawn.
  Verified: 9 legs, every waypoint on tarmac, 242 m span.
- Crowd float — `figure.js` exports `FOOT_DROP`; soles land within 3.5 cm of the
  pavement, down from 11.5 cm. NOTE: the constant is NEGATIVE. My first attempt
  had the sign backwards and doubled the float.
- Prone pose — the six parts keep their own offsets; a downed pedestrian spans
  1.46 m instead of heaping at one point.
- `Crowd.bodies()` and the `tag === 'person'` guard in `onfoot.js` — removed as
  dead code.

## What "good" looks like in a session

- Read the file before changing it. This codebase has dense, deliberate comments
  explaining non-obvious decisions — the lateral-sign convention in `dynamics.js`,
  the `frustumCulled = false` rationale in `city.js`. Respect them or argue with
  them explicitly; do not silently overwrite.
- Cite `file:line` for claims about behaviour.
- Run `npm test` after touching `dynamics.js`, `signals.js`, `district.js` or `input.js`.
- Screenshot-verify visual changes. Do not claim a visual result you have not seen.
