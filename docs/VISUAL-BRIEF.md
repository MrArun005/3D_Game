# Halstead Bay — visual brief

Locked 2026-09-12. The rule the whole art programme serves:

> **Large forms create identity; materials create age; lighting creates mood;
> small props prove human presence.**

Acceptance test for any block: stop the car anywhere in it. You should be able
to name the kind of place, see evidence that people use it, and point at one
memorable architectural feature — **without relying on neon or fog**. Overcast
noon is the test light, not wet night.

## The ten districts

The plan (`public/halstead-bay.district.json`) fixes the names, grids and
boundaries. This table fixes the look. `kind` is the planner's own label.

| District | kind | Grid / street | Building language | Palette | Street character |
|---|---|---|---|---|---|
| **LITTLE TOKYO** (inside Kingsway) | downtown pocket | tight, 56 m blocks | narrow façades, stacked kanban, balconies, alleys | cyan, magenta, warm paper | vending, shutters, cables, stalls |
| **KINGSWAY** | downtown | 112 × 82, 26 m streets | towers with setbacks, lobbies, canopy entrances | cool glass, charcoal, restrained amber | taxis, planters, public art, clean paving |
| **THE FLATS** | retail | 104 × 70, 22 m | long mid-rise retail parades, corner anchors | cream, painted metal, sun-bleached signage | bus stops, trolleys, awnings, delivery bays |
| **VELLERY ROW** | nightlife | 78 × 58, 18 m | narrow party-wall rows over bars and arcades | oxblood, black, hot sign colour | bouncers' rails, A-boards, crates, spilled light |
| **OLD QUARTER** | historic | 56 × 44, **14 m** | brick rows, bay windows, stoops, fire escapes | muted brick, cream, green-grey | bins, bikes, trees, parked cars |
| **MARROW HILL** | residential | 82 × 56, 19 m | brick terraces climbing the hill, gable ends | brick, slate, moss | stoops, wheelie bins, hedges |
| **ASHMOOR** | residential | 96 × 64, 20 m | inter-war semis and small works | cream render, red tile, green-grey | garden walls, vans, corner shops |
| **HARBOUR POINT** | docks | 210 × 126, 30 m | warehouses, loading docks, cranes, pipes | oxidised metal, faded red, concrete | containers, pallets, floodlights, puddles |
| **STEELGATE** | industrial | 186 × 128, 28 m | sheds, gantries, tanks, rail spurs | rust, galvanised grey, hazard yellow | drums, forklifts, chain fence, sodium |
| **NORTHLINE** | rail | 200 × 120, 30 m | viaducts, goods sheds, signal boxes | soot brick, steel, ballast grey | catenary, sleepers, weeds, graffiti |
| **GREENFELL PARK** | park | 168 × 120 | pavilions, bandstand, gate lodges | green, pale stone | paths, benches, trees, railings |

## Landmarks

Every district needs 3–5 forms readable from another district. Status:

| District | Landmarks | State |
|---|---|---|
| LITTLE TOKYO | torii gateway arch, HOTEL NOIR slab, two 24-storey kanban towers, the shrine | **done** (`world/tokyo.js`, `landmarks.js`) |
| KINGSWAY | glass towers to 133 m (9 placed), Halstead Bay Financial lobby block | **partial** — needs one silhouette everyone knows |
| HARBOUR POINT | crane cluster, ferry terminal, grain silo | **missing** |
| STEELGATE | cooling tower / gas holder, flare stack | **missing** |
| NORTHLINE | viaduct run, signal gantry | **partial** (bridges exist) |
| THE FLATS | cinema fly tower, market hall roof | **missing** |
| VELLERY ROW | neon arcade sign over the street | **missing** |
| OLD QUARTER | church spire, clock tower | **missing** |
| MARROW HILL | water tower on the crest | **missing** |
| GREENFELL PARK | bandstand, glasshouse | **missing** |

Rule: a landmark must be visible from ≥ 400 m and must terminate a view down
at least one street.

## Façade kit families (Phase 2)

Modular families, combined under constraints — never one generic building.

1. **Ground-floor shopfronts** — recessed doors, glass, shutters, awnings, signs.
2. **Residential bays** — balconies, window frames, AC units, external stairs.
3. **Commercial modules** — lobby, structural grid, vertical fins, corner glazing.
4. **Industrial modules** — loading doors, corrugated panels, vents, pipes.
5. **Roof modules** — parapets, HVAC, tanks, antennas, stair housings.

Every building must have: a distinct ground floor; a change of plane or
material every 10–12 m; a roof silhouette; a recognisable corner or entrance;
visible wear at close range.

Built so far (`src/world/buildings/`, dispatched by `world/artBuildings.js`):
`warehouse`, `glassTower`, `officeMidrise`, `loft` — 379 placed. These satisfy
all five points. Everything else still comes from `districtWorld.js #massing`,
which is one scaled box plus (since 2026-09-12) belt courses and corner
pilasters. That is the gap the programme closes.

## Materials (Phase 3)

Shared PBR sets, each with albedo variation, normal detail, roughness
variation, AO/cavity, grime masks and edge wear.

| Set | State |
|---|---|
| asphalt, kerb stone | **authored** (`tools/asphalt-textures.py`, 2026-09-05) |
| brick_red | **authored** (running bond, recessed joints, soot, 2026-09-12) |
| concrete, plaster, metal, timber, glass | **placeholder** — still the dot generator; check a texture before blaming a shader |
| road markings, rust, signage | missing as sets |

Decals still to build: repaired asphalt, oil stains, tyre marks, salt streaks,
posters, graffiti, rust under bolts, leaking AC units, runoff under ledges.

The target is **contrast**: clean glass lobby beside dirty pavement, wet road
beside chalky concrete, bright signage on a worn façade.

## Lighting (Phase 5)

Night stays dark. Lifelessness is never fixed by raising exposure.

- Warm lamp pools against cool shadow. (`game/lighting.js`, 6 heads + 4 spots.)
- Shop interiors lit **separately** from their signs.
- A few hero lights per block: a glowing doorway, a laundromat, a floodlight.
- Window states varied: dark, dim, warm, TV-blue, blinds, curtains. Today it is
  a lit fraction with a warm/cool roll — states are missing.
- Bloom only on tiny bright cores. (Threshold is exposure-derived since 09-12.)
- Reflection streaks and puddle highlights selectively.

## Composition (Phase 6)

Low → mid-rise → landmark. A plaza or waterfront after dense streets. Strong
corners at major intersections. Framed views to a landmark, bridge, mountain or
harbour. A mix of lanes, boulevards, service alleys and pedestrian space.
**Every 30–60 s of driving should reveal a new memorable scene.**

## Production order

1. Lock the briefs and the landmark map. ← **this document**
2. Build façade kits for one **hero block**.
3. PBR material library and wear decals.
4. Dress that block with street-life props.
5. Tune day, wet-night and dry-night lighting against it.
6. Capture comparisons.
7. Only then scale across the city.

**Hero block: OLD QUARTER.** Chosen because it is the densest walkable grid in
the plan (61 row blocks on 56 × 44 m plots with 14 m streets), it is the
"residential brick" language in the brief, it already receives the `loft` style
on 50 footprints, and its tight streets make façade detail unavoidable at
driving speed. Bounds roughly x 1044–1907, z 960–1845.
