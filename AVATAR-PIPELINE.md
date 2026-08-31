# Avatar customiser pipeline

Drop this `3D_Game/` tree over your existing project — the folder layout matches,
so nothing else needs moving. If you only want the code, `tools/avatar/` is
self-contained.

## What's here

| File | What it does | Verified? |
|---|---|---|
| `tools/avatar/wardrobe.mjs` | Generates fitted parts — 5 beards, 3 hair shells, jacket, t-shirt, vest — by selecting a region of the avatar's own mesh and pushing it out along its normals. Skinning, UVs and all 63 blendshapes are inherited per vertex, so a beard moves when the jaw opens. Regions are signed fields, so the shell edge feathers into the skin instead of ending on a triangle boundary. Anatomy is measured per model off the eyeball mesh. | Yes — renders in `assets/renders/` |
| `tools/avatar/avatar.mjs` | Runtime customiser. Slot show/hide, skin tone (repaints the 512px face albedo through a per-channel gain so painted brows and lips survive), hair/beard/eye/outfit tint, all 63 blendshapes by name, bone-scale build. | Yes |
| `tools/avatar/fbx2glb.py` | Converts a folder of FBX/OBJ character packs to GLB via headless Blender (`pip install bpy`). Keeps rig and animation. | Yes — tested on a 55,320-tri Mixamo FBX: 55 bones and all 165 animation channels preserved |
| `tools/avatar/scan.mjs` | Scans a folder of GLBs and reports slot, triangle budget, joint count, naming scheme, and how many of the reference rig's 67 joints match. Run this before writing any binding code. | Yes — correctly reported `mixamo-prefixed`, 55/67 matching |
| `tools/avatar/shapes.mjs` | The 63 blendshape names in primitive order (52 ARKit + 11 Oculus visemes). Needed because one source GLB ships no `extras.targetNames`, so three.js builds no dictionary for it. | Yes |
| `tools/avatar/presets.mjs` | Skin, hair and eye swatches; face and build presets. | Yes |
| `tools/avatar/build.mjs` | Runs the generator over both source avatars. | Yes |
| `tools/avatar/preview.html` | Headless render harness — renders a row of variants per lever. | Yes |

## What is NOT here, and why

`assets/source/wardrobe/packs/` and `assets/source/wardrobe/mpfb2/` are **empty**.
The sandbox that built this can only reach `raw.githubusercontent.com`; every CC0
character pack lives on `quaternius.com`, `itch.io` or `kenney.nl`, all of which
return HTTP 000 through that egress policy. See
`assets/source/wardrobe/README.md` for the two downloads and where they go.

The two source avatar GLBs are also not included — see
`assets/source/avatar/vendor/NOTICE.md`. They are Ready Player Me exports from a
repo with no LICENSE file, one wears branded clothing, and Ready Player Me shut
down on 31 January 2026. They are development fixtures, not shippable assets.

## Known broken

`hair_buzz`, `hair_crop`, `hair_afro` — see `assets/renders/avatar-hair-failed.png`.
The forehead is too coarsely triangulated for a geometric hairline; it comes out
a sawtooth that no amount of feathering hides. Beards get away with it because
the jaw is denser. A buzz cut is a texture, not geometry — the fix is to paint
the hairline into the face albedo using a UV mask the generator can already
derive. Shipped labelled as failed rather than quietly left in.

## Run it

```bash
node tools/avatar/build.mjs                                    # generate the wardrobe
python3 tools/avatar/fbx2glb.py assets/source/wardrobe/packs \
                                assets/source/wardrobe/glb     # convert downloaded packs
node tools/avatar/scan.mjs assets/source/wardrobe/glb          # report what's in them
```
