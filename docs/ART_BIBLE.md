# Art bible — Halstead Bay

The point of this document is that two assets made six months apart look like they
belong in the same game. Every rule here exists so that decisions do not get
re-litigated per asset.

## The look

**Stylised realism, not photoreal.** Forms are simplified and slightly heavier
than life; materials and lighting are physically correct. Think a real city
rendered with 20% fewer, larger shapes. Detail comes from *light, wear and
silhouette*, not from polygon count.

The two anchor moods, and everything must work in both:

- **Night, wet.** The hero mood. Sodium lamps, lit windows, wet tarmac carrying
  reflections, deep shadow between pools of light. High contrast, warm/cool split.
- **Overcast day.** The stress test. Flat ambient light hides nothing —
  proportions, texel density and AO have to carry the frame on their own.

Direct midday sun is *not* a target mood. It flatters nothing we are good at.

## Silhouette rules

- Buildings read at three distances: skyline (mass + crown), street (bay rhythm,
  ground floor), close (materials, wear, signage). An asset that only works at
  one of the three is not finished.
- Break every long horizontal. No unbroken run of facade longer than ~12 m
  without a change of plane, material, or a vertical element.
- Ground floors are always different from what is above them. Taller, glassier,
  dirtier, with signage. This is the single biggest "real city" cue.

## Palette

Halstead Bay is a cool, maritime, slightly worn port city.

| Role | Guidance |
| --- | --- |
| Structure | Desaturated greys, cool concrete, weathered brick, oxidised copper accents |
| Accent | Sodium orange (lamps), harbour red, signage cyan. Used sparingly — accents are *light*, not paint |
| Vegetation | Muted, dusty greens. Never saturated |
| Road | Near-black when wet, mid-grey dry. Never brown |

Rule: **saturation comes from light sources, not from albedo.** A saturated
albedo in a night scene reads as plastic.

## Material library

Every asset uses a material from this list. Do not invent one without adding it here.

```
concrete_cast        concrete_precast     brick_red          brick_painted
plaster_worn         stone_dressed        glass_curtain      glass_shop
metal_painted        metal_galv           metal_rust         alloy_polished
asphalt              asphalt_wet          pavement_slab      kerb_stone
timber_painted       timber_bare          fabric_awning      plastic_signage
sign_emissive        (Phase 1 shop-sign boards: the 64-cell fascia atlas as colour AND emissive,
                      per-instance cell -- world/signs.js. Not a kit material; the ingest never binds it.)
car_paint            car_glass            tyre_rubber        chrome_trim
foliage              bark                 grass
```

Each material has one canonical PBR set (albedo / normal / roughness / AO,
metalness only where actually metal) authored once and shared. **Never author a
one-off texture for a single asset** — extend a library material or add a new
library entry.

## Physical rules

- **Metalness is binary.** It is 0 or it is 1. The mid-values currently in the
  code (`facades.js` glass at 0.16, road at 0.08, tarmac at 0.06) are wrong and
  darken diffuse for no physical reason. Use `envMapIntensity` to buy reflection
  on dielectrics instead.
- **Roughness is where character lives.** Every surface needs a roughness map.
  A uniform roughness scalar is why the road currently reads as either uniformly
  glossy or uniformly matte and never both.
- **Nothing is clean.** Every asset ships with wear: streaking below ledges,
  darkening in corners, scuffing at the base, salt bloom near the water. Uniform
  newness is the loudest tell that a city is generated.
- **Nothing is pure black or pure white** in albedo. Clamp to roughly 0.03–0.85 luminance.

## Scale discipline

- **Texel density: 512 px per metre** for anything the player gets within 5 m of.
  256 px/m for mid-ground, 128 px/m for anything beyond ~50 m. A bin at 2048 px/m
  next to a wall at 128 px/m is more jarring than either being wrong alone.
- Storey height 3.2 m commercial, 2.9 m residential. Door 2.1 m. Kerb 0.14 m.
  Lamp 8 m arterial, 6 m local. These are already implied by the code — keep them.
- Model against a 1.78 m reference figure. Always.

## Free sources we actually use

All CC0 or equivalent, verified free:

- **Poly Haven** — HDRIs, CC0 PBR textures, some models
- **ambientCG** — large CC0 PBR material library
- **Kenney** — CC0 game assets, good for prop blockouts
- **Quaternius** — CC0 low-poly characters and vehicles (already in `public/models/characters/`)
- **Blender** — modelling, UV, baking, LOD decimation
- **Material Maker** — free open-source node-based procedural material authoring
  (the Substance Designer replacement in this pipeline)

Anything from a marketplace with a per-seat or per-title licence does not enter
this repo. If a licence is ambiguous, it does not enter this repo.

## The detail budget, stated honestly

We will not out-model Rockstar. We win on:

1. **Lighting and post** — this carries most of the perceived quality.
2. **Interior mapping** — every window gets fake depth for the cost of a shader.
3. **Modular reuse** — 80 well-made facade modules assembled procedurally beats
   800 mediocre bespoke buildings.
4. **Wear and decals** — a grimy simple asset outreads a clean detailed one.
