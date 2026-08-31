# tools/blender

Blender runs **headless as a pip module** — `pip install bpy` — so there is no
GUI and no separate binary. Run the script with `python3`, not with Blender.

```bash
pip install bpy==4.5.13          # once
npm run genchar -- --cage        # JS emits the quad cage
python3 tools/blender/build.py   # Blender subdivides, rigs, weights, exports
npm run ingest
```

## Why go through Blender at all

Three things Blender does far better than hand-rolled code, and each fixed a
specific defect in the pure-JS characters:

1. **Catmull-Clark subdivision.** The cage is a coarse quad shell; one level of
   subsurf turns it into a smooth organic surface. This is what stopped the
   limbs reading as faceted tubes.
2. **Bone heat diffusion weighting** (`ARMATURE_AUTO`). Blender solves weights
   across the mesh *surface*; a distance heuristic cannot know that the deltoid
   is topologically near the arm and far from the ribcage. This is what fixed
   the shoulder collapse, and the knee now bends without creasing.
3. **The official glTF exporter**, which gets skinning, normals and materials
   right without re-deriving the format by hand.

## Gotchas that cost time

- **Rotate the cage into Z-up on the way in.** The cage is authored Y-up (glTF
  convention); Blender is Z-up and its exporter converts back on export, so
  data that is already Y-up ships lying on its back. `to_blender()` handles it.
- **Author face features oversized.** Subdivision pulls each vertex toward its
  neighbours, so a feature comes out roughly half as deep as authored.
- **One subsurf level, not two.** Two smooths the face away entirely and
  quadruples the file — 6.3 MB a character against 1.5 MB.

## Known gaps

- **The face does not read.** The displacement approach in `body.mjs` is not
  producing a nose or brow that survives subdivision — measured, the "nose"
  station sits *behind* the cranium rather than in front of it. Unsolved.
- **1.5 MB a character** is too large. Needs decimation for LOD1/LOD2.
- **Bone axes.** Blender gives each bone its own roll, so posing by raw Euler
  angles from JS does not map cleanly. Mixamo clips are authored in bone-local
  space and should be unaffected, but that is untested — there is no Mixamo
  clip in the repo to test against.

## The path to a genuinely good character

MPFB2 (MakeHuman Plugin for Blender 2) generates a proper anatomical human with
real topology, a face, and full body/face sliders — free and open source. It
could not be installed from this session (GitHub access is gated), but it
installs locally in about two minutes, and **`build.py` is already the harness
that would consume its output**: swap `mesh_from_chains()` for a loader that
imports the MPFB2 body, and the subsurf, rig, weighting and export steps all
still apply.
