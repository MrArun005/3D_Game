# Halstead Bay vs GTA — full review, 2026-09-09

Scope: every category a GTA player would judge — visuals, driving feel,
gameplay loop and world simulation, streaming and performance, UI, audio and
presentation, code health and shippability. Benchmark is the project's own
bar ("GTA IV-era geometry under modern lighting", CLAUDE.md) with GTA V called
out where its behaviour is the one players expect.

Method: code read of `main` at `edb7efa` (five parallel deep reads, one per
category), `npm test` (136/136 pass), `npm run build` (clean, one 1.84 MB
JS chunk), and the shipped `dynamics.js`/`collision.js` run in node at the
1/120 step to get real driving numbers. No browser in this session (Arun's
rule), so nothing below is visually verified; every claim carries a
`file:line`, and the headline items were re-read by hand before they went in.
Items already listed as fixed or open in CLAUDE.md are not repeated unless the
code now contradicts the note.

## Verdict

The engine-level work is at or past the bar: a time-sliced streamer with
render bundles, a proper MRT post stack, cascaded sun, glare sprites to the
horizon, a tyre model that produces GTA V sports-sedan straight-line numbers,
and the most GTA-shaped police layer I have seen outside Rockstar. What sits
between the game and "feels like GTA" is not fidelity. It is five seams, each
of which a player hits in the first ten minutes:

1. **The night rig is bolted to a boot flag, not to the clock.** The default
   load rolls into evening with no real lamp light, dark traffic, dark window
   quads, noon exposure and a dry lens. `?night` fixes all of it, which is
   how it has passed play-tests.
2. **The car spins under steering alone at speed, and the handbrake cannot
   slide it.** GTA IV weight, dive and roll are there. GTA V's confidence at
   80 km/h and its whole drift mechanic are not.
3. **Money never matters.** A $50k grant on first load, story missions that
   replay forever for up to $60k, safehouses that wipe five stars for free.
   The police are a superb toy with no stake behind them.
4. **Every particle except the glare sprites is one pixel.** WebGPU draws
   `THREE.Points` at 1 px (recorded in CLAUDE.md for rain); it applies equally
   to smoke, sparks, tyre smoke, fire, blood, steam and spray.
5. **Presentation is a feature showcase.** Forty-five key bindings on the
   title card, four onboarding systems at once, a dev "record demo" card in
   the phone, no pause menu, three different game names, and HUD elements
   drawn underneath the minimap.

Then a hard blocker for anything public: 75 MB of CC-BY-NC-SA and
trademarked Sketchfab content plus 22 MB of Ready-Player-Me-derived avatars
ship in `public/` and are copied into `dist/`. Three landmark props have no
licence record at all.

## Scorecard

| Category | vs GTA IV | vs GTA V | One line |
|---|---|---|---|
| Post stack, night look | at bar | near | GTAO + emissive bloom + CSM + glare; env map and sky are the gap |
| Sky, sun, time of day | below | below | painted noon sun never sets; night rig gated on `?night` |
| Materials, facades | at bar | below | facades albedo-only, no normal/roughness; Tokyo and signs exemplary |
| VFX / particles | below | below | 1 px points everywhere but glare |
| Driving: straight line | at bar | at bar | 0-100 6.77 s, 189 km/h, 1.0 g stop |
| Driving: cornering, slides | below | below | ~0.65 g then spin; handbrake grips harder |
| Collision feel | below | below | 0.88 velocity scalar per probe per step: walls are sticky |
| Camera | near | near | correct lag/FOV maths; welded to yaw, `rig.fov` dead |
| Police / wanted | at bar | near | witnesses, LOS evasion, PIT, roadblocks, heli, marksmen |
| Traffic / crowd | near | below | signals, headway, pull-over; no death, no ragdoll, no reactions to gunfire |
| Economy / missions | far below | far below | $50k grant, no fail state, replayable payouts |
| Streaming / perf | at bar | near | 2 ms sliced builds; a few un-yielded merges and two async races |
| HUD / minimap / map | near | near | minimap is GTA-grade; layout collisions and dead phone GPS |
| Menus / onboarding / settings | far below | far below | no pause, no settings, URL flags only |
| Audio | near | below | procedural but thoughtful; no footsteps, mute leaves voices talking |
| Shippability | blocked | blocked | licences, bundle size, no third-party notice |

## Top 12, ranked by how fast a player hits it

| # | What | Evidence | Fix | Effort |
|---|---|---|---|---|
| 1 | Night rig gated on boot flag | `main.js:89` `DAY = !has('night')`; `:1056` LightPool only `if (!DAY)`; `:1289` traffic headlamps `!DAY`; `:162` `windowQuad.emissiveIntensity = 0` never restored by `clock.js:141-166`; `:2123` lens drops `DAY ? 0`; `:2264` rain audio `DAY ? 0 : 1`; exposure 1.15 only in `?night` (`:146`) | always build LightPool and headlamps, scale by `nightFactor`; add `windowQuad` + `base.materials` to the clock stagger; drive exposure/drops/rain from clock + weather; make `?night` = `startHour 19.5` | half day |
| 2 | Car spins under steering at speed | node sim: coast + full lock at 80 km/h spins 179° in 2 s; peak lateral ~0.65 g; `config.js:211` equal `muPeak` front/rear, `dynamics.js:273-275` post-peak cliff to 0.72 | rear μ ×1.08, plateau 0.72 → 0.82, blend `/4` → `/6`, mild yaw-rate stability term | half day |
| 3 | Sticky walls | `collision.js:113-114` `v *= 0.88` per probe hit, ≤3 passes, 120 Hz; `:64` 0.86 for buildings; a 6° scrape at 60 km/h stops in 0.05 s and sits under the 1.8 dent threshold (`damage.js:210`) | damp normal only, tangential friction ∝ `into` | 1 h |
| 4 | Handbrake grips instead of slides | `dynamics.js:453-457` lateral force ignores locked longitudinal slip; 15° body slip with handbrake vs 54° without | scale `Fc` by `1/(1+|slipRatio|)` when locked; cut rear torque while `hand > 0.5` | 2 h |
| 5 | $50k grant + free economy | `jobs.js:33-38`; garage max $14k (`garage.js:208-227`); story pays $7.5k-60k and replays (`storyMissions.js:338-384`); safehouse wipes any wanted level every 8 s (`reputation.js:237-244`) | grant behind `?debug`, start $500; persist `hb.story`; gate safehouse on `wanted < 3 && coldFor > 5` | 2 h |
| 6 | Missions never fail | `main.js:394-446` WASTED/BUSTED stop jobs but never `story.abandon()` | call it; add retry prompt | 30 min |
| 7 | Police cruise speed inherited from spawn road | `traffic.js:162` sets 26-31 m/s, then `#spawnGraph` `:496` overwrites with `CLASS_SPEED[e.class]` (10.5 m/s on a street); `:1335` uses it. A 3★ chase can top out at 38 km/h | `if (!car.hunt)` around `:496` | 5 min |
| 8 | All VFX are 1 px | `puffs.js:31`, `vfx.js:103-111,147-155`, `damage.js:109,159`, `weapon.js:80,116`, `streetLife.js:67,154,183`, `puddles.js:127`, `breakables.js:391` all `THREE.Points` | one `InstancedSpritePool` built like `glare.js:buildGlare`; port pools | 2 days |
| 9 | Sun disc never sets, env map is noon forever | `textures.js:180-260` disc at fixed elevation, `clock.js:106` only yaws the dome; `sky.js:38` one PMREM at boot, `clock.js:101` only scales intensity | TSL sky material from `sunDir` + `night` uniforms; 4 cached PMREMs per phase | 1 day |
| 10 | No pause menu, dev tools in the phone | Esc only closes chat (`input.js:117`); `phone.js:242-280` "TEST GRANT", "RECORD FULL FEATURE DEMO"; `O` records WebM, `T` skips 3 h (`input.js:148-149`) | Esc → pause with Controls/Settings/Map; gate dev cards on `?debug` | half day |
| 11 | Phone GPS buttons dead | `phone.js:302-313,339-348` call `window.hud` / `window.__setWaypoint`; neither is assigned anywhere in `src/` (grepped) | assign both next to `main.js:1311` | 5 min |
| 12 | Async emit race leaks on chunk release | `districtWorld.js:1519-1533` fire-and-forget `emit()`; release `:505-528` and abandon `:420-437` can run first; merged mesh (`catalogue.js:430` owned) then lands in a dead group, `onBreakables` registers a dropped key (`breakables.js:99,138`) | build token / `group.userData.dead` check inside `emit()` | 2 h |

---

## 1. Visuals and rendering

**Strengths.** Post stack order and colour spaces are right (`grade.js:99-146`);
CSM with layer-gated far cascades (`renderer.js:26-46,157-160`); glare sprites
are the GTA V "underestimated glow" trick done properly (`glare.js:47-83`);
window life is computed from `(cell, instanceIndex)` in TSL with no texture
(`city.js:makeTileable`); Tokyo neon and the sign material are the reference
implementations for pinned `materialReference` (`tokyo.js:383-399`,
`signs.js:160-180`); car paint is a clearcoat physical material
(`model.js:133-136`); wet road drives roughness, env and normalScale from
`car.wet` (`main.js:2116`).

**Gaps beyond the top 12.**
- No height fog or aerial perspective: `FogExp2` one colour (`renderer.js:172`).
  r185 supports `scene.fogNode`; mix toward the sky colour in the view
  direction with an `exp(-y*k)` height term. Half a day.
- Facades are albedo + emissive only (`facades.js:255-270`). Derive a normal
  map from the painted facade the way `textures.js:normalFromCanvas` does for
  tarmac, plus a roughness canvas. ~8 MB VRAM, 2 hours.
- `?night` uses a separate two-light rig with an 80 m shadow box and no CSM
  (`renderer.js:182-207`). Dies with item 1.
- Speed lines are a DOM canvas overlay (`vfx.js:236-244`); the grade already
  has `uSpeed` (`grade.js:82`). Captures miss them.
- Vegetation: kit lod1 Lambert, no wind, no card LOD; mountains flat-shaded
  Lambert with day colours baked (`surrounds.js:102`). Lowest priority.

**Bugs.**
- "Chromatic aberration" is a per-pixel tint, not a UV offset
  (`grade.js:183-185`).
- Header says ACES, renderer is AgX (`grade.js:19` vs `renderer.js:57`).
- `clock.js:179` rolls weather with `Math.random()` into `this.weather`, which
  nothing reads. Dead and unseeded.
- LightPool fade-out never happens: `lighting.js:169` fades in only,
  `slot.from` never read. Hand-offs pop.
- LightPool coronas (`lighting.js:49-58`) duplicate the glare sprites at the
  same heads, without `glow()`. Six draws for nothing.
- Hero underglow plane + cyan `PointLight` is always on, day and night
  (`vfx.js:159-192,363-367`).
- `additive()` guards only `isPointsMaterial` (`additive.js:15`); the lens
  glare `SpriteMaterial` (`main.js:1250`) writes normals additively, the exact
  rain-speckle mechanism. Use `glow()`.
- More textures bypass `toTex()` than the "four files": `vfx.js:146,177`,
  `main.js:1230`, `puddles.js:49`, `streetLife.js:57`, `billboards.js:229`,
  `airspace.js:97`; anisotropy hard-coded in `assets.js:62`,
  `vendorCars.js:281`, `kitBuildings.js:128-149`.
- `renderer.js:105-107` `autoResolution` is a stub under a comment describing
  a working system; `main.js:110` still calls it.

## 2. Driving feel and vehicles

Numbers from the shipped model in node (legacy grid road, 1/120 step):

| Measure | Value | GTA V sports sedan |
|---|---|---|
| 0-60 km/h | 3.65 s | similar |
| 0-100 km/h | 6.77 s | similar (CLAUDE.md still says 7.89) |
| Top speed | 189 km/h in 5th; 6th never reached (`config.js:238`) | similar |
| 100-0 | 44.2 m, 1.01 g peak, fronts locked 49% of the stop | ABS-like in GTA |
| Steering lock | 28.5° at 30 km/h, 18.8° at 80, 11.0° at 120 (`dynamics.js:317`) | similar |
| Peak lateral before rear lets go | ~0.65 g | 0.9-1.1 g |
| Handbrake at 60 km/h | 15° body slip (54° without it) | the drift mechanic |

**Strengths.** Load transfer from spring compression with anti-roll bars
(`dynamics.js:361-386,491-492`), tyre plateau and friction ellipse
(`:269-276,456-457`), converter flare (`:392-402`), low-speed kinematic blend
(`:518-522`), smoothstepped kerbs (`metrics.js:535-545`), hull collision
plumbed to dents and sparks (`collision.js:101-116`, `damage.js:209-226`),
damage felt through torque and grip (`damage.js:293`, `dynamics.js:343,426`),
frame-rate-independent camera lag and speed FOV (`camera.js:80,110-116`),
analogue pad path (`input.js:7-52`), sampled engine audio with load split.

**Gaps beyond the top 12.**
- One handling class: `BODY_TYPES` carries mass/torque/grip
  (`config.js:146-181`) but `stepVehicle` reads only the singleton
  (`dynamics.js:389,437,448`). A stolen van drives like the sedan. Half a day.
- Front brake torque 3255 Nm/wheel exceeds the ~1600-2200 Nm tyre cap
  (`config.js:220`, `dynamics.js:461`); the comment at `config.js:216-219`
  claiming otherwise is wrong. Clamp `bt` to `mu*Fz*R*1.1`. 30 min.
- Surfaces are tarmac / pavement / off only (`metrics.js:521-526`); beach
  sand is lawn grip.
- Shifts never cut torque (`dynamics.js:409-414`). 15 min.
- Camera welded to `car.yaw` (`camera.js:46-47,73-76`); GTA blends toward
  velocity heading in a slide. 1 hour.
- Tank has no building collision (`tank.js:181-203`).
- Helicopter bindings clash: Shift = descend and NOS, C = descend and camera,
  E = strafe and fire, Q = strafe and look-back (`flight.js:404-415`,
  `input.js:430,443,477-479`).
- Landmarks have no collision (`landmarks.js:10` says so).

**Bugs.**
- Physics accumulator never clamped: `dt` capped at 0.05 (`main.js:1711`) so
  the `> 0.05` guard at `:1791` is dead; `guard < 4` at `:1795` consumes
  ≤33 ms per frame, so below 30 fps the accumulator grows and then
  fast-forwards.
- Anti-Ackermann sign: `1 + az*0.1` (`dynamics.js:443`) steers the inner wheel
  less.
- `rig.fov` declared everywhere, `camera.js:111-112` hard-codes 62.
- Driver sits at +z (`model.js:115,263`) but carjack and exit use `doorFR` at
  −z (`config.js:28`, `main.js:801,896`, `onfoot.js:197-199`).
- `tank.js:325-328,350-351` writes `car.vx/vz/health/explode`; traffic cars
  have `speed` and `vhp`. Only the squash does anything.
- `flightUpdate` (`main.js:748-782`) is never called; `helicopter.js:378-405`
  and `flight.js:648-692` are the same fuselage twice.
- `car.airborne`, `car.offRoad` computed (`dynamics.js:346,386`), read nowhere.
- `vehicle.test.js:23-55` tests `CarVehicle.update`, which `main.js` never
  calls. Nothing asserts steer curve, braking distance or spin threshold.
- Two pads sum their steer before the clamp (`input.js:62`).

## 3. Gameplay and world simulation

**Strengths.** Witnessed crime (`policeAi.js:194-200`, `main.js:884`);
zero-star patrol with its own NPC pursuits and pull-overs
(`traffic.js:1053-1097`); LOS-based evasion with a search ring
(`policeAi.js:175-184`, `traffic.js:882-905,1307-1312`); the escalation
ladder from arrest-first at 1★ to sniper and door gunner at 5★
(`policeAi.js:207-209`, `traffic.js:771-851,1128-1158`, `roadblock.js:471`);
fleet-level arrest needing two officers for 5.5 s (`traffic.js:1025-1034`);
one firing path for every police round (`traffic.js:740-763`); gate-based
stop lines, headway, overtaking, rain slowdown, stuck-horn
(`traffic.js:932-1407`); kerb wave off the real signal phase
(`crowd.js:174-185`); pure, tested AI core.

**Gaps beyond the top 12.**
- Cruisers pop: `traffic.js:1041` hides any surplus cruiser the frame stars
  drop; respawn anywhere 55-260 m including in front of the camera (`:488`).
  Recycle only when `gap > 120` and behind the camera; let surplus cars switch
  `hunt=false` and drive off. 1 hour.
- No pursuit routing: greedy descent with stale-reset (`traffic.js:1107-1117`)
  while `navigation.js:474-523` already has Dijkstra. 1-2 hours.
- Pedestrians never die, never fight back, no ragdoll, no barks beyond
  `onNear` (`crowd.js:156-160`, `main.js:603,806-813`). 2 hours for `p.dead`,
  a fight-back roll and panic chatter.
- Jobs do not require the stop the HUD demands (`jobs.js:116,142` vs
  `mission.js:192-194`); getaway "starts hot at 2★" actually yields 1.04★
  (`jobs.js:11`, `traffic.js:111`).
- Traffic never reacts to gunfire or swerves; police in road mode always run
  reds (`traffic.js:141-151`).
- Clock and weather barely touch the sim: same crowd at 03:00.
- `heist_1` promises a Camaro that is never spawned (`storyMissions.js:230-242`).
- Reputation perks are labels: only the ≥80 bounty licence is consumed
  (`reputation.js:178-204`, `jobs.js:166`).
- Multiplayer is position-only; police are not identical across peers despite
  `multiplayer.js:183-185`.

**Bugs.**
- Kerb-lane pull-over is a no-op: `car.edge?.lanes` where `car.edge` is an
  index (`traffic.js:968`; `:1396` does it right).
- Fresh 1★ officers fire for their first 8 s: `quietFor` starts at 0
  (`traffic.js:238`, not reset at `:1153`) and `shouldFire` is `quietFor < 8`
  (`policeAi.js:208`).
- Helicopter locks up after its first landing: nothing clears `landing` when
  `want` returns (`helicopter.js:268-301`).
- Intel scanner filters traffic on `c.active`, `c.role`, `c.vx` which do not
  exist (`intel.js:450-466`). Section unreachable.
- Near pedestrians test `p.waitingNow`, never set; crowd uses `kerbWait`
  (`people.js:340`, `crowd.js:178`).
- `garage.js:33` `JSON.parse(localStorage 'hb.garage')` with no try/catch
  inside the district `.then` (`main.js:1093`): a corrupt value kills garage,
  phone and story setup. `jobs.js:31` `Number()` can yield NaN cash, and
  `spendCash` (`garage.js:293`) then never fails.
- Pay 'n' Spray priced twice: $150 via `garage.act` with the 3★ gate
  (`garage.js:228,316-321`), $500 via `payAndSpray` with no gate (`:373-386`).
- Vigilante pays $400 for the patrol's pull-over (`main.js:1916-1917`,
  `traffic.js:1080`).
- `needDowned` counts any officer anywhere (`storyMissions.js:405`, `main.js:711`).
- Double damage on officers: `hitAny || hitPost` at `main.js:711`; `hitAny`
  returns false on a non-downing hit (`traffic.js:725-732`) so `hitPost`
  (`roadblock.js:413`) decrements the same `hp` again.

## 4. Streaming, performance, code health

**Strengths.** Chunk builds are a resumable generator pumped for
`BUILD_MS = 2.0` (`districtWorld.js:27,371-405`) with distance-and-velocity
priority (`:330-357`) and the group added only at the last step (`:1746`):
the 2026-08-31 "37-76 ms synchronous" finding is obsolete. Abandoned builds
are torn down (`:420-437`); disposal is scoped to owned geometry
(`:511-523`); bundle invariants are enforced at every late-landing site
(`:1509-1518`, `catalogue.js:437-438`); far city is five draws with
hysteresis (`:171-329`); boot is defensive (`main.js:100,131,2220`).

**Gaps.**
- Un-yielded merges inside the budget: Tokyo merge (`:1551`), kit merge
  (`:1565`), `roundedSlab` extrusions (`:1599-1632`), `#streetFurniture` and
  `#signals` as single steps (`:1338-1340`). `tick()` yields at 1.8 ms and the
  pump checks `< 2.0`, so worst case is ~3.8 ms plus one un-yielded step.
  Three budget constants disagree: code 2.0, `stats.js:22` 3, `BUDGETS.md:68` 4.
- `InstanceBatch.emit` merges every placement of a material in one macrotask
  (`catalogue.js:451-453`), invisible to `worstChunkMs`.
- Initial load: 1.84 MB single chunk, no `manualChunks` (`vite.config.js:36`);
  `renderer.init()` → `loadVendorCars()` → district fetch run serially
  (`main.js:109,131,1043`); the legacy `City` builds a grid that is thrown
  away (`main.js:1050,1679`); 99 PNG textures, 0 KTX2; `public/` is 175 MB.
- LOD is binary at ring edges (`:463,471,483-484`); no lod2 ring.
- Frame budget (1400 draws / 4.0 M tris) is displayed, never asserted.

**Bugs.**
- Abandon sweep forgets `headsByChunk` (`:430-432` vs `:1456`); LightPool can
  rank real lights onto heads of a chunk that never landed.
- `nearbyParked()` cache keyed on player chunk only (`:1829-1845`); goes stale
  on chunk landing, release and `takeParked` (`:1808`). `traffic.js:1199`
  uses it for LOS.
- Boot grid removed without `releaseCell` (`main.js:1050-1051`, `city.js:134`).
- Frame catch logs only the first error (`main.js:1692`); a throw before
  `world.update` (`:2131`) freezes streaming while the last state keeps
  rendering, with no HUD sign after 2.5 s.
- `new URLSearchParams` inside per-footprint loops (`:1250,1281,1315`).

**Code health.**
- `main.js` is 2383 lines, 84 imports, a 115-line district-landing callback
  (`:1043-1158`). Split: `boot.js`, `worldLoad.js`, `debugApi.js`,
  `persistence.js` (13 keys in two naming schemes), `frameLoop.js` with an
  ordered `systems[]` so a throw names the system.
- Test gaps: `districtWorld.js`, `catalogue.js`, `dressing.js`, `traffic.js`,
  `metrics.js` have no tests. Highest value: build/release a ring against a
  stub scene and assert every registry is empty and every owned geometry
  disposed; replay `dressing.js` over the district file and assert zero
  tarmac offenders (the 2026-08-31 audit as a test).
- Dead code: `world/city.js` streamer (571 lines, runs once at boot);
  `autoResolution` stub; orphan doc comment `districtWorld.js:1750-1756`;
  `save.js` imported by nothing; `character.js` hit/punch clips.
- `index.html` HUD card lists `O record tour`, `J multiplayer`, and misses
  `I horn` and `6 sniper`.

**Release blockers.**
- `public/models/vendor/sketchfab/*.glb`: five bodies CC-BY-NC-SA-4.0, all
  Chevrolet-branded (its own NOTICE.md says remove before release). The three
  landmark props `gun-shop`, `supermarket`, `street-set` and `building-pack`,
  `city-street`, `gun` under `props/` have **no NOTICE.md at all**
  (46 MB; loaded by `landmarks.js:12`).
- `public/models/avatar/*.wardrobe.glb` (22 MB) derive from the unlicensed
  RPM exports (`assets/source/avatar/vendor/NOTICE.md`: "Do not ship").
- No top-level `THIRD_PARTY.md`; `package.json` has no `license`.
- CLAUDE.md says the deploy is Vercel; `PLAYTEST-2026-09-05.md` says
  Cloudflare Workers. One of them is stale.

## 5. UI, audio, presentation

**Strengths.** Static-HTML boot with phased progress and a 12 s cap
(`index.html:14-30`, `main.js:100-132`); minimap with batched real segments,
GPS route, LOS-pulsing police blips, search ring, clock
(`hud.js:160-238,856-906`); big map with cached base layer and
click-to-waypoint (`hud.js:129-358`); tasteful speechSynthesis with `?novoice`
(`chatter.js:149-196`); per-weapon gunshot voice with city echo, crunch not
boom crashes, heartbeat (`audio.js:136-240,376-388`); XSS-safe chat
(`chat.js:196-257`); idle orbit cinematic (`main.js:2053-2065`); pad with
deadzone curve and rumble (`input.js:55-84`).

**Gaps beyond the top 12.**
- Onboarding is four systems at once: title card with ~45 `<kbd>`
  (`index.html:45-63`), timed tutorial line whose clock starts before the
  card is dismissed (`hud.js:731-740`), prompt bar (`hud.js:76-82`), chat
  welcome (`chat.js:21`), $50k toast (`jobs.js:54`). Replace with one
  state-keyed hint system remembered in `hb.hints`. 3-4 hours.
- No weapon wheel; no pad path to phone, map, radio, weapon select, photo,
  horn, reload, crouch (`input.js:60-77,153-160`).
- HUD collisions: `#wanted` (`hud.js:751`) and health (`:512`) fall inside the
  minimap rectangle (`style.css:24`) with no z-index; phone button sits on
  the tacho (`phone.js:101`); ammo at 190 px overlaps the 230 px dial
  (`hud.js:491`).
- No settings or quality UI; everything is URL flags (`main.js:121-127`).
- Zero accessibility: 10-13 px HUD text, red/blue-only blips, no remapping.
- No touch input anywhere in `src/`.
- Radio has no wheel or track info (`radio.js:58-81`); station not persisted.
- Death is flat text plus a black cut (`hud.js:596-629`); `uSat` exists for a
  GTA-style desaturate.
- Photo/film modes hide only part of the HUD (`index.html:10`, `style.css:12`).
- Three names: Nightfall Drive (`index.html:7`), HALSTEAD BAY (`hud.js:345`),
  Nightfall 3D (`featureTour.js:6,256`).

**Bugs.**
- `hud.js:76-82` rebuilds `promptBar.innerHTML` every frame; `#drawMission`
  sets `textContent` every frame (`:742`).
- Frame-locked timers `#tickWedges(1/60)` (`:111`) and `_coldFor += 1/60`
  (`:760`): evading grey-out is 1.5 s at 120 Hz.
- `hud.flash()` mirrors every toast into chat, routed by substring
  (`hud.js:528-536`).
- `U` mutes the master gain only; speechSynthesis keeps talking
  (`audio.js:496-499`, `main.js:1615`).
- `radio.cycle()` creates a GainNode per change and never disconnects the
  old one (`radio.js:61-65`).
- Shared `speechSynthesis.cancel()`: a DJ bumper cuts an officer's shout
  (`radio.js:74`, `chatter.js:191`).
- `L` as the first key pressed reports "CLICK THE GAME FIRST" because the
  `keydown once` start handler runs after the input handler
  (`main.js:1391-1399`, `radio.js:63`).
- Key collisions: `Z` intel scanner and photo up (`input.js:161`,
  `photo.js:121`); `Enter`/`Y` open chat and fire photo `shot()`
  (`input.js:121`, `photo.js:48`), so Enter in photo mode focuses the chat
  and WASD types; `Shift` gear hold + NOS + heli descend (`input.js:179-180`).
- No footstep audio exists; no UI confirm sounds beyond cash/click.

## Quick wins (each under an hour, all verified by reading)

1. `traffic.js:496`: keep police cruise with `if (!car.hunt)`.
2. `traffic.js:968`: `this.E[car.edge]?.lanes`.
3. `traffic.js:1153`: `c.quietFor = 999` on deploy.
4. `helicopter.js:268`: clear `landing/landed` when `want` returns.
5. `main.js` ~1311: `window.hud = hud; window.__setWaypoint = ...`.
6. `garage.js:33`: try/catch; `Number.isFinite` guard on `hb.cash`.
7. `main.js:394-446`: `story?.abandon()` in `onDeath` and `onBust`.
8. `jobs.js:33-38`: grant behind `?debug`; start $500.
9. `reputation.js:241`: gate on `wanted < 3 && coldFor > 5`.
10. `main.js:711`: explicit officer-vs-post branch instead of `||`.
11. `clock.js` after 148: light `windowQuad` and `base.materials` by
    `nightFactor`; `renderer.toneMappingExposure = 1 + 0.15*nightFactor`.
12. `main.js:1056`: always build LightPool, scale intensity by `nightFactor`.
13. `main.js:2123`: `setDrops(weather.amount * ...)`; `:2264` rain audio from
    weather.
14. Delete the six LightPool coronas (`lighting.js:31-58,171-180`).
15. `main.js:1250`: lens glare through `glow()` not `additive()`.
16. `vfx.js:33`: gate underglow on a garage flag.
17. `collision.js:113-114,64`: tangential friction ∝ `into` instead of the
    0.88 / 0.86 scalar.
18. `dynamics.js:461`: clamp brake torque to `mu*Fz*R*1.1`.
19. `dynamics.js:273-274`: plateau 0.82, blend `/6`; `config.js:211`
    `Cr 15.5`, `muPeak` front 1.36 / rear 1.48.
20. `dynamics.js:426`: torque cut for the first 0.25 s of `gearTimer`.
21. `main.js:1791`: `physicsAccumulator = min(acc, STEP*6)` after the loop.
22. `camera.js:111`: use `rig.fov`; rig 0 `lag 3.4 → 2.4`.
23. `districtWorld.js:430-432`: add `headsByChunk` to the abandon sweep.
24. `main.js:1050`: `releaseCell` for the boot grid.
25. Hoist the three `URLSearchParams` in `#buildSteps` to module constants.
26. One exported `BUILD_MS` for code, `stats.js` and `BUDGETS.md`.
27. `phone.js:242-280`, `input.js:148-149`: dev cards and `O`/`T` behind `?debug`.
28. `hud.js:751,512`: stars and health to `bottom:240px; z-index:21`; remove
    `#phone-btn`.
29. `input.js:121`: guard chat-open on `!photo.on`; drop `KeyY`.
30. `hud.flash('MUTED')`, skip `#speak` when muted, persist `hb.muted`.
31. Add a `.vercelignore` for `sketchfab/` and `avatar/` until licences are
    resolved; write `THIRD_PARTY.md`; add `license` to `package.json`.
32. Pick one game name.

## Play-test checklist (nothing above was seen in a browser)

- Default load, `/time 21`: do lamp heads light the pavement? Do traffic cars
  have headlamps? Are window quads lit? Expected today: no, no, no.
- Default load at 21:00 in a rain spell: drops on the lens? Expected: no.
- `/time 19`: where is the sun disc relative to the long shadows? Expected:
  disc high, shadows long.
- Crash into a bollard: are the sparks anything but single pixels?
- Noon: cyan glow under the hero car?
- 3★ chase starting on a side street: do cruisers keep up above 40 km/h?
- Pull the handbrake at 60 km/h mid-corner: does the rear step out?
- Scrape a facade at 60 km/h at a shallow angle: dead stop or a grind?
- Phone → SERVICES → Tokyo GPS: does a route appear? Expected: nothing.
- Stand in the minimap's corner: are the stars and health bar hidden behind it?
- Press U then let a cruiser find you: does dispatch still speak?

## Proposed order of attack

1. **Unify the clock and the night rig** (top-12 #1). Half a day, and it
   makes every night feature already built visible to the default player.
2. **Driving balance pass** (#2, #3, #4, brake clamp, accumulator clamp) with
   the node sim as the regression harness. One day. Add the four numbers
   (steer curve, 100-0 distance, spin threshold, handbrake slip) as tests.
3. **Economy and mission state** (#5, #6, #7 and the gameplay quick wins).
   One day. This turns the police from a toy into a stake.
4. **Presentation shell**: pause menu, one onboarding system, dev tools behind
   `?debug`, HUD stacking, one name. One day.
5. **Sprite particle pool** and port the VFX (#8). Two days.
6. **Sky material + per-phase PMREM + fog node** (#9). One to two days.
7. **Licence clean-up and load path** before anything public.
