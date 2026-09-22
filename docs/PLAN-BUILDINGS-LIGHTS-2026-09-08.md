# Buildings and daylight — plan, 2026-09-08

Arun's ask: "change the building, different structure, lights adjust; check
how people work with three.js, 3D models and Blender; plan it and do it."
This is the plan, the research it rests on, and what was done tonight.

## 0. What the frame is made of today (read, not guessed)

| Layer | How it is built | Where |
| --- | --- | --- |
| Massing | Footprint from the district file; `#massing` stacks 1–3 instanced unit boxes per building (forms: slab / setback / podium / wing / terrace / shed / tokyo_walkup), caps and crowns on top | `districtWorld.js:539` |
| Facade surface | A **canvas painting** per kind × 3 variants (glass tower, ribbon office, loft, podium, deck), 512×1024, tiled per instance by `aUvScale`; colour + emissive only — **no normal, no roughness, no AO** | `facades.js`, `city.js:makeTileable` |
| Detail | Ground floor + ONE storey of authored kit modules (22 facade modules, library PBR materials, metre UVs) on the street face only; signs; window quads | `dressing.js:dressFacades` |
| Roofs | Flat slab caps, ~1 clutter item per 45 m², kit railings on 55% | `dressRoofs` |
| Whole kit buildings | Kenney CC0 city kits (x10 scaled, palette texture) at 15–45% in five districts | `kitBuildings.js` |
| Little Tokyo | Own generator: one merged, vertex-coloured mesh per chunk with `emit` | `tokyo.js` |
| Day light | Sun 2.8–3.6 (clock) + hemisphere **0.55** (near-grey sky/ground) + PMREM sky env at **1.15** + fill 0.22; AgX 1.05; GTAO r 0.42; fog 0xb7c9dd @ 0.0004 | `clock.js`, `renderer.js`, `grade.js` |
| Shadows | `GatedCSM` 3 cascades 52 / 156 / 520 m; cascades 1–2 render `SHADOW_FAR_LAYER` only | `renderer.js` |

Why it reads flat and "sad" in daylight, in order of weight:

1. **Upper storeys are paint.** A window is a dark rectangle in the albedo, so
   raking sun cannot pick out a reveal, a sill or a ledge, and glass has the
   same roughness as the wall so it never catches the sky. Every wall above
   storey two is a flat-lit plane.
2. **Fill swamps the sun.** Hemisphere 0.55 + environment 1.15 lights a shaded
   face to within a stop of a sunlit one. The 2026-09-08 exposure A/B proved
   exposure is not the lever (sd 42.8 → 41.9); the lit/shadow ratio is.
3. **No silhouette relief.** Boxes stop at a knife edge; the suburbs have flat
   roofs; period districts have no bays, parapets or plant rooms.
4. **Fog paler than the sky.** 0xb7c9dd (L≈197) against a sky of L≈150 behind
   the mountains, so the range fades toward a colour brighter than the sky.

## 1. Research — how people do this in three.js (sources read tonight)

- **CSMShadowNode** (three r185 `examples/jsm/csm/CSMShadowNode.js`, read in
  full): one `LwLight` + cloned `shadow` per cascade; each cascade camera is
  fitted to its frustum slice in light space, placed `lightMargin` sunward of
  the slice and given `left/right/top/bottom` from the slice diagonal (+ fade
  margin); **near/far are inherited from the sun's shadow camera** (1 / 900
  here). `ShadowNode.updateShadow` keeps a cascade camera's own layer mask
  when it is not layer-0-only (`(mask & 0xFFFFFFFE) !== 0`), so the
  `SHADOW_FAR_LAYER` gate is honoured as designed. The PR that added it
  ([#29610](https://github.com/mrdoob/three.js/pull/29610)) warns that copying
  `.far` from the main light "has significant effect to precision".
  **Offline reproduction** (`scratchpad/csm-fit.mjs`, the same math against
  the `docks` preset at 15:30 and 17:00): every ground receiver from 30 to
  500 m and a 42 m crane top all fall inside their cascade's box and inside
  [near, far] — so neither the fit nor the far plane is why no far shadow
  showed. What the harness did not account for: `docks`/`beach` stand 1.3–1.5
  km from the car, where **no detailed chunk exists** — the far stand-ins
  never cast (`castShadow = false` by design) and the far roads/slabs never
  *received*. The far-shadow "bug" has never actually been observed from a
  camera inside the loaded ring with the sun off the view axis.
- **AgX** ([three.js forum 60609](https://discourse.threejs.org/t/is-agx-tonemapping-implemented-correctly/60609)):
  Don McCurdy — "AgX Base is less saturated than ACES Filmic by design … a
  foundation for colour grading rather than a final preset … you may want to
  bump the contrast." Matches our measured chroma-vs-brightness tables in
  `GTA-VISUALS-RESEARCH.md` §3. Conclusion: contrast has to come from the
  *lighting* (shadow ratio, relief), the grade only trims.
- **Stylised city kits** (Kenney City Kit, KayKit City Builder Bits — both CC0,
  [kaylousberg.itch.io](https://kaylousberg.itch.io/city-builder-bits),
  [poly.pizza Kenney bundle](https://poly.pizza/bundle/City-Kit-0CkvGrBJ0u)):
  the shared trick is one **texture atlas / trim sheet** per kit and
  consistent texel density; realism comes from silhouette (setbacks, roof
  clutter, parapets) plus **normal-mapped reveals**, not polygons.
- **Blender → glTF → three.js** (`docs/PIPELINE.md` is already this: metres,
  origin at base, library material names, `tools/ingest.mjs` weld/LOD/KTX2).
  Poly Haven's CC0 **modular facades** are already in the repo
  (`public/models/vendor/polyhaven/modular_urban_apartments_facade.glb` 38.8k
  tris / 12 images / 10.6 MB; `modular_factory_facade.glb` 49.5k / 15 / 13.8
  MB) and are the right "real 3D model" frontage for hero blocks — but not
  before `optimise-glb` + KTX2: the initial-download budget is 25 MB and we
  ship 7.
- **Procedural windows in the shader / interior mapping** (ART_BIBLE "every
  window gets fake depth for the cost of a shader"): the TSL path exists
  (`makeTileable` already hashes window cells and paints a room), so the next
  step there is a proper interior-cube parallax, not more textures.

## 2. Plan

### Phase A — facade relief (tonight)
Paint a **normal map and an ORM map** alongside every facade/base painting
(`facades.js`): reveals as tilted-normal strips (the way trim-sheet normals
are hand-painted), sills and ledges, glass at roughness 0.10–0.16, walls
0.72–0.78, recess AO 0.66–0.86. Bind them through the tiled UV in
`makeTileable` (`normalNode`, `roughnessNode`, `aoNode`). Metalness → 0
everywhere (ART_BIBLE: binary). **Cost:** 2 more texture samples per facade
pixel, 30 canvas textures of 512×1024×4 (~60 MB of VRAM at 8-bit, no mips
counted) — no draws, no triangles.

### Phase B — different structure (tonight)
In `#massing`: **gable roofs** (new `A.geo.gable` prism, 8 tris, instanced) for
the suburbs and period rows; **projecting bays** on period mid-rises (4–6
boxes in the same facade bucket, capped); **plant rooms** on office slabs;
**parapet lips** round every flat roof (4 thin boxes). New form weights per
district. Pitched buildings skip roof clutter (`pitched` flag →
`dressRoofs`). **Cost:** ~+8–12 instances (~120 tris) per building, zero new
draws.

### Phase C — daylight (tonight)
Sun 3.3–4.2 with colour temperature by elevation; hemisphere 0.40 and
*blue* (0.55, 0.70, 0.92 / 0.48, 0.44, 0.38); environment 0.85; fog colour =
the dome's colour ~10° up (`#93b7de`). Far-city roads and block slabs
`receiveShadow`. New photo preset `tower-west` (inside the loaded ring, sun
perpendicular) for the shadow check.

### Phase D — containers (tonight)
Merge path bakes the per-placement colour into a `color` attribute and
merges tinted items separately under a `vertexColors` clone of the material
(+1 draw per chunk that has containers).

### Phase E — next (not tonight, in order)
1. Interior mapping in `makeTileable` (parallax room cube per window cell).
2. Poly Haven modular facades on hero blocks after `optimise-glb --keep-nodes`
   + KTX2 (`toktx` still missing on this machine).
3. GTAO radius 0.42 → ~0.7 with a measured cost; grade contrast +0.05 only
   after a frame A/B.
4. KayKit City Builder Bits as a second whole-building kit for THE FLATS
   (CC0, glTF, palette-textured) — same loader as Kenney.
5. Blender pass on the 22 facade modules (`docs/PIPELINE.md` authoring loop)
   — bake AO/normal, then delete the generator files.

## 3. Verification rule for this work
Build + `npm test`, then ONE screenshot pass (`kingsway-corner`, `tower-west`,
`docks`) — not a shot per step.

## 4. Second pass the same evening — "both lanes"

Done: **interior mapping** (Phase E.1 above, now shipped in `makeTileable`),
**race jobs**, **repair priced by damage**, and three **reputation perks wired
to real effects** (Guardian Armor, Civic Priority, Street Intimidation). Checked
first and *not* redone: gunfire already scatters the crowd and makes drivers
flee (`main.js` fire path); crowd feet already sit on the pavement
(`FOOT_DROP`); parked cars already come in the six body silhouettes — the
ROADMAP 3.4/3.5 notes on those are stale.

Still open, in order: planar/SSR wet-road reflections; a black market so the
Chop Shop perk pays; Poly Haven modular facades after KTX2; a suburb photo
preset (needs a car teleport) to frame the gable roofs.

## 5. 2026-09-10 — what APEX Heat City taught us

Probed https://apex-city.mindblown.ai/ (three.js WebGL2, ~85 MB, loader stalls at
88%, start button not reachable under automation). Its one real advantage is a
handful of authored assets — it uses Poly Haven's modular tenement facade, the
same CC0 kit sitting in this repo. Taken: the opening menu with mode cards, the
place · time · phase HUD line, and the tenement kit assembled into a real
Old Quarter block (`landmarks.js assembleTenement`). Lesson recorded in
CLAUDE.md: the kit is a parts library, not a wall.
