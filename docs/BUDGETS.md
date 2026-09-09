# Budgets

Enforced by `tools/ingest.mjs`. Raising a number here is a deliberate decision
with a stated cost, not a way to make an asset fit.

## Frame budget

| Metric | Budget | Current |
| --- | --- | --- |
| Frame time | 16.6 ms @ 1440x860 | ~16 ms |
| Draw calls | 1400 | ~720 |
| Triangles | 4.0 M | ~1.8 M |
| Texture memory | 512 MB | ~80 MB (uncompressed) |
| Initial download | 25 MB | ~7 MB |
| Real lights (night) | 48 clustered + 2 headlamps | 4 total |
| Shadow-casting lights | 1 sun/moon (4 cascades) + 2 headlamps | 1 |

Draw calls are the scarce resource, not triangles. That was true at 720 and it
stays true at 1400. Anything that adds draw calls has to say how many.

## Per-asset triangle budgets (LOD0)

Raised 2026-08-30 from the blockout numbers (facade 400 / props 900). Every
edge is now chamfered and mouldings are real extruded profiles — a chamfered
box is 44 triangles where a sharp one is 12 — and that is what takes the kit
from placeholder to usable. LOD2 is what the city actually draws at distance,
so the ceilings buy detail up close without costing frame rate.

| Category | Budget | Notes |
| --- | --- | --- |
| Facade module | 1800 | Instanced heavily. Chamfered; LOD2 is ~25% of LOD0. |
| Small prop (bin, bollard, meter) | 900 | |
| Medium prop (shelter, phone box, A-frame) | 2400 | |
| Large prop (kiosk, gantry, ferry ramp) | 6000 | |
| Vehicle (traffic) | 4000 | Wheels separate, not merged into the body. |
| Vehicle (hero) | 20000 | Interior included. |
| Character | 12000 | |

LOD2 is what 90% of the city is drawing at any moment, so it is the number that
actually decides frame rate. Across the 91-asset kit: **31,220 triangles at
LOD0, 10,018 at LOD1, 9,476 at LOD2.**

LODs for generated assets are **authored, not decimated**. Chamfered geometry
has split normals at every edge, so a normal-blind simplifier treats every edge
as a border and reduces nothing — the first attempt produced LOD1 files
identical to LOD0. `tools/genkit.mjs` instead rebuilds each asset with chamfers
off (LOD1) and cylinders coarsened as well (LOD2), and `tools/ingest.mjs` uses
an authored LOD beside the source in preference to simplifying. Hand-authored
Blender assets still go through the simplifier, which is correct for them.

## Texture budgets

| Viewing distance | Density | Max dimension |
| --- | --- | --- |
| Hero / <5 m | 512 px/m | 2048 |
| Mid / 5–50 m | 256 px/m | 1024 |
| Far / >50 m | 128 px/m | 512 |

- All textures power-of-two. All compressed to KTX2 in the shipped build.
- Colour maps `SRGBColorSpace`; normal/roughness/AO `NoColorSpace`.
- Roughness, metalness and AO pack into one RGB texture (ORM) where possible —
  three channels, one sampler, one upload.

## Streaming budgets

| Metric | Budget |
| --- | --- |
| Chunk build time | 2.0 ms per frame (`core/budgets.js:BUILD_MS`) |
| Live chunks | 25 |
| Assets resident | 400 |
| Per-chunk draw calls | 40 |

Chunk building is a resumable generator (`districtWorld.js:#buildSteps`) pumped
by `update()` while the frame has spent less than `BUILD_MS` = 2.0 ms on it;
inside the generator `tick()` yields once 1.8 ms have passed. Worst case per
frame is therefore one slice that ran to ~1.8 ms plus the step that overran it,
then one more `next()` because the pump checks `< 2.0` -- about 3.8 ms plus one
un-yielded step. The F3 overlay judges the per-frame slice ("chunk build") and
the longest single step ("chunk step") against the same constant; `photo.line()`
prints both. A step well above 1.8 ms is a merge that needs a yield point.
