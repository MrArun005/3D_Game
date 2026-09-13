# Asset brief — how to make an asset that just works

Everything here is measured against this engine, not guessed. Follow the
contract and an asset drops in and renders correctly the first time. Break any
one of the eight rules and it fails in a specific, known way — each one below
has bitten us, and the failure it causes is named.

Companion docs: `ART_BIBLE.md` (look), `BUDGETS.md` (numbers), `PIPELINE.md`
(ingest).

---

## 0. First, the thing everyone gets wrong

**Do not make 4K textures.** The pipeline hard-caps at **2048** and
`tools/ingest.mjs` will reject anything larger (`MAX_TEXTURE = 2048`). The
texture budget is 512 MB total and the initial download budget is 25 MB.

Texture density is set by viewing distance, not by ambition:

| Seen from | Density | Max dimension |
| --- | --- | --- |
| Hero / under 5 m (the car, a shopfront you stand at) | 512 px/m | **2048** |
| Mid / 5–50 m (most of the city) | 256 px/m | **1024** |
| Far / over 50 m | 128 px/m | **512** |

Better still: **the best assets in this project have no textures at all.** The
neon towers and the ten trees ship zero textures and carry their colour in
materials. They load instantly, cost no texture memory, and look right. Prefer
that.

---

## 1. The eight rules

### 1. Material names come from the library. Exactly these 33.

```
concrete_cast  concrete_precast  brick_red      brick_painted
plaster_worn   stone_dressed     glass_curtain  glass_shop
metal_painted  metal_galv        metal_rust     alloy_polished
asphalt        asphalt_wet       pavement_slab  kerb_stone
timber_painted timber_bare       fabric_awning  plastic_signage
car_paint      car_glass         tyre_rubber    chrome_trim
foliage        bark              grass
skin           face_skin         hair           cloth_shirt
cloth_trouser  shoe_leather
```

`catalogue.js` **throws away the glTF's own materials** and re-binds by material
NAME. An unknown name falls through to the asset's declared materials, which
returns the *same* material for every primitive, and then to the last resort:
`concrete_cast`.

> **This is real.** The first vegetation drop was named `bark_ginkgo` /
> `leaf_sakura`. Placed as shipped, every tree in the city would have rendered
> as **grey concrete**. The second drop used `bark` and `foliage` and worked
> immediately.

If a self-contained model must keep its own colours (like the neon towers),
**say so** — it then bypasses the catalogue and gets a bespoke loader instead.

### 2. Origin at the base, centred in XZ

`minY == 0`, and the X/Z centre of the footprint at the origin. Unless it hangs
from something. Every placement matrix in the engine assumes this; get it wrong
and the asset floats or sinks by half its height.

### 3. Real UVs on every primitive

`mergeGeos` zero-fills a missing UV set, which puts every texel of a PBR
material on one point — brick, glass and timber simply never show. All 201 parts
of the original kit shipped without `TEXCOORD_0` and rendered from a single
texel each.

### 4. LODs must actually be simpler — and must match the base

If you ship `foo.lod1.glb`, it must be the *same object* with fewer triangles.

> **This is real.** `bay_modern.lod1` has **more** triangles than its base
> (168 vs 132), different dimensions (2.00 × 1.78 × 0.35 vs 3.62 × 3.60 × 1.36)
> and materials the base doesn't contain. It's a leftover from a different
> asset. Because `districtWorld` dresses at **`lod: 1`**, the game renders the
> stale LOD and the real asset is never seen.

If you can't produce honest LODs, **ship no LOD files at all** — the loader
falls back to lod0 safely (`lods[Math.min(lod, lods.length - 1)]`).

Note: a normal-blind simplifier reduces chamfered geometry by nothing, because
split normals read as borders. Author LODs, or omit them.

### 4b. LOD-vs-base is a *set*, not a file

Regenerate the base and its LODs **together**, from the same run. The only two
facade files that aren't meshopt-compressed are exactly the two whose LODs went
stale — a reliable tell that they were exported separately.

### 5. Triangle budgets (LOD0), enforced by ingest

| Category | Budget |
| --- | --- |
| Facade module | 1800 |
| Small prop (bin, bollard, meter) | 900 |
| Medium prop (shelter, phone box, A-frame) | 2400 |
| Large prop (kiosk, gantry, ferry ramp) | 6000 |
| Vehicle (traffic) | 4000 |
| Vehicle (hero, interior included) | 20000 |
| Character | 12000 |

Tag-driven: `small` → 900, `large` → 6000, `hero` → 20000.

**Draw calls are the scarce resource, not triangles.** Budget is 1400 draws /
4.0 M triangles per frame. A model with 13 materials is 13 draws *per placement*
unless it's merged or instanced — so keep the material count low, or expect it
to be merged.

### 6. One file, one object, +Y up, metres

glTF binary (`.glb`). Real-world scale in metres. Vehicles and characters face
**+X**.

### 7. Chamfer edges, don't smooth-shade boxes

A chamfered box is 44 triangles where a sharp one is 12, and that is the
difference between placeholder and usable. Budget for it.

### 8. Seeded/deterministic variation belongs in code, not in 20 files

Ship one good tree, not five near-identical ones. The engine already varies
scale, yaw and tint per instance.

---

## 2. Where to put it

```
public/models/<category>/<name>.glb        # what ships and loads
assets/source/<category>/<name>/<name>.glb # the authoring source
assets/source/<category>/<name>/tags.json  # e.g. ["bay","commercial","tokyo"]
```

Categories in use: `facade/`, `props/`, `buildings/`, `vegetation/`,
`characters/`, `vendor/`.

Then either register it in `public/models/manifest.json` (catalogue path: gets
instancing, batching, LODs, shadow gating) **or** tell me it's self-contained
and I'll write it a loader (like `tokyoTowers.js` / `treeModels.js`).

---

## 3. Copy-paste prompt template

Use this when asking any generator (a Blender script, Hyper3D/Meshy/Tripo, or
another model) for a new asset. Fill the four brackets.

```
Make a low-poly game asset: [WHAT IT IS].

HARD CONSTRAINTS — the asset is rejected if any of these are wrong:
- Format: single .glb (glTF binary), +Y up, real-world scale in METRES.
- Origin: exactly at the BASE of the object (minY = 0), centred in X and Z.
- Triangles: maximum [BUDGET] at full detail. Chamfer edges; do not
  smooth-shade plain boxes.
- UVs: every primitive must carry a real TEXCOORD_0. Never leave it unset.
- Textures: NONE preferred — carry colour in materials. If a texture is
  genuinely needed, max 1024 px (2048 only if seen from under 5 m),
  power-of-two. Colour maps sRGB; normal/roughness/AO linear.
- Materials: use ONLY these names, spelled exactly:
  [PICK FROM THE 33-NAME LIST ABOVE — e.g. concrete_cast, glass_shop,
   metal_painted, bark, foliage]
  Do not invent a material name or add a species/variant suffix.
  Keep the material COUNT low — each one is a draw call per placement.
- One object. No LOD files unless they are genuinely the same object with
  fewer triangles (a bad LOD is worse than none — the engine draws LOD1).

DIMENSIONS: roughly [W] x [D] x [H] metres.

STYLE: stylised, GTA IV-era geometry under modern lighting. Readable
silhouette first. Detail only where the player gets within 30 m.
```

### Worked example — the trees (this one shipped and works)

```
Make a low-poly game asset: a Japanese cherry (sakura) street tree.
- single .glb, +Y up, metres, origin at the base (minY = 0), centred in XZ
- max 2400 triangles
- real UVs on every primitive
- NO textures
- exactly TWO materials, named `bark` and `foliage` — nothing else
- roughly 8 x 8 x 7 metres
- stylised, readable silhouette, blossom colour in the foliage material
```

That produced 2254 tris, 2 primitives, UVs, `minY 0.00`, materials `bark` +
`foliage` — dropped straight in.

---

## 4. What I'll check when you hand it over

I run this every time, so you don't have to:

1. triangles / primitives / material names per LOD
2. bounding box and `minY` (origin convention)
3. UVs present on every primitive
4. LOD files are the same object and genuinely simpler
5. material names resolve against the library — **or** it needs a bespoke loader
6. manifest registration, and whether anything actually places it
7. draws and triangles in the running game, before and after

---

## 5. Highest-value assets to make next

Ranked by what the city visibly lacks, from this session's frames:

1. **Ground-floor shopfronts for non-Tokyo districts** — Old Quarter, Vellery
   Row and The Flats have bare plinths at street level, which is where the
   camera spends all its time.
2. **A second and third neon tower silhouette** — the four we have are strong;
   the district repeats them.
3. **Road furniture that survived the clean-up**: bus shelter, phone box,
   A-frame — 20 prop rows were stripped for clean roads and the pavements are
   now empty.
4. **A poplar** — the only one of eleven tree species still procedural.
5. **Rooftop clutter as one merged asset** — HVAC bank, tank, stair bulkhead;
   roofs read flat from the drone angle.
