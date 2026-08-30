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
- ~620-670 draw calls facing the city (450 facing away — culling is on for the
  static per-chunk instances), ~5.7M triangles. The older
  "720 draws / 1.8M tris" figure predates bridges, zebra crossings, the crowd,
  pedestrians, places and the far-city LOD.
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
- **91 ingested assets are inert.** `assets/source/` holds 22 facade modules and
  69 props, all ingested to `public/models/` with LOD0/1/2 and a manifest.
  `grep -rn manifest src/` returns nothing — the city is still built from
  `BoxGeometry` in code. This is Tier 3.1/3.2 and it is the largest single
  pile of already-paid-for work sitting unused.
- Triangles are over budget: ~5.7 M against the 4.0 M in `docs/BUDGETS.md`.
  Visible on the F3 overlay.

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
