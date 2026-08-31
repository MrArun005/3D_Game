# Wardrobe assets — what to download and where to put it

The cloud sandbox this pipeline runs in can only reach `raw.githubusercontent.com`.
Every good CC0 character pack is hosted somewhere else (`quaternius.com`,
`itch.io`, `kenney.nl`, `poly.pizza`) and all of those are blocked, so the packs
have to be downloaded in a normal browser and dropped here.

Nothing here is modified by the pipeline. Converted output goes to
`assets/source/wardrobe/glb/`, and finished parts to `public/models/avatar/`.

## 1. Quaternius — the wardrobe

**Licence: CC0.** No attribution, commercial use fine.

- <https://quaternius.com/packs/ultimatemodularcharacters.html> — Ultimate Modular Men
- <https://quaternius.com/packs/ultimatemodularwomen.html> — Ultimate Modular Women
- <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html> — more outfits
- <https://quaternius.com/packs/universalbasecharacters.html> — base bodies

Each ships FBX, OBJ, glTF and .blend, plus 24 animations. 11 characters split
into 4 swappable models each.

Unzip into `assets/source/wardrobe/packs/quaternius-<packname>/`. Keep the
pack's own folder structure — `scan.mjs` reads the directory name as a hint
when a filename alone is ambiguous.

Honest caveat: these are low-poly stylised, not GTA-realistic. They give range
immediately; they will not match the RPM heads in style. Expect to pick one look
and commit to it.

## 2. MPFB2 — the parametric human

**Licence: code GPLv3, assets CC0.**

- <https://github.com/makehumancommunity/mpfb2/releases> — grab the release zip
- Community hair / beard / clothing assets: <http://www.makehumancommunity.org/>

Drop the zip at `assets/source/wardrobe/mpfb2/mpfb2.zip` (no need to unzip).

This is the higher ceiling: hundreds of parametric sliders including nose width,
jaw, cheekbones, brow and body proportions — the face-structure control the RPM
rig does not have, because its 63 blendshapes are expressions, not bone
structure. It runs inside the headless Blender step that already exists
(`bpy` 4.5.13 is installed and working).

Not yet verified: that MPFB2 installs and exports cleanly under bpy 4.5.13.
That check is the first thing that happens once the zip is here.

## 3. Then run

```bash
# FBX/OBJ -> GLB (tested: converts a 55k-tri Mixamo FBX, keeps all 165
# animation channels and the 55-bone rig)
python3 tools/avatar/fbx2glb.py assets/source/wardrobe/packs assets/source/wardrobe/glb

# report: slot, triangle budget, rig naming, and how many of our 67 joints match
node tools/avatar/scan.mjs assets/source/wardrobe/glb public/models/avatar/male.glb
```

Paste the `scan.mjs` output back and the binding gets written against real
numbers instead of assumptions. The match column decides the strategy:

| match | strategy |
|---|---|
| 67 exact | bind directly, no work |
| mixamo-prefixed | strip `mixamorig:` and bind — three.js strips the colon itself |
| partial | map by name, rebind the remainder |
| 0 / static | not a humanoid rig; fit by hand or treat as a prop |

## Folder layout

```
assets/source/wardrobe/
  README.md              this file
  packs/                 <- unzip downloaded packs here
    quaternius-men/
    quaternius-women/
  mpfb2/
    mpfb2.zip            <- drop the release zip here
  glb/                   <- fbx2glb.py output (generated, safe to delete)
```
