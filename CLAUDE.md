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
2. **No `onBeforeCompile`, no `ShaderMaterial`.** The migration is DONE — the
   project runs on `WebGPURenderer` and TSL, and neither construct appears
   anywhere in `src/`. Keep it that way: shader work goes in TSL nodes.

   Three traps the migration paid for, worth knowing before writing a node:
   - Setting `.colorNode` on a **classic** material (`MeshStandardMaterial`)
     is silently ignored. Build a `*NodeMaterial`, or `copy()` into one.
   - `materialColor` is NOT `material.color`. three defines it as
     `color * map(default uv)`, and `materialEmissive` as
     `emissive * emissiveIntensity * emissiveMap(default uv)`. Multiplying
     your own texture sample by either one samples the texture **twice** and
     squares it.
   - Reading a material property as a plain number **bakes** it. Anything the
     game changes at runtime (`emissiveIntensity` is dimmed to 0.04 for
     daylight) needs `materialReference(name, type)`.
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
- three r185, **WebGPURenderer** (WebGL2 backend where WebGPU is absent).
  `vite.config.js` aliases `three` -> `three/webgpu` with an exact-match
  regex; a plain string alias would also rewrite `three/tsl`. `main.js` has a
  top-level `await renderer.init()` — nothing may touch the backend before
  the device resolves.
- Tier 1.1 post stack is LIVE (2026-08-31): one `RenderPipeline` owns the frame
  — scene MRT pass (colour/normal/emissive) → GTAO (denoised) → bloom fed by
  the emissive channel → tone map → SMAA → sRGB → the grade folded in as
  display-space node maths. `core/grade.js` is that stack; the old second-pass
  quad grade is gone and `setBloom()` is real again. Read grade.js's header
  before touching it — it records the double-tonemap trap, the
  depth-reconstruction dead end and the rain-vs-normal-target corruption.
  Escape hatches: `?noao ?nobloom ?noaa ?nopost`. Night runs at
  `toneMappingExposure` 1.15 (day 1.0), and headlights default to night-only.
- The state of play, reviewed in full with ranked issues and next steps:
  `docs/REVIEW-2026-08-31.md`.
- ~1100 draw calls and ~3.6M triangles facing downtown with the full
  authored kit placed (budgets: 1400 draws, 4.0M triangles). Triangles came
  DOWN from 5.7M while the city gained ~14,000 props, because the profile
  showed 748 parked cars at 2444 triangles each were 54% of the scene: they
  now have a 492-triangle LOD and shadow casting is gated to the chunk you
  stand in. The older "720 draws / 1.8M tris" figure is long dead.
- Frame rate cannot be measured from an automated browser: an EMPTY
  requestAnimationFrame loop there runs at 22.8 ms (44 fps). Any fps number
  taken under Playwright is an artefact of the harness. Report draws and
  triangles, which are deterministic, and measure fps by hand.

- Avatar customiser (2026-08-31): `tools/avatar/` + `public/models/avatar/`
  (male/female RPM-schema wardrobe GLBs, 67-joint Mixamo-named rig, 63
  blendshapes, 11 generated wardrobe parts hidden at load). Wired as player
  characters 6 and 7 — `?me=6`/`?me=7`, K cycles. They ship no clips;
  `character.js` retargets the Quaternius man's clips onto them at load
  (SkeletonUtils.retargetClip; mixer must sit ON the SkinnedMesh — the
  retargeted tracks are `.bones[…]` paths). Read AVATAR-PIPELINE.md before
  touching; hair shells are known-failed. ⚠ The two vendor source GLBs in
  `assets/source/avatar/vendor/` are unlicensed RPM exports — dev fixtures
  only, see NOTICE.md; do not ship them (the generated wardrobe GLBs derive
  from them, so a licensed base mesh must replace them before any release).

## Known bugs — do not "discover" these again, just fix them when in the area

### Open

- Doors are hinged but single-skinned: from inside the cabin an open door's
  inner face is back-culled (`paint` is FrontSide). An inner skin, or
  DoubleSide on a door-only paint clone, is the fix when it matters.


- `core/geometry.js:mergeGeos` still zero-fills UVs for input geometries that
  carry none of their own (loft() and fromTris() now emit real UVs — see the
  2026-08-31 fixed list). Anything built purely from mergeGeos over UV-less
  inputs still can't take a normal map or decal.
- Debris scope: only the PLAYER's car breaks street furniture
  (`world/breakables.js`); traffic and police shove through it un-physically,
  as they always did. Broken props also respawn pristine when their chunk
  streams back in — GTA does the same, but it is worth knowing.
- `district.roadDepth()` measures the nearest CENTRELINE only, so a point on a
  wide arterial whose centreline is further away than a narrow lane's reports
  as off-road. Physics, camera and traffic all consume it; placement now uses
  `district.tarmacDepth()` (min over all nearby segments) instead. Whether the
  physics callers want the same fix is an open question — measure before
  changing grip behaviour.
- `character.js` loads `hit` and `punch` clips that are never played.
- The kit's LOD chain is REAL now (re-ingested 2026-09-01): tree_broadleaf
  964/280/272, fire_escape 1716/468/468. lod0 across the placed assets is
  ~31k triangles, lod1 ~10k, so `districtWorld` dresses at **lod1
  everywhere** (`emit(..., { lod: 1 })`). Switching to lod0 costs ~3.7M
  triangles at the spawn — measured 7.15M vs 3.43M. Do not.
- Re-running `npm run ingest` can rename assets (2026-09-01: the two
  blockouts became `tree_broadleaf` / `shrub_mass`). `InstanceBatch.emit`
  now skips a missing name with one warning instead of aborting the chunk,
  but the dressing tables still have to be updated by hand — diff the
  manifest keys against HEAD after any ingest.
- The ingest takes >5 minutes for 92 assets and writes 277 files; run it in
  the background and never interrupt it — a killed run leaves half-written
  GLBs (restore with `git checkout -- public/models`).
- KTX2 is still not generated — `tools/ingest.mjs` skips it without the `toktx`
  binary, so the 97 texture PNGs ship uncompressed (~18 MB).

### Fixed 2026-09-01 (verified, kept here so they are not re-reported)

- **The kit had no UVs.** All 201 shipped parts carried only POSITION and
  NORMAL — the ingest's `prune()` fix had never been re-run — so every one of
  the 27 PBR materials rendered from one texel. Re-ingested: TEXCOORD_0 (and
  COLOR_0) ship on every part and LOD. `catalogue.js:boxProjectUv` remains as
  a metre-scaled fallback for any part that ever arrives without UVs again.
- **Kerb corners are radiused** (3.5 m returns): block slabs are rounded-
  rectangle extrusions merged per kind per chunk, same draw count.

- **The city was 15% built.** The district file ships ~5 footprints per
  block. `district.js:#infill` adds seeded frontage footprints on row/mid/
  tower blocks (1,207 added; mean coverage on built blocks 0.15 -> 0.43),
  inside the block, clear of authored ones — `test/district.test.js` now
  asserts exactly that instead of an exact count. Far stand-ins wear the
  tiled facade material with a per-instance `aUvScale`, and the far roads
  use `A.mat.tarmac`, so streaming out no longer produces a detail cliff.
- **Bridges have sides.** Per-segment concrete skirt + parapet from the
  tarmac's own corner heights (`face()` corrects winding once); pavements,
  kerbs and lamps rise with the deck (`spanHeight` band half+5.5);
  `water.js` no longer draws its own fixed-height rails.
- **Night street lighting.** Lamp pools hot enough to read post-stack, a
  pavement-side pool, emissive `lampGlow` (it was a Basic material, so the
  daylight dim never applied and heads never bloomed), and an emissive cap
  at every authored lamp's arm tip. Facade windows ~55% lit, warm/cool.

- **WebGPU "Binding size for [Buffer ...] is zero" storm** (~100 errors/s in
  the harness). `#signals` built two zero-count InstancedMeshes per chunk
  (`posts`, `arms`) once the authored mast replaced them. A zero-count
  InstancedMesh owns a zero-byte instanceMatrix buffer WebGPU refuses to
  bind. Guarded; verified 333 instanced meshes, 0 with count 0, after a
  teleport that rebuilt a full ring of chunks.
- **Junction paint**: stop lines and lane arrows on every signalised approach
  (`#signals`, `tri()` corrects winding once for all shapes — 11,485 of
  12,191 triangles faced down before). Traffic keeps RIGHT.
- **Asphalt reads as asphalt**: `textures.js:normalFromCanvas` derives a
  normal map from the tarmac's own luminance; daylight tarmac is matte
  (roughness 0.82, env 0.25).
- **The car**: hinged doors cut from the loft (`hullClassify` door buckets,
  hinge pivots in `buildCar`), mirror + front handle ride the door, steering
  wheel turns at 2.6x, reverse lamps in R. Converter-flare launch and
  brakeMax 10500 (0-100 7.89s, ~1g braking) — see commit c67b144 for the
  before/after table.

### Fixed 2026-08-31 evening (verified, kept here so they are not re-reported)

- **Street furniture breaks now** (`world/breakables.js` + break-tracking in
  `catalogue.js:InstanceBatch`). The merged batches record each breakable
  placement's vertex ranges; a hit zeroes them in place (no extra draws) and
  spawns a tumbling debris body reusing the shared geometry. Light props
  (bins, cones, meters, hydrants…) sweep aside at any speed; heavy ones
  (lamps, poles, phone boxes) hold below ~30 km/h and tear off above it,
  removing their collision solid pre-physics so the car smashes through
  instead of eating a dead stop. Hydrants raise a 20s water jet, lamps spark;
  breaks report through car.hitTag so damage and wanted work unchanged.
  Verified: lamp felled at 45-48 km/h with sparks + topple in-shot, hydrant
  fountain in-shot, 20/20 tests. Cost: ≤26 transient debris meshes + ≤6
  one-draw particle systems; static props stay zero-cost. `Debris.breakNear()`
  is the hook for bullets/explosions later.
- **The night rain AO speckles are gone.** Additive sprites were smearing
  garbage into the MRT normal target (blending applies to every target);
  GTAO read it as occlusion. Every additive particle material now carries
  `mrtNode = mrt({ normal: vec4(0) })` — the additive identity — so the
  pixels behind keep their real normals (weather rain + spray, debris sparks
  + water). Verified on a night run: clean sky, rain reads as pale streaks.

- **Props, trees and parked cars no longer stand in the road.** Road polylines
  flatten into segments that run straight through junctions, and placement only
  measured distance from its OWN street's kerb — so 9,447 of 27,825 kerbside
  props (34%, worst: a lamp 14.9m inside an arterial) and 1,995 of 6,305
  parked bays (32%) sat on some other road's tarmac. `district.tarmacDepth()`
  (min depth over ALL nearby segments, optional own-segment exclusion) now
  gates every kerbside row, the billboard, roadworks, parked bays and the
  legacy lamp path. Verified by replaying the placement maths over the whole
  district file: zero offenders after the guard.
- **The HUD banner's draw-call figure was a lie.** `renderer.info.render.calls`
  counts render-pass invocations SINCE LOAD and is never reset — the famous
  "907 DRAWS" just happened to look plausible. The banner now reports
  `drawCalls` (per-frame, resets each rAF) and matches the F3 overlay.
  Post-stack cost, measured same-viewpoint: GTAO +1 draw call, bloom +12,
  ~5 MB of render targets.

### Fixed 2026-08-31 (verified, kept here so they are not re-reported)

- **The 91 assets are live.** `world/catalogue.js` + `world/dressing.js` place
  all 91 (audited: `dressing.js` + `districtWorld.js` reference the full kit; 92 assets after the 2026-09-01 ingest).
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
