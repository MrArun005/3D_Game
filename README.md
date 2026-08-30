# Nightfall Drive

A realistic night drive through a procedurally generated city. Three.js, no
external assets — every mesh and every texture is generated at boot. It is
raining; the grade pass puts droplets on the lens.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
npm run preview
```

**Controls** — `W` throttle · `S` brake/reverse · `A`/`D` steer · `Space`
handbrake · `Shift` hold gear · `C` camera · `H` lights · `R` reset ·
`V` film. Pad: RT/LT analogue pedals, left stick steer, A handbrake, LB
hold gear, Y camera, X lights. Click once to unlock audio.

The engine is a sampled turbo-four: loops baked at six RPM centres, crossfaded
on-load / off-load, with a limiter layer and a turbo bed.

## Cinematic capture

`V` films a 33-second scripted pass and downloads it as WebM; `?film=1` runs it
on load. The car is driven by a pure-pursuit autopilot (`game/autopilot.js`)
following a generated route through the grid, so a take is repeatable rather
than dependent on someone's driving. Shots live in `game/cinematic.js`.

The colour grade (vignette, warm/cool split, grain) is rendered **into** the
canvas by `core/grade.js` rather than sitting over it as CSS, because a canvas
capture cannot see DOM overlays — screenshots and video would otherwise come
out ungraded.

```bash
ffmpeg -i nightfall-drive.webm -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4
```

## Layout

```
src/
  main.js                 wiring + the frame loop
  core/
    renderer.js           renderer, tone mapping, the three lights in the scene
    sky.js                sky dome + the PMREM environment map
    geometry.js           M4, mergeGeos, and the lofting used by the car
    rng.js                seeded PRNG — same seed, same city, every reload
  world/
    metrics.js            every city dimension, and the analytic road test
    textures.js           asphalt, pavement, light pools, sky gradient
    facades.js            glass towers, ribbon offices, residential, retail podiums
    props.js              lamps, signals, trees, shelters, bins, bollards
    assets.js             one-time geometry/material registry
    city.js               the streaming grid of blocks
  vehicle/
    config.js             hull stations, gears, tyre, chassis and spring rates
    model.js              the lofted car, wheels, materials
    dynamics.js           engine, driveline, tyres, weight transfer
  game/
    camera.js  input.js
    traffic.js            path-following cars: lights, queueing, junction turns
    autopilot.js          route building + pure-pursuit driver
    cinematic.js          the shot list
    recorder.js           canvas -> WebM via MediaRecorder  audio.js  engine-samples.js
  ui/
    hud.js                tachometer, minimap, readouts
prototypes/               the single-file sketches this grew out of
```

## How a few things work

**The car is lofted, not boxed.** `vehicle/config.js` holds 24 cross-sections
along the car's length. `core/geometry.js:loft()` stitches consecutive sections
into quads and asks a classifier which bucket each quad belongs to, so bodywork
and glazing fall out of one pass. Two details do most of the work: `yBottom`
lifts over each axle, which is what carves the wheel arches, and `wTop` shrinks
through the cabin, which is the tumblehome that stops a car reading as a box.

**Signals are a pure function of the clock.** `world/signals.js` derives a
junction's phase from its grid coordinates and the time — no per-junction state
to store or keep in sync, and a cell that streams out and back resumes on
exactly the phase it should be on. Traffic and the lamps read the same
`worldTime`, so they cannot disagree.

**A stop line is a constraint, not a target speed.** Braking toward a speed
curve asymptotically still trickles a car over the line at walking pace, and
once the gate is behind it the check stops applying and it bolts across. The
line is enforced as a hard clamp on distance-along-path — but only while the
car is still short of it, or a phase change mid-crossing yanks a committed car
backwards.

**Four rays, not a formula.** Each corner casts down at `groundHeightAt()`,
and its spring compression *is* that tyre's normal load. Dive, squat, roll and
the kick over a kerb all fall out of one model instead of three separate
approximations. Springs alone keep the car level, though — the moment that
actually makes it dive is the tyre force acting at road level with the mass a
`cgH` above it, so that term is added after the tyre loop.

Watch the lateral sign: the tyre model uses a **left-positive** lateral axis
(`vw = v + r * ax`). Writing the suspension as if it were right-positive makes
the car lean *into* corners.

**Tyres have a sliding plateau.** The usual `2B/(1+B²)` slip curve peaks at
B=1 and then decays to *zero*, which lets a spinning wheel escape for ever —
the first build hit 241 rad/s at 3 km/h. Real rubber keeps sliding friction, so
past the peak the curve blends into a plateau at 72% of grip.

**Engine inertia is reflected through the gearbox.** Driven wheels carry
`wheelI + engI·ratio²`, not just their own inertia. Without that term the
engine-braking torque — already multiplied by a ~12.8 first-gear ratio — spins
the rear wheels backwards from a standstill.

**Collision is arithmetic, tested over the whole hull.** "Am I on tarmac?" is
`roadDepth()` in `world/metrics.js`: two modulos and a min. No collision
meshes, exact, and kerb bumps come free. `vehicle/collision.js` samples eight
probe points around the body rather than the centre of gravity — a 4.6m car
resolved from one point buries its nose two metres into a facade first. Parked
cars and traffic are approximated as three circles down their length, which is
orientation-aware and behaves sensibly in a row of parked cars where a single
bounding circle would shove you sideways into the oncoming lane.

**The mesh origin is the centre of gravity.** The hull is modelled from the
nose backward, but the simulation's origin is the CG, so everything visual
hangs off a shell shifted by `CG_X`. Without it the car renders 2.2m ahead of
where the physics thinks it is, and every collision box is wrong.

**The car's nose must point along +X.** The hull is authored with the nose at
x=0 and the tail at +L, so its nose points down −X while the simulation drives
along +X. `buildCar` half-turns the shell, which both faces the car the right
way and lands the centre of gravity on the group origin. Without it the car
drives tail-first with its headlamps 1.9m behind the CG.

**Additive sprites stack.** Anything additive has to be tuned for how many
layers overlap, not how it looks alone. Tyre spray at 0.5 opacity per particle
clipped to white four puffs deep; the ground pool and the headlight beam did the
same on top of a spotlight that was already lighting the road.

**Stacked boxes overlap; they never sit flush.** Two boxes meeting exactly
face-to-face put both surfaces at the same depth, which reads as flashing
walls. Base bands also get a per-building height, because a constant one put
every plinth top at the same y wherever buildings overlapped at a block corner.
An audit over 25 cells took this from 549 fighting faces to 8.

**Facade textures tile per instance.** Box UVs run 0..1 over each face, so a
shared facade texture was stretched over the whole building — a 78m tower with
20m windows. `makeTileable()` injects a per-instance `aUvScale` attribute so the
tile repeats at its real size.

**Street lighting is painted, not lit.** No per-lamp lights anywhere in the
city. Lit windows are baked into each facade's emissive map with a soft halo
behind them, and lamps get an additive ground pool. That is what lets the scene
carry hundreds of buildings at 60fps with only three real lights plus the
headlamps.

**Instanced meshes have culling off, deliberately.** three culls an
`InstancedMesh` by its *geometry's* bounding sphere — a unit box at the cell
origin — not by where the instances are, so a whole block would vanish when that
one point left the frustum. The cell pool is bounded at 25, so disabling culling
is the correct fix rather than merely the convenient one.

## Numbers

~720 draw calls, ~1.8M triangles, 60fps at 1440×860. The budget is spent on
draw calls, not triangles; if that needs to come down, merge the per-archetype
facade instances before touching anything else.

Parked cars are six silhouettes (`BODY_TYPES` in `vehicle/config.js`) coloured
through `InstancedMesh.setColorAt`, so a street of forty mixed cars is one draw
call per silhouette rather than one per paint colour.
