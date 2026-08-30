# Graphics roadmap

Sequenced for one full-time developer. Each ticket has a **done** line — that is
the acceptance test, and it is what a Claude session should be held to.

Order matters. Tier 0 before Tier 1 because shader work written against the WebGL
material system is thrown away at the WebGPU port. Tier 1 before Tier 3 because
you want the lighting settled before authoring art that has to look right under it.

---

## Tier 0 — Foundations (~3 weeks)

Nothing here looks better. Everything here makes the next six months cheaper.

### 0.1 Pipeline scaffolding — DONE
`CLAUDE.md`, `docs/`, `tools/ingest.mjs`, `assets/source/`.
**Done:** `npm run ingest` runs clean over the existing character GLBs and emits
a valid `public/models/manifest.json`.

### 0.2 Instrumentation HUD
A dev overlay (toggle on `F3`) showing frame time, draw calls, triangles, texture
memory, live chunks, resident assets — each against its budget from `docs/BUDGETS.md`,
red when over.
**Files:** new `src/ui/stats.js`, hook in `main.js` near the existing `renderer.info`
read at ~`main.js:538`.
**Done:** every number in `docs/BUDGETS.md` is visible in-game, and the read
happens before `grade.render()` overwrites `renderer.info`.

### 0.3 WebGPU migration
Port to `WebGPURenderer` (production-ready since r171, ships on all major browsers
with automatic WebGL fallback). The real work is TSL, not the renderer swap.
**The hard part:** `world/city.js:24-38` — the `aUvScale` `onBeforeCompile`
injection that scales `vMapUv`/`vEmissiveMapUv` per instance. Rewrite as a TSL
node material. This is the single highest-value piece of shader code in the repo;
port it carefully and keep the mip-derivative behaviour.
**Done:** the game runs on WebGPU at parity frame rate, `grep onBeforeCompile src/`
returns nothing, tests pass.

### 0.4 Fix the leaks and the streaming disposal
- `world/city.js:102-115` — disposes nothing. Add geometry, material and
  `InstancedMesh.dispose()` for every streamed-out cell, including the cloned box
  geometries from `city.js:42-49`.
- `world/districtWorld.js:217` — scope the traverse to cloned geometry only. It
  currently disposes shared `assets.geo.*` still in use by 24 live chunks.
**Done:** drive a 10-minute loop of the map; texture memory in the stats HUD is
flat, not climbing.

### 0.5 Restore culling, fix the shadow submission
- Call `computeBoundingSphere()` on each `InstancedMesh` at build and drop
  `frustumCulled = false` (~15 sites). The rationale comment in `city.js:11-17`
  is out of date — `InstancedMesh` bounds account for instance matrices now.
- Remove the blanket `castShadow = true` at `districtWorld.js:737`.
- Set `receiveShadow` on the car, driver and traffic — nothing outside
  `src/world/` sets it today.
**Done:** draw calls drop measurably when facing away from the city; the car
visibly darkens under a tower.

### 0.6 Known-bug sweep
Everything in the "Known bugs" list in `CLAUDE.md`. Most are under 20 lines.
Do them now while the code is fresh, not later as "polish".
**Done:** list is empty.

---

## Tier 1 — Lighting and post (~6 weeks)

This is where 60% of the perceived gap closes. No new art required.

### 1.1 Post-processing stack
Build it as TSL post nodes on the WebGPU path. Order:
1. **GTAO** — biggest single win. Buildings are boxes on a plane with no contact
   darkening; that is why the scene reads as a diorama.
2. **TAA** (or SMAA as a fallback) — lamp posts, mullions and railings are
   crawling in every daylight shot. Thin-geometry aliasing is a louder tell than
   resolution.
3. **Bloom** — the night look is 100% baked emissive with nothing to bleed it.
4. **SSR** — wet tarmac reflecting the city. The money shot, and it also fixes
   the harbour.
5. **Motion blur** — per-object, velocity is already available from the physics.
`core/grade.js` folds into this stack; keep it rendering *into* the canvas so
captures stay graded.
**Done:** side-by-side night and overcast-day stills against today's, at 60fps.

### 1.2 Cascaded shadow maps
One 2048² map at ±120/±160 covers the whole daylight city at ~8.5 texels/m.
Move to 4 cascades. Leave `renderer.js:16` on `PCFShadowMap` — PCFSoftShadowMap
really is deprecated in r185 and three silently falls back to PCF anyway. Softer
edges have to come from the cascade split and a higher-resolution near cascade,
not from the filter constant.
**Done:** a kerb 5 m away and a tower 200 m away both cast a readable shadow.

### 1.3 Chunk build budget
Chunk building is synchronous inside `districtWorld.update()` and can build five
256 m chunks in one frame. Move to a time-sliced queue with a 4 ms budget.
**Done:** stats HUD shows no frame over 20 ms while driving at speed across
chunk boundaries.

### 1.4 Clustered local lights
24–48 real point/spot lights in a radius around the camera; baked emissive keeps
carrying everything beyond. Three.js has no native clustered forward path — this
is the biggest single engineering task on the roadmap. WebGPU compute makes the
cluster assignment tractable, which is why it comes after 0.3.
**Done:** a lamp lights the pavement, a shop window lights the street outside it,
and the frame budget holds.

### 1.5 Irradiance probes
Bake a sparse probe grid over the district once, sample per object.
**Done:** the car looks like it is *in* the street rather than composited over it,
especially in shadow.

---

## Tier 2 — Materials (~5 weeks)

### 2.1 ORM maps for every procedural material
`world/textures.js` already generates albedo in canvas. Generate the matching
normal, roughness and AO in the same pass, packed ORM. Route the four textures
that bypass `toTex()` (`water.js:198`, `surrounds.js:171`, `beach.js:294`/`:322`,
`weather.js:14`/`:29`) back through it so they stop rendering at anisotropy 1.
Fix the mid-metalness dielectrics per `ART_BIBLE.md` — metalness is binary.
**Done:** no material in the scene has a uniform roughness scalar.

### 2.2 Interior mapping
Parallax shader faking a room behind every window. The building stays one box and
one draw call; every window gains depth. For a city of boxes with painted-on
windows this is the highest payoff-to-effort item in the entire roadmap.
**Files:** `world/facades.js` material, as a TSL node.
**Done:** drive past a tower at night — windows have depth and parallax correctly
against camera motion.

### 2.3 Decal system
Road patches, cracks, stains, tyre marks, rust streaks, graffiti. Deferred decals
projected in screen space, or a decal atlas on a second UV set.
**Done:** no two blocks of the city look identically clean.

### 2.4 Wet/dry road material state
Road roughness never changes in rain today (`assets.js:55-61`). Drive it from the
weather state.
**Done:** rain visibly changes what the road does with light.

---

## Tier 3 — Assets (ongoing, forever)

Only start once Tier 1 is done. Art authored under the wrong lighting gets redone.

### 3.1 Wire the greybox kit into districtWorld
91 blockouts already exist in `tools/assets/` and assemble correctly — see
`tools/preview/` and `docs/scene-block.png`. The work is porting `scenes.mjs`
assembly into `districtWorld`, as instanced draws rather than one mesh per part.
**Done:** a streamed chunk builds its frontages from facade modules instead of
scaled boxes, inside the 40 draw calls per chunk budget.

### 3.1b Refine the kit in Blender
Full authoring loop per this file — including the high-to-low bake — starting
with what the player gets closest to: shopfronts, bays, bus shelter, bollards.
Delete the generator file for anything you refine.
**Done:** the ten most-seen assets carry baked normals and wear.

### 3.2 Tag-driven placement
Placement rules query manifest `tags` rather than naming assets. "Something tagged
`street` every 30 m on an arterial pavement."
**Done:** adding a prop to `assets/source/` and running `npm run ingest` makes it
appear in the city with no code change.

### 3.3 Prop density pass
Target roughly 10× current clutter — bins, hydrants, A-frames, cables, meters,
vents, planters, bikes.
**Done:** per-chunk draw calls still under 40.

### 3.4 Traffic vehicles
Currently merged blobs with tyres baked into the body; they visibly hover.
Rebuild with separate wheels, LODs, and the six silhouettes from
`vehicle/config.js:BODY_TYPES` that `districtWorld.js:718` currently ignores
(every parked car in Halstead Bay is the same sedan).
**Done:** wheels turn, cars sit on the road, a street has visible variety.

### 3.5 Crowd upgrade
Raise the figure ~11 cm so feet touch the pavement (`figure.js:25`/`:45` vs
`crowd.js` passing `y = 0`). Fix the `state === 3` prone pose, which copies one
matrix into all six parts and produces a heap. Then `SkeletonUtils.clone` the five
unused Quaternius GLBs into a ~10-instance skinned pool for pedestrians inside
35 m, with shared clips and per-instance mixers; keep the instanced fleet beyond.
**Done:** near pedestrians are skinned and varied; far crowd cost is unchanged.

---

## Sequencing note

Tier 0 and 1 are ~9 weeks full-time and buy most of the visible gap. Tier 2 is
another 5. Tier 3 never ends — that is normal, and it is why the pipeline in
Tier 0 matters more than it feels like it does on week one.
