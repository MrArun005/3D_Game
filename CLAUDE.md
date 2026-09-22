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
- `district.tarmacDepth(x, z)` and `roadDepth` are SIGNED distances to the
  nearest road edge: negative on tarmac, positive on the pavement, 60 far
  off the plan. "Deepest into the road" is the MINIMUM. (tokyo.js's front
  probe maximised it for a day and put every kanban on the back wall.)

## Current state

- **Particles are sprites now (2026-09-22, `core/spriteCloud.js`)**: every
  `THREE.Points` particle system (sparks x3, fire x2, puffs, tyre smoke, rain,
  road spray, puddle spray, steam, geyser, wind debris, blood, breakables) is
  converted in place: its position/colour arrays are re-wrapped as
  InstancedBufferAttributes on the same geometry, an instanced Sprite child
  reads them plus the PointsMaterial's size/colour/opacity by reference, and
  the Points material stops drawing. Owners are unchanged. Size = points size
  x 0.55 (tan of half the lens). Hot ones bloom via glow(). Stars stay 1 px
  on purpose. No-op under plain three (tests). Unverified in a browser: if a
  system is too big or small, the call-site's PointsMaterial size is the knob.

- **2026-09-09 review + fix pass** (`docs/REVIEW-2026-09-09-GTA.md`, ranked
  top-12 with file:line). Landed the same day, all unverified visually:
  - **Night is the clock's.** `clock.js:nightFactor(hour)` (pure, tested)
    drives grade.setNight, exposure 1.0+0.15k, LightPool.night,
    traffic.setNight, window-quad + podium emissives. `?night`/`?dusk` only
    pick the start hour; the two-light night rig is gone (one CSM day rig).
    Traffic headlamps are one merged geometry per car, hidden by day.
  - **Driving**: two physics bugs fixed in `dynamics.js` -- free wheels
    chattered at the step rate (implicit tyre reaction now) and spurious
    Coriolis terms welded velocity to heading (removed; u,v are re-projected
    from world velocity each step). Result: peak lateral 0.6 -> 0.95 g, coast
    + full lock at 80 km/h drifts 55 deg instead of spinning, handbrake slides,
    brakes capped at 0.95 muFz (1% front lock, was 49%). 0-100 is 7.24 s now
    (the old 6.77 was partly chatter). Walls scrape (`collision.js:scrape`)
    instead of stopping. Regression harness: `tools/sim/handling.mjs` +
    `test/handling.test.js` -- run it before touching config/dynamics.
  - **Streaming**: `InstanceBatch.emit` honours `group.userData.dead` (late
    merges no longer land in released chunks), `parkedVersion` keys the
    parked cache, boot grid released, `core/budgets.js:BUILD_MS` is the one
    build budget, per-step worst cost in F3 / photo.line().
  - **Gameplay**: pursuit cruise speed kept on respawn, kerb-lane pull-over
    works, 1-star officers hold fire until shot at, heli relaunches, story
    fails on WASTED/BUSTED, one Pay 'n' Spray price and gate, $50k grant is
    `?debug` only, getaway = 2 stars, fare/courier need a stop.
  - **UI**: `window.hud`/`__setWaypoint` assigned (phone GPS worked never),
    mute silences voices and persists, O/T and phone dev cards `?debug`
    only, stars/health above the minimap, one name (Halstead Bay),
    `hud.area()` toast. `THIRD_PARTY.md` lists every vendor licence; the
    Sketchfab props have none recorded. A `.vercelignore` for the NC assets
    was drafted but NOT added -- it changes the live garage; Arun decides.
  - Heli bindings still clash on C (descend/camera) and E (strafe/fire).
  - **Smoothness**: `vehicle/interp.js` interpolates the 1/120 step for the
    hero and chase camera (alpha = accumulator/STEP; leftover beyond the
    4-step guard is dropped); `#streetFurniture`/`#signals` are generators.
  - **Smoothness 2 (2026-09-22)**: `InstanceBatch.emit` yields every 48
    placements / 2 ms inside a material's merge (F3 'emit slice' =
    `catalogue.emitWorstMs`); vite splits `three`, `three-addons`, `net` from
    game code (index 572 kB, was 1.86 MB in one chunk); the district fetch
    starts before `renderer.init()`.
  - **Frame-rate governor (2026-09-22, `core/governor.js`, tested)**: dynamic
    resolution -- pixel ratio scales 1.0 -> 0.5 when the ~0.75 s average runs
    over ~17 ms, climbs back after a 3 s cool-down; still slow at 0.5 for 6 s
    writes `hb.lite` (next load = lite tier) with a toast. `?fixedres` off,
    `?full` clears hb.lite. GTAO now half resolution, 8 samples (was full res,
    16) -- the most expensive pass in the frame.
  - **Interior mapping (2026-09-22, `city.js:makeTileable`)**: every facade
    window cell is a ray-traced room (side walls, floor, ceiling lamp, back
    wall with a furniture band, 30% blinds, a few TV-blue rooms, per-room
    depth), grid from `material.userData.rooms` set in
    `facades.js:buildFacadeMaterials` (ROOM_COLS per style). Tangent sign from
    screen derivatives. Emissive only, so it shows at night; no draws, no
    fetches. Unverified in a browser -- if rooms slide the WRONG way as you
    pass, the sT/sB sign terms are the knob.
  - **Facade relief (2026-09-22)**: a half-res normal map per facade variant
    from the painted luminance (`facades.js` -> `RELIEF` WeakMap, NOT userData:
    copy() JSON-clones userData), applied in `makeTileable` through the tiled
    UV with a hand-built frame (the boxes have no tangents). ~11 MB VRAM for
    all fifteen. If reveals look raised instead of recessed, negate tn.xy.
  - **Brief pass (2026-09-11, `docs/BRIEF-2026-09-11.md`)**: the game is
    the first screen (light gradient card at the bottom, ALL CONTROLS in a
    `<details>`), the hero is red (0xb3161c), the chase camera banks into
    turns with speed (`camera.js` bank term opposes body roll), `car.odo`
    trip odometer on the HUD, and the seeded checkpoint run is playable solo
    from the phone (`window.__startRun`, best in `hb.best`).
  - **Mobile / touch** (`docs/MOBILE.md`, unverified on a device):
    `core/device.js` detection (`?mobile`/`?desktop`), `game/touch.js` overlay
    whose `read()` matches `createInput().read()` and merges via
    `mergeDrive`; mobile forces the lite tier; `body.touch` CSS in style.css;
    no pointer lock on touch, TAP TO START, rotate card in portrait.

- Tests: `npm test` — 20/20 passing. Node's built-in runner, no framework.
- Deploy (2026-09-03): Vercel project `halstead-bay`, public at
  https://halstead-bay.vercel.app. Git-triggered builds never leave UNKNOWN;
  deploy with `vercel --prod --yes` run detached (>6 min upload), then check
  `curl -sI https://halstead-bay.vercel.app/models/manifest.json`. Heavy vendor
  GLBs go through `tools/optimise-glb.mjs` first (`--keep-nodes` when code
  hides parts by node name); originals live in `assets/source/originals/`.
- **Shooting layer (2026-09-05)**: `game/weapons.js` (ARSENAL: pistol / SMG /
  rifle / shotgun, procedural one-draw models, heat->spread curve),
  `game/shooting.js` (crosshair = spread cone, ADS on right mouse, 12-shot
  recoil patterns, sway, 64-decal pool, `rayHitsBox` so buildings stop
  bullets), `game/policeAi.js` (pure, tested: weapon by wanted, aim jitter,
  LOS through buildings+vehicles, cover/peek/advance/arrest/down), officers
  in `world/officer.js` (7 vertex-coloured meshes with a geometric face,
  seeded variety, PoseBlender, lookAt), `game/modes.js` (range, hold-out;
  phone SERVICES cards). Keys: 0/` fists, 1-4 weapon, 5 grenades, X reload, RMB aim, C
  crouch on foot, Q lean, E fire/throw/punch, I horn (in the car), 6 sniper. Downed officers drop their
  weapon (one in five a grenade); phone SERVICES sells guns, armour and
  grenades; `storyMissions` steps take `needDowned: N`. Ammo, grenades and
  armour persist in localStorage `hb.arsenal`. Parked cars block lines of
  sight both ways; gunshots carry distance and a per-weapon voice; stars
  pulse red when an officer has a line on you and grey out once you have
  been unseen for 3 s. Debug hooks under `?debug`: `__dbg()`, `__aim(v)`,
  `__police()`, `__wanted(n)`. No Playwright in this project (Arun's rule):
  verify with `node --test` and reasoning, he play-tests.
  Later the same day: `game/tracers.js` (one LineSegments pool of moving
  streaks for incoming fire, fed by `traffic.#fireAt`, the ONE place any
  police round is rolled), `audio.whiz` on near misses, a single `held`
  state in main ('fists' | 'gun' | 'grenade'), officers walk between covers,
  and EVASION: `policeAi.evasionDecay` drains stars once nobody has had a
  line on you for 10 s (cruisers set `traffic.hot` by LOS too), cruisers
  sweep a `searchRadius` ring round `traffic.seenX/Z` that the minimap
  draws. Downed officers also drop a vest (15%: +50% armour).
  Evening: `policeAi.crimeWitnessed` (no stars: a crime needs a cruiser
  within 90 m or pedestrians within 45 m), a zero-star PATROL cruiser
  (`traffic.patrol`, hunt=false, lights off, occasionally 'responds' with
  lights + siren), `audio.siren` for the nearest hunting cruiser,
  `traffic.fireAt` public (roadblock posts use it), vehicles carry `vhp`
  (8 rounds -> cruise 0, officers step out), punctures via `w.shot`
  (Damage.#wear holds them; the spike strip never worked before), flats
  cost grip/drag in dynamics (`car.flat[]`), the frame catch renders the
  last good state instead of going black.
  Visuals, same evening: `core/additive.js` -- `additive(mat)` puts the MRT
  normal guard on every additive material (18 sites were unguarded: the
  rain-speckle bug at every lamp cone), `glow(mat, k)` routes a material's
  output into the emissive target so it BLOOMS (tracers, sparks, both muzzle
  flashes, fire ball, grenade fireball); `world/puffs.js` one-draw smoke
  pool (muzzle wisp, blast, dead engines via `traffic.puffs`); brass
  casings (24-instance mesh in weapon.js); hurt vignette (`grade.setHurt`,
  uHurt); officer head is a separate 3x target (`hit.head`); downed
  officers sink, pickups turn and blink. Gemini works in the same tree
  (reputation.js, intel.js): stage only your own hunks, never `git add -A`.
  Late: pickup halos + cruiser light-pool discs (shared materials, listed by
  `traffic.policeMaterials()` for the warm-up), grenade scorch + vehicle
  blast damage, crash sparks/dust from `car.hitAt`, tyre smoke, stuck
  drivers honk (`traffic.honk`), parked-car alarm (`audio.alarm`), hit
  marker sound (`audio.hitmark`), hit-and-run blood, one-star officers hold
  fire unless shot at (`policeAi.shouldFire`), and the pipeline warm-up in
  main compiles each material on the object kind that draws it (Points /
  LineSegments / InstancedMesh / Mesh) -- a Mesh-warmed PointsMaterial was
  a first-use hitch. Play-test list: `docs/PLAYTEST-2026-09-05.md`.
  Morning after: storm lightning (`world/lightning.js` pure + tested,
  weather.js flashes the hemisphere light, `audio.thunder`), the zero-star
  patrol runs its own NPC pursuits (`c.chase`, `#steerToward`, pull-over,
  30% bail), civilians pull over for ANY lit cruiser (`traffic._lit`),
  cruisers at speed panic the pavement, distant night gunfire, LightPool
  const-shadowing TypeError fixed + cruiser headlights + a red/blue beacon
  point light, marksmen fall on their roof, every shooter has a muzzle flash
  (`traffic.muzzleFlashMesh`).
- **Glare sprites (2026-09-05, GTA-style, `world/glare.js`)**: one instanced
  `THREE.Sprite` (`sprite.count = N`, positions/colours/phase as
  `InstancedBufferAttribute` + `instancedBufferAttribute()` nodes) per chunk
  on every lamp head and kanban, SpriteNodeMaterial, additive, streak texture
  sampled twice at counter-rotating angles over a soft disc, pulled 0.8 m
  toward the camera so its own head does not depth-occlude it, faded by the
  `setGlareNight` uniform. Two traps, both hit: (1) **WebGPU draws
  `THREE.Points` at ONE pixel** -- `size`/`sizeAttenuation` are ignored and
  `pointUV` compiles to an unresolved `gl_PointCoord`; the rain/spray Points
  are 1 px too. Sized sprites need `Sprite` + instancing. (2) the
  zero-normal `mrtNode` (additive.js `NO_NORMAL`) on a sprite quad draws a
  BLACK square (GTAO reads zero normal as occlusion) -- use `glow()` on
  quads. Cost: +1 draw per chunk (sprites are not bundled), ~+40 at the
  Tokyo interior (1471 -> 1520). Verified in the browser: glare6.jpg.
  Plus the FAR set: `dressing.js:farLampHeads` replays the lamp rows over
  the whole district (5,247 heads) into one instanced Sprite built with the
  far stand-ins; `setGlareRing` (called from #cullFar) zero-scales the ones
  inside the detailed ring, so the street lights run to the horizon
  (farglare1.jpg). One draw for the whole map.
- **Night pass, 2026-09-12 (ultracode workflow: four implementers, four
  skeptics, browser check by the maintainer)**: `world/streaks.js` --
  GTA's anamorphic headlight streaks, one instanced Sprite (48) refilled
  per frame from oncoming traffic/cruisers + the hero (lamp positions
  measured from traffic.js:311 and model.js:331; pure `streakLamps` is
  tested); `world/farTraffic.js` -- 220 phantom cars on the far road graph,
  four sprites each in ONE draw, right-hand lane, re-seeded outside the
  detailed ring, count 0 by day (a hidden Sprite is never warmed up by the
  boot compile -- gate by `count`, not `visible`); `core/grade.js` --
  `uFilmic` blends the NIGHT tone map toward a per-channel Hable curve
  (AgX measured: (2,0,0) keeps 83% saturation, (2.4,0.3,0.9) only 47%;
  Hable keeps 100%/63%), driven by the clock profiles' `filmic` key
  (NIGHT 1, others 0 -- every profile must carry the key or blendVal is
  NaN), and `bloomThresholdFor(t, exposure)` = t*1.15/exposure so the
  bloom threshold is a display quantity (night 0.85 unchanged; a
  day-booted session at night gets 0.93). `dispatch.requestTank/
  requestHelicopter` exist now (featureTour called a missing method).
  Post-pull crash fixed: commit 22c1c0c's constructor rewrite dropped
  `this.parkedLod = new Map()` and every chunk build died on `.set` -- the
  city never streamed ("chunk: none built since load", 0 bundled). When a
  pull changes a constructor, diff the `this.* = new Map()` lines against
  their consumers.
- **Vehicle contact (2026-09-12, "touch another car and the whole game
  rumbles")**: two real causes, measured in the browser. camera.js added
  `impact * 0.022` EVERY frame of the 0.5 s decay envelope (3.5x the
  intended kick, frame-rate dependent, unbounded: a 160 km/h wall moved the
  camera 1.6 m/frame) -- now `shake = min(1.6, shake*exp(-6dt) +
  max(0, impact - lastImpact) * 0.07)`, one kick per RISE. collision.js
  `resolveObstacles` measured the closing speed against the GROUND, so
  nudging traffic at your own speed was a full-speed crash plus a dead stop
  in the lane, then another crash on every re-contact -- `into` is now
  relative to `o.car.speed` along `o.yaw`, restitution/friction act on the
  relative velocity (parked cars unchanged), and hitTag/hitForce/hitRef
  are only attributed when YOU drove into it (a PIT ram no longer gives you
  a star and no longer costs the cruiser its engine). main.js gates
  `damageModel.hit` on `car.hitAt` (once per contact event; it bit every
  frame and double-charged police rounds) and damage.js's per-event cap is
  0.3 / 0.02 per m/s. Standing contact: impact 0, jitter <= 0.2 mm.
  `test/contact.test.js` holds all of it.
- **Browser verification IS allowed (2026-09-05 onward)** when Arun asks
  for a recording or reports a bug: `tools/record-tour.mjs` recipe (headed
  Chrome for Testing under ~/Library/Caches/ms-playwright, `vite preview`
  on :4173, `?debug` hooks `__warp/__time/__rain`, dismiss the title card
  with `#hud.classList.add('gone')`). One `vite build` at a time. The older
  "no Playwright" line below is about screenshot churn, not verification.
- **Bridges were banked, not flat (2026-09-12)**: the owner said "bridgeee is
  shit" and the cause was upstream of every bridge asset. `district.js`
  `spanHeight` is a CLIFF -- full height inside a band of `half + 5.5` about
  the bridge POLYLINE, zero outside -- while districtWorld sampled the deck at
  each of the road quad's four CORNERS. Where the road graph does not sit on
  the polyline (on HALSTEAD LIFT BRIDGE it runs ~16 m west of it) one kerb
  landed inside the band and the other outside: the signature bridge was
  banked **7.6 m across its 28 m width for 480 m**, one kerb on the ground.
  51 of 163 elevated segments had >1 m of cross-fall, worst 9.4 m. Fixed by
  sampling the deck at the two END CENTRES and applying it FLAT across the
  width (ramped along, flat across, which is what a deck is); the skirt and
  parapet read the same `deckY`, so they cannot disagree with the tarmac.
  Anything new that stands on a deck (piers, railings, lamps) must use the
  segment's own deckY, never `elevationAt` at its own position.
- **Resolution / 4K (2026-09-12)**: `renderScale()` caps the drawing buffer
  at the 60 fps floor's pixel count (1.24 MP full, 0.78 MP lite) and lets the
  browser upscale. Escape hatches, in precedence: `?res=N` draws at N device
  pixels per CSS pixel (clamped to 2x the display ratio), `?native` is the
  old 1:1-in-CSS-pixels flag. EITHER needs `?nodrs` beside it, or
  `autoResolution` sees the first >19.5 ms sample and walks the scale back to
  MIN_SCALE, so you never see what you asked for. Measured on this machine,
  same viewpoint, 959 draws / 2.53M tris either way:
  0.78 MP 16.6 ms | 8.29 MP (3840x2160) 40.6 ms. So 4K is pure fill: the
  scene cost does not move, ~11x the pixels costs ~2.4x the frame. It is a
  screenshot/photo-mode setting, not a play setting, until the post stack
  gets a cheaper path.
- **Asphalt textures are real now (2026-09-05)**: the shipped `asphalt_*`
  set was the library's generic dot pattern; under the wet-road env boost
  every dot mirrored as a cobble. `tools/asphalt-textures.py` (numpy + PIL,
  seeded) writes a grain/patch/speck set with near-flat normals and ~0.07
  linear albedo; `main.js` also fades `tarmac.normalScale` 0.8 -> 0.25 with
  `car.wet`. Verified day and night in the preview build. The other library
  textures are still the dot generator -- check before blaming a shader.
- **Little Tokyo is self-built (2026-09-06)**: `world/tokyo.js` generates
  every building on the LITTLE TOKYO blocks (district.js assigns them) as
  one merged vertex-coloured geometry with an `emit` attribute; one
  `tokyoMaterial()` (MeshStandardNodeMaterial, emissiveNode = emit x
  emissiveIntensity, `setTokyoNight(k)` from main) per chunk mesh. Sign
  boards ride the shared atlas quads with the Tokyo tiles. districtWorld
  skips kit, massing and facade dressing for `box.tokyo`; `?notokyo` is the
  escape hatch. Arun's rule for this area: no Kenney, no kit -- ours.
  Cost, measured from the district file in node (2026-09-06, with the
  planner's height ranges): 122 buildings, ~176k triangles for the whole
  district (windows every 2.4 m on the street face, 3.4 m elsewhere; two
  18-24 storey landmarks), ~730 atlas boards (instanced: fascias, rolled
  vertical kanban panels, projecting signs, rooftop billboards), one mesh +
  one LineSegments (poles/wires, `buildTokyoStreet`) per chunk. Also:
  lanterns, string lights, striped awnings, shutters, external stairs,
  vending machines, the shrine (its hall is a solid), framed lit doors,
  scramble crossings at its cross nodes (#signals), kanban registered as
  coloured night-light heads (`headsByChunk` + LightPool head colour), taxi
  liveries on 40% of civilians spawning there. Photo preset `little-tokyo`.
  Around it: a sixth radio station (SHIBUYA CITY POP, yo scale), the story
  mission `tokyo_1`, the big map shows cruisers + the search ring + a
  magenta Tokyo tint (legend updated), an area-name toast on district
  change (`districtAt`, polled 2/s) with a dispatch call-out while wanted,
  rain slows traffic 28% / hurries pedestrians 35% / scales spray, puddles
  come and dry over 3 min, a distant siren every 60-180 s. Voices: chatter
  speaks every dispatch line (speechSynthesis, `?novoice` off) and officer
  shouts (arrest/pinned/reload/frag) in a raised voice without the squelch;
  the player's horn is I. Time of day persists in `hb.clock`. Idle cinematic:
  20 s without input, stopped (car or foot) -> the camera orbits you and the
  HUD fades (`idleT`/`idleCam`, body class `idlecam`). Tokyo neon has a
  per-vertex `flick` phase driven in TSL (one glowing part in seven buzzes).
  Pay 'n' Spray: `garage.onRepair` / `garage.heat` -- a repair below three
  stars calls `traffic.standDown()`; a completed carjack while unseen adds
  6 s to `traffic.coldFor`. Pedestrians cross on `signalState` of their own
  junction (`crowd.signalTime`), Tokyo junctions carry pedestrian lamps and
  the crossing chime follows the nearest junction's phase. Police: the PIT
  (slot-0 cruiser rams at 3 stars, `c.ramming`), ramming back costs the other
  car's engine (`collision.js` records `car.hitRef`; one `damageVehicle` in
  main for bullets, rams and blasts), dispatch names your paint
  (`paintName`) and the last-seen district, a radio newsflash at 3 stars
  (`radio.news`), a heartbeat under 25% health, gunshots echo
  (`audio.js echoBus`), the range's 60 m boards slide. Fifth gun: `sniper`
  (ARSENAL + `sniperGeo`, muzzle 0.66 measured, ADS 18 deg, Digit6 ->
  'weapon6'; main maps index 5 -> WEAPON_KINDS[4]; HUD keys it 6); the first
  5-star marksman carries it. `test/actions.test.js` asserts every input
  action has a main.js handler (the 'camera' handler was lost once).
- **Night look (2026-09-05, from Arun's cover art `assets/art/game_cover.jpg`
  and `splash_screen.jpg`: ink sky, saturated magenta/cyan neon, wet road,
  heavy bloom)**: grade.js `uSat` 1.32 + indigo/warm split tone `uSplit` at
  night, bloom 0.95 / 0.55 / threshold 0.85 in `setNight` (1.35/0.72/0.72
  bloomed every lit window into haze -- checked in the browser); clock.js
  night dome tint (0.03, 0.035, 0.075) and fog (0.022, 0.028, 0.06) -- darker than the dome so fogged
  mountains read as silhouettes, and weather.js darkens it with the rain like
  the dome (fog measured #1f2437 at 21:55 in rain), moon
  sun 0.30 / hemisphere 0.17 (0.42/0.22 lit the far mountains like dusk),
  environment 0.24, sign emissive 2.46; split-tone shadow lift is a hint
  (1.06 blue) -- 1.18 made the sky mid-blue; tokyo emissive 1.3 (neon parts sit
  at 1.4x so they bloom, windows do not); rain fog x1.5; wet tarmac
  envMapIntensity up to 3.7. Checked in the
  browser at the `little-tokyo` preset (on the road now; the old point was
  inside a building). Still to do: more magenta/cyan in the sign palettes.
- **Draw budget, measured 2026-09-05 (browser, preview build, chunks
  settled)**: kingsway-corner preset 1404 draws (793 bundled) / 3.56M tris;
  the spawn CHASE view looking down the Tokyo road 1860-1900 draws (811
  bundled, ~1090 direct) by day AND night (night adds ~22). The direct part
  is not the facade/prop batches (bundling them changed nothing) -- it is
  view-dependent: shadow-cascade and dynamic draws along a 500 m sightline.
  Halving the casters (1161 -> 565 by re-applying the shadow ring when the
  prop batch lands) did not move the count either: those were already culled
  from the cascades. The ~1080 direct draws need a per-pass breakdown
  (renderer.info counts all 25 passes) before anyone touches them. Do not
  "fix" it by dropping bundles or shells.
- **Recording (2026-09-05)**: `tools/record-tour.mjs` drives a headed
  Playwright Chrome against `vite preview` (never the dev server: an HMR
  reload mid-tour killed one take) with `recordVideo`, captions each scene,
  and writes `report.json` with per-scene console errors. Headless stalls on
  the WebGPU canvas (frames repeat, black shards). Two takes today: 19
  scenes, 0 errors. It found the frozen camera (`idx` lost from the wheel
  loop), the phone crash (`pay` vs `payout`) and the headlight blob. Draws and fps
  at kingsway-corner NOT re-measured since (no browser in this session).
  Also: `buildTokyoStreet` (poles + wires), `buildShrine` (park block),
  landmark slabs to 24 storeys on tower blocks, `District.districtAt` steers
  the crowd there, `audio.tokyo` ambience.
- **iCloud evicts `.git` (2026-09-05)**: the repo lives in `~/Desktop`, which
  iCloud syncs; it marked `.git/index` and 85+ objects `dataless`, so git
  timed out on mmap. `rm .git/index && git reset` rebuilt it once the files
  re-materialised. `ls -lO .git/index | grep dataless` is the test; the real
  fix is moving the repo out of `~/Desktop`.
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
- The active plan is "Light the City" (2026-09-02): six workstreams to reach
  Shibuya-density signage, real light and crowd downtown. Phase 0 (budget
  room + photo-mode acceptance cameras) and Phase 1 (signs and shopfronts)
  are done; Phase 2 is window quads + night bloom retune + glare sprites. Every phase commits with a frame from a named preset and
  its `photo.line()` stats, or it does not commit.
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

- **Death flow + on-foot camera (2026-09-11).** The "no hero" report was the
  CAMERA, not the character: `OnFoot.update` eases `camPos` toward its target
  with a 0.002^dt lag and `exit()` never reset it, so the first frames on foot
  flew in from the origin (or the last exit point) with the hero out of frame.
  `exit()` now arms `camSnap` and the next update lands the camera; a
  fall-through guard snaps you back when you are >2.5 m under the sampled
  ground. The WASTED path (`main.js onDeath`): the hit handler ignores damage
  while `wastedAnim`/`dying` are set; `traffic.holdFire` (cleared by
  `standDown`) stops officers firing during the clip; the clip ends in
  `hud.blackout` and the respawn happens at full black; `onBust` returns
  while dying (the timer used to respawn you twice); drowning sets `dying`
  and goes through the same path (fee, job lost, stars KEPT -- the quay
  hand-back and the free star are gone); armour resets to 0, weapons stay;
  you wake up ON FOOT at the hospital doors with the car parked beside you,
  whatever body it wears. Review fixes on the grade work: G in photo mode no
  longer toggles the checkpoint run, the contract comments in grade.js are
  back, the frame is clamped after vibrance, `setNight` delegates to
  `interpolateGradeProfile` (clock.js is the ONE writer; the boot-time
  `setNight(true)` is gone), garage flash strings have their $ back. Debug
  hooks: `__hurt(h)`, `__dying()`, `__camera`, `__hud`. 151/151 tests;
  browser verification: see the line below this entry.
  VERIFY-STATUS-PLACEHOLDER
- **Taken from APEX Heat City (2026-09-10)** -- a mindblown.ai three.js/WebGL2
  game probed with Playwright (`scratchpad/probe-game*.mjs`; 85 MB download,
  parts of it better than ours, most of it not). What was worth taking:
  1. **An opening menu** (`index.html #hud`, `style.css`, `main.js start()`):
     eyebrow, title, five mode cards (free roam / street jobs / heists / range
     / hold-out), a gold ENTER THE CITY, a three-line legend. A card only sets
     `menuMode`; ENTER (or any click) starts, then the mode fires 500 ms later
     -- `jobs.toggle`, `modes.startRange`, `modes.startHoldout`, or a flash
     pointing at the phone. Every mode already existed; none was findable.
  2. **The place line** (`hud.setPlace`, fed from the district poll in main):
     "OLD QUARTER · 15:30 · AFTERNOON", top centre, mono, always on.
  3. **A hero frontage from Poly Haven's CC0 tenement kit**
     (`landmarks.js assembleTenement`). The GLB is a PARTS LIBRARY laid out on
     a display grid, NOT an assembled wall -- placing it whole gave a row of
     loose wall samples in front of a grey block (verified, then fixed the same
     hour). Kit facts, measured: 3 m modules x 3 m storeys, origin at the
     module's RIGHT edge on the wall plane z=0, front +Z; window/door inserts
     share the wall module's origin; dado/cornice are 3 m mouldings, crown the
     0.75 m parapet, *_end and pier pieces close the ends. The assembler
     builds 17 bays x 4 floors (one window type per bay up its height, a
     doorway every fourth bay, dado with door cut-outs, cornice + crown, end
     piers), bakes ~150 clones into ONE mesh per material (5 draws), faces the
     nearest road by probing `district.tarmacDepth` at four yaws, slides to
     the kerb, and puts a plaster body 14 m deep behind it. Lands on the
     56x44 Old Quarter lot at 1103,1291. 10.6 MB lazily loaded; the factory
     set (13.8 MB) waits for KTX2 -- `optimise-glb` made these files BIGGER
     (PNG normals), as the memory note warned.
- **Economy + world, 2026-09-09** (built and tested; screenshot pass for the
  gables and SSR still owed): Steelgate **chop shop** (`garage.js CHOP_SHOP`,
  `chopValue`: 35% of showroom, +20% with the Chop Shop perk; N inside 60 m
  sells a body you do not own and hands back `lastOwned`; the AR scanner
  quotes the same number); **Underworld Network** perk made real (witness
  reach halved via `crimeWitnessed(..., reach)`); landmarks `marrow` and
  `steelgate` for `/tp`, photo preset `marrow-hill` (needs the car there for
  the gable chunks); **SSR wet streets** ported from the 2026-09-01 stash as
  an OPT-IN `?ssr` (grade.js, gated by `setWet(car.wet)`) -- opt-in because the
  harness cannot time the GPU and rule 1 wants a measured cost first.
  Tests: `test/chop-shop.test.js`.
- **Interior mapping + a gameplay loop with teeth (2026-09-08, evening)**:
  1. **Interior mapping** (ROADMAP 2.2, `city.js:makeTileable`): every window
     now has a parallax ROOM behind it -- a tangent-space ray from the glass
     into a bay x storey x depth box, hit-tested against back wall / sides /
     ceiling (lamp hotspot) / floor, a furniture-dark lower third and a blind
     in one room in three. Glass pixels come from the ORM roughness the
     facade painter writes; the grid comes from `material.userData.{tile,
     cell, depth}` set in `facades.js` (COLS per kind; bases 1 or 3 units).
     Lit/unlit is now PER WINDOW (was per 4-storey tile). Zero draws, zero
     tris; one ORM sample now shared by roughness, AO and the glass mask.
     Verified: kingsway-corner @21:00 shows a warm/cool scatter of lit rooms
     with no lamp-on-floor artefact (the TBN sign was the risk).
  2. **RACE jobs** (`jobs.js #race`, tested in `test/jobs-race.test.js`):
     G can now roll a street race -- 3-4 checkpoints 150-320 m apart on the
     Mission route, par at 15 m/s + 8 s, +30% for beating par by 15%, the
     usual late/heat penalties. `pickedUp` starts true so the stop-to-load
     prompts stay quiet.
  3. **Repair priced by damage** (`garage.js repairCost`): \$100 + \$600 x
     damage, +\$200 for a respray when hot. It was a flat \$150, which made
     crashing free.
  4. **Reputation perks that were listed on the phone but consumed nowhere
     now do something**: Guardian Armor (>= 300) cuts collision damage by a
     quarter (`damage.js hit`); Civic Priority (>= 750) drops heat 1.5x faster
     (`traffic.js` around evasionDecay); Street Intimidation (<= -300) makes
     civilians ahead of a fast player pull away for 4 s, one in five with a
     horn (`traffic.update`, the fugitive flee boost reused). Chop Shop and
     Underworld Network are still labels only -- there is no black market
     to pay out and no detection timer to double.
  Gunfire already scattered pedestrians and made drivers floor it
  (`main.js` fire path), so that reactivity was NOT re-added.
  Night at kingsway-corner measures 1523 draws / 3.80M tris -- over the
  1400 line, but that is the lamp/glare night load (Tokyo night was already
  1481); nothing in this pass adds a draw.
- **Buildings & daylight (2026-09-08, PLAN-BUILDINGS-LIGHTS-2026-09-08.md)**:
  the day scene was flat because the upper storeys were PAINT (no relief) and
  the fill swamped the sun. Four changes, all verified on screen (one boot,
  three presets -- not a shot per step):
  1. **Facade relief.** `facades.js` now paints a NORMAL and an ORM map beside
     every colour/emissive facade and base painting -- window recesses (four
     tilted reveals + a sill), floor/fascia ledges, glass at roughness
     0.10-0.16 vs walls ~0.78, metalness 0 (ART_BIBLE binary). Bound through
     the tiled UV in `city.js:makeTileable` as `normalNode`/`roughnessNode`/
     `aoNode` (the raw-UV trap that whole function exists for). Cost: two
     texture samples per facade pixel, ~30 canvas maps; no draws, no tris.
  2. **Different structure.** `#massing` gained `gable` (a pitched roof prism,
     `A.geo.gable`, 8 tris, for suburbs + period rows -- the single strongest
     "houses not offices" cue) and `bays` (full-height projecting oriels on
     period mid-rises), plus parapet lips round every flat roof and a plant
     room on office slabs. New per-district form weights. All extra boxes go
     in the existing facade/roof buckets, so ~+120 tris/building and zero new
     draws. Pitched roofs skip `dressRoofs` clutter.
  3. **Daylight.** Hemisphere fill 0.55(grey) -> 0.40(blue), sky environment
     1.15 -> 0.85, sun 2.8-3.6 -> 3.3-4.2 with colour temperature by
     elevation. The old grey fill + bright env lit a shaded face to within a
     stop of a sunlit one -- which is why the exposure and grade A/Bs never
     found the missing contrast; it was in the fill, not the curve.
  4. **Containers** (see the fixed bug above) and the mountain/fog colour (also
     above). Draws at kingsway-corner ~1092-1414 / 1.5-2.6M tris, within
     budget. Full plan and the research it rests on:
     `docs/PLAN-BUILDINGS-LIGHTS-2026-09-08.md`.
- **Waterfront (2026-09-08)**: `world/port.js` (new) builds Harbour Point as a
  container port along the one bay shore segment inside the district boundary:
  a quay wall with a real drop, an apron, three procedural gantry cranes, dense
  aligned container rows from the catalogue batch, sheds, and an extruded-plan
  container ship berthed 8 m off the wall. Every placement is gated by
  `district.tarmacDepth(x, z) > 0.5` (negative means inside the carriageway).
  `world/beach.js` skips that segment and now carries a promenade, a palm row
  (the props.js palm species), a 120 m pier with a pavilion, lifeguard towers,
  and a crowd that bunches at the pier. Cost, measured at the photo presets:
  beach +17 draws, port +6, both scenes ~1.42M tris. Presets `beach`, `port`
  and `docks` frame them. Three traps, each confirmed by computation before
  the fix: (1) the sand read near-black because its quads faced -Y and
  `DoubleSide` lights a back face with the normal FLIPPED -- wind the triangles
  up and go single-sided; (2) the bay polygon starts on the map edge at z=3060
  while the district boundary stops at z=3000, so a clip that runs from the
  segment start returns a zero-length quay -- find the inside RANGE; (3) with a
  `batchRoot`, `InstanceBatch.emit()` puts placements into city-wide
  BatchedMeshes and the target group stays near-empty by design, and neither
  batch path carries per-instance colour -- which is why the containers are
  grey. Colouring them needs a catalogue feature or an exception to rule 3.
- **Noon sky (2026-09-08)**: the haze band narrowed from 8 to 3.5 degrees of
  elevation and the gradient is dithered over its full height (the old wash
  covered the top half only; the banding below read as moire on the dome); the
  sky texture is ClampToEdge on V, as an equirect must be, at anisotropy 16.
  Measured through three r185 AgX (ported verbatim): a bright sky keeps only
  ~52% of its chroma and retention is a function of BRIGHTNESS, not hue, so a
  noon sky can only be so blue at exposure 1.05. Exposure 0.88 was tried and
  reverted (darker, no more contrast). The day grade (`uContrast` 0.34 and a
  teal/warm split tone) measured +5% contrast and no saturation gain. The
  tables are in `docs/GTA-VISUALS-RESEARCH.md` item 3.
- **Afternoon by default, haze by day (2026-09-08)**: the game boots at 15:30
  (`main.js` GameClock startHour; `?time=12` gets noon back). The clock puts
  the noon sun at ~79 degrees, so every shadow fell straight down under its
  caster; at 15:30 it is near 38 degrees and the near cascade puts long shadows
  under cars, lamps, people and parasols (verified at the beach preset). Day
  fog density 0.00018 -> 0.0004 (`clock.js`, `renderer.js`): the mountain ring
  no longer stands crisp and brighter than the sky 3 km out. The port and beach
  set pieces are flagged for SHADOW_FAR_LAYER like the building shells. The
  look-lab that measured all of this pins live values with defineProperty,
  because the clock rewrites fog density and both light intensities every
  frame; a plain assignment is overwritten before the shot.

## Known bugs — do not "discover" these again, just fix them when in the area

### Open

- ~~Per-instance colour only on the batched path; merge path drops it, so
  containers were grey.~~ **FIXED 2026-09-08 (verified: coloured containers at
  the `docks` preset).** `InstanceBatch.emit` now splits each material's
  placements into plain and tinted; the tinted ones bake their per-placement
  `color` into a vertex-colour attribute and merge under
  `catalogue.tintedMaterial(mat)` -- a `vertexColors` clone kept per material,
  so only containers are tinted, every other prop sharing the material is
  untouched. One extra draw per chunk that has any (the yards, the port).
- ~~Distant mountains read brighter than the sky.~~ **FIXED 2026-09-08
  (verified at the `docks` preset: the range now fades INTO the sky).** The
  cause was the fog colour, and specifically that `clock.js` set it with
  `Color.setRGB(0.72, 0.79, 0.87)` -- setRGB takes LINEAR, so on screen that
  was ~#dbe6f0, far paler than the sky behind the range. FOG_DAY is now
  0x93b7de (the dome's own colour ~10 deg up, textures.js SKY_DAY at v=0.55)
  set with `setHex` in both renderer.js and clock.js. The rock palette and
  slope shading from the earlier pass stay.


- **Far-cascade shadow: the receivers were the gap, not the cascades
  (2026-09-08).** Reproducing CSMShadowNode's fitting offline
  (`scratchpad/csm-fit.mjs`, the r185 math against the `docks` preset): every
  ground receiver 30-500 m out and a 42 m crane top all fall inside their
  cascade's ortho box AND inside [near, far] -- so neither the fit nor the far
  plane (900) was ever the cause, and nor is the SHADOW_FAR_LAYER gate. What
  the `docks`/`beach` presets actually show is the FAR CITY: they stand
  1.3-1.5 km from the car, outside the loaded ring, where the only ground is
  the far-city roads and block slabs -- and those had `receiveShadow` unset,
  so nothing there could take a shadow. Both now receive (districtWorld
  #buildFarCity). Cascade 0 (0-52 m) always worked (beach parasols/palms);
  near+mid shadows verified at `tower-west`/`kingsway-corner` at 15:30 and
  17:00. A crisp long crane shadow at the docks is still marginal -- the port
  sits at the map edge where the mid-cascade texel is ~0.16 m and the
  caster/receiver geometry is sparse -- but it is no longer "lands nothing".
  For reference, the earlier note read: Cascade cameras read masks [1, 8, 8] as
  designed and 76 meshes carry the far layer. Unresolved; suspects are the
  far cascades not fitting in photo mode, receivers (water, apron) not taking
  far shadow, or CSMShadowNode itself. Next test: a view within 52 m of a
  crane base at 17:00 (isolates casters/receivers from the cascades), then a
  kit tower with the sun perpendicular to the view.

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

### Fixed 2026-09-02 (verified, kept here so they are not re-reported)

- **The far shadow cascade never worked, and cost 1.36M triangles a frame.**
  The day rig was two directional lights; the wide one ran at intensity 0
  ("shadows only"), and a shadow can only darken its own light's
  contribution, so it shadowed nothing while re-drawing every crowd figure,
  prop and parked car into a 460 m map. Replaced by `CSMShadowNode` on the
  one sun (`renderer.js:GatedCSM`): splits 52/156/520 m, every caster in
  cascade 0, `SHADOW_FAR_LAYER` (building shells only) in cascades 1-2.
  Shells enable the layer bit in `districtWorld.js:tiled()` and cast from
  the neighbouring ring. Spawn driver camera: 1137 -> 1017 draws,
  4.66M -> 3.32M triangles, and towers now throw shadows across the street.
- **Building shells never cast at spawn.** The shell emitter left
  `castShadow` to the ring gate in `update()`, which had already run before
  the chunk generator emitted them and only re-ran on a ring change. Set at
  creation now.
- **First shell to cast crashed the frame** ("Cannot read properties of
  undefined (reading 'r')"). three's shadow pass compiles a material's
  `colorNode` inside its override depth material to read the alpha; an
  unpinned `materialReference('color', 'color')` in `city.js:makeTileable`
  resolved against that material, which has no `.color`. Pass the material
  as the third argument -- always, for any node that reads a material
  property.
- **Photo mode** (`game/photo.js`, P): free camera, `[ ]` presets, Enter
  prints the stats line; `window.photo.goto(name)` + `.line()` for the
  harness. `kingsway-corner` is the spawn driver camera every budget figure
  is measured from. Stats keeps the last ten whole-chunk build costs.
  Harness lesson: toggling `castShadow` or `shadowMap.enabled` at runtime
  under WebGPU invalidates a pipeline and blacks out every later frame while
  the counters keep working -- profile in one load, screenshot in another.
- **Chunks are render bundles** (`THREE.BundleGroup`, districtWorld build).
  Profiled 2026-09-02: 11.6 ms of CPU per frame inside the render call for
  ~1,500 meshes; with each chunk recorded once and replayed, 8.8 ms, and the
  JS heap 525 -> 304 MB. Rules that come with it: every mesh inside a chunk
  is `frustumCulled = false` (bundle contents are culled only when recorded),
  the chunk is culled as a whole in `update()` (3x3 ring always drawn for
  shadows, outer rings by frustum box), and any change to what a chunk shows
  (ring visibility, parked LOD, castShadow, a late-landing dressing mesh)
  must bump `group.needsUpdate`. `renderer.info` does NOT count replayed
  draws: the F3 overlay and `photo.line()` add `world.bundleStats()` (761 of
  987 draws at kingsway-corner are bundled). Do not trust a raw
  `renderer.info.render.drawCalls` again.
- **Render-bundle ghosts, root cause** (`core/renderer.js:patchNestedRenderInBundle`):
  bundles render first, so the frame's first lit object sits inside a
  recording; its lazy shadow-map update is a nested `renderer.render()`, and
  three's `_renderBundle` ends every nested bundle with
  `_currentRenderBundle = null`, which the outer recording never gets back.
  Everything after it is drawn directly (the frame looks right) but not
  recorded: spawn chunk list 81, recording 1; shadow cascades 44/12/12.
  `renderer.render` is wrapped to save/restore the pointer. 76/76 after.
  `tools/framediff.mjs a.png b.png` measures a stale frame (as-rendered vs
  forced re-record): 21% before, expected ~0 after. Bundles default ON,
  `?nobundles` for A/B.
- **District character** (`DISTRICT_FORM` in districtWorld, `DISTRICT_STYLE`
  in dressing): podium-and-tower, L-wings, terraces, sheds by district; the
  facade kit style follows the district two times in three.
- **Night light pool** (`game/lighting.js`): 6 real point lights (`?lights=N`)
  on the nearest lamp heads, 0.25 s re-rank, 20% hysteresis, 1 s hold.
  `grade.setNight()` retunes bloom for night.
- **Light the City, phases 2-5 landed 2026-09-02**: window quads
  (`signs.js:buildWindowMaterial`, per-instance `aTint`), traffic headlamps
  and 4 pooled spots (`lighting.js`), crowd 320 with a first-cut kerb wave
  at junction nodes (`crowd.js`, uses `CYCLE`), roof clutter by area, mast
  beacons (`A.mat.beacon`), wider sodium horizon. shopfront-night: 931
  draws / 3.79M tris -- 0.2M under budget, so the next layer must pay for
  itself.
- **The loop (2026-09-02)**: `game/jobs.js` (G: courier / fare / getaway,
  pay by distance and district tier, wanted stars cost 20% each, WASTED or
  BUSTED forfeits; cash + jobs persist in localStorage), `game/garage.js`
  (B browse, N buy/fit/repair; bodies are Kenney files fitted via
  `loadHeroSkin`; `Damage.repair()`), `hud.toggleMap()` on Tab. The
  checkpoint race remains for multiplayer rooms only. `Crowd.panic()` scatters
  pedestrians from gunfire and pavement mounting.
- **Hero skin**: `vendorCars.loadHeroSkin` hides the loft body/glass/doors/
  trim and adds a Kenney body scaled to the hull; `userData.hull` becomes the
  paint mesh so damage crumples it. Doors no longer swing on a carjack.
- **Looks**: `?dusk` (low sun, warm haze); facade grime is TSL in
  `city.js:makeTileable` (bottom 3.5 m + parapet band); far stand-ins over
  45 m carry masts and beacons; manholes and grates on the carriageway rows.
- Vendor kits on disk (GLB + licence only): Kenney car kit, city kits
  commercial / roads / suburban / industrial. Kenney animated characters were
  not downloadable by slug; pedestrians are still the six-part figures.
- **Reactions and radio (2026-09-02, unverified in-browser)**: `game/roadblock.js`
  (3+ stars: two cruisers + spike strip ~170 m ahead, solids via
  `world.parkedByChunk`, strip sets every `wheel.flat = 1`), traffic pulls
  over within 70 m of a live pursuit (`traffic.js` limit/lane), `audio.horn()`
  at near misses, `game/radio.js` (L: three generative stations on the game
  AudioContext; `audio.context()`/`bus()`). `game/people.js`: 16 nearest
  pedestrians are Kenney Blocky Characters with the kit's own clips
  (`?people=N`); yaw offset `+PI/2` is unverified -- if they walk sideways,
  that constant is the fix.
- **Quaternius Realistic Car Pack (CC0, OBJ)** is the fleet's main body set
  (`public/models/vendor/quaternius/cars/`, downloaded from the Drive folder
  with `gdown --folder`). `vendorCars.js:BODIES` registers every body id
  (`q-*` OBJ+MTL with material colours baked to vertex colours, `k-*` Kenney
  GLB with the palette); `KENNEY_CARS` maps traffic styles to ids; the
  garage and the hero skin take ids. Paint = largest non-neutral material
  group; front = side the Front*Wheel objects sit on. Note: mergeGeometries
  needs identical attribute sets -- every part gets a colour attribute.
- **Owner-supplied Sketchfab cars** (`public/models/vendor/sketchfab/`, six
  Chevrolets by Ddiaz Design, simplified to 28k-152k tris and 1k JPEG
  textures by gltf-transform + sharp): `s-*` bodies in `vendorCars.BODIES`,
  worn as a whole textured group (hero/garage only, no paint split, no
  instancing, dents invisible). `front` per body; flip if one drives
  backwards. FIVE ARE CC-BY-NC-SA and all are branded -- dev/personal use
  only, remove before any sale or release (NOTICE.md there).
- **City-wide BatchedMesh is written but dormant** (`Catalogue.attach`,
  gated on `catalogue.multiDraw`). Without multi-draw-indirect three's WebGPU
  backend issues one draw per instance: measured 8,938 draws / 17.9 ms
  against 1,090 / 11.6 ms. It turns itself on the day the device reports
  `chromium-experimental-multi-draw-indirect`.
- **Traffic and pedestrians ride bridges** (`groundHeightAt` / `elevationAt`
  for their y). The hero always did (measured 8.22 m on a 7.6 m deck); the
  fleet and crowd drove through the deck at y=0.
- **The fleet is Kenney's Car Kit (CC0)** -- `world/vendorCars.js` loads
  `public/models/vendor/kenney/cars/*.glb` (+ its external
  `Textures/colormap.png`, which the GLBs reference by relative path) and
  installs them over `assets.geo.stunt[key]` with the same contract as the
  loft (`body`, `glass`, `lodBody`, `occupant`), plus `detail`/`detailMat`.
  `body` is the PAINT: faces clustered by palette CHROMA (the colormap
  shades each hue down a gradient, so exact-colour matching found 30
  faces); `detail` is glass, tyres, trim in the kit palette. Body scaled per
  axis to BODY_TYPES, wheels uniformly and re-seated. Kenney +Z -> our +X,
  verified by a camera placed ahead along a car's MEASURED travel; the
  fleet's brake box had sat on the bonnet since the loft was turned round.
  Taxi and police models are in; the hero car stays the loft (doors, damage).
  Sources under `assets/source/vendor/kenney/` (GLB + licence only; FBX/OBJ
  ignored). Cost at kingsway-corner: ~+60 draws (a detail mesh per body
  style per chunk), triangles flat.
- **Phase 1 shop signs** (`world/signs.js`): one seeded 2048^2 atlas of 64
  fascia boards (512x128 tiles), one node material (`sign_emissive`, colour
  and emissive both sample the atlas via a per-instance `aTile` cell), one
  quad; `dressFacades()` places a board over every ground module and
  districtWorld builds one InstancedMesh per chunk in the facade group.
  Projecting signs, A-frames, hvac units and junction boxes come from the
  kit. +13 draws / +60k tris downtown; chunk build worst 8.1 ms total.
- **Day sky** (`textures.js:texDaySky`): sun disc + glare drawn from
  `DAY_SUN`, stretched 1/cos(elevation) for the equirect dome; eleven sparse
  cumulus clusters; hemisphere 0.55, sun 3.4 warm, fog 0.00017; dome 64x32.

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
- Screenshot-verify visual changes when a browser is allowed. Do not claim a
  visual result you have not seen. Since 2026-09-05 Arun has ruled out
  Playwright for this project: state what is unverified visually and hand him
  a play-test checklist instead; tests and static checks carry the rest.
