# Vendor avatars — provenance and licence

`vendor/Thanh.glb` and `vendor/TranThiNgocTham.glb` came from
<https://github.com/hmthanh/3d-human-model> (master branch, root of repo).

They are **Ready Player Me** exports — every mesh and material carries the
`Wolf3D_` prefix, which was RPM's studio name.

## Do not ship these two files

- **The repo has no LICENSE file** and its README does not say where the models
  came from, so there is no licence grant to rely on.
- **The female avatar's clothing is a brand collab** — its textures are named
  `outfit-newbalance-02-v2-f-*`.
- **Ready Player Me no longer exists.** Netflix acquired it in December 2025 and
  the service closed on 31 January 2026, so no further avatars or variants can
  be generated from it and there is nobody to license from.

## What they are for

Development fixtures. They are a correct, complete example of the RPM avatar
schema, which is what `tools/avatar/` is built against:

- one SkinnedMesh per swappable slot (head, body, hair, teeth, eyes, top,
  bottom, footwear), all sharing one skeleton
- 67 joints, clean Mixamo names, with `LeftEye`/`RightEye` as real bones
- 63 blendshapes: Apple's 52 ARKit shapes plus the 11 Oculus visemes
- a large shared body normal map (2048px) and a small per-character face
  albedo (512px) — detail lives in the normal map, colour in the albedo

Everything in `tools/avatar/` reads these as input and writes elsewhere. Nothing
in the pipeline modifies them. When a licensed or self-authored base mesh
replaces them, the code should keep working unchanged as long as the new mesh
follows the same slot and joint naming.
