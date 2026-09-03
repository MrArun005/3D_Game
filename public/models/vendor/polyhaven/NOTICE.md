# Poly Haven street & alley set (CC0)

27 models from Poly Haven's `hidden_alley` collection, downloaded via the
public API (no account needed) and ingested by `tools/polyhaven.mjs`.

**Licence: CC0 1.0 Universal** — public domain dedication. No attribution
required, commercial use fine, no share-alike, redistributable. This is the
cleanest licence in the repo and satisfies the everything-must-be-free rule
in CLAUDE.md outright. The credits below are courtesy, not obligation.

Source of truth: https://polyhaven.com/models — licence https://polyhaven.com/license

| Asset | Author(s) | Poly Haven page |
| --- | --- | --- |
| `concrete_road_barrier_02.glb` | Amal Kumar | https://polyhaven.com/a/concrete_road_barrier_02 |
| `covered_car.glb` | MP | https://polyhaven.com/a/covered_car |
| `exterior_aircon_unit.glb` | Monsta3D | https://polyhaven.com/a/exterior_aircon_unit |
| `fire_hydrant.glb` | Gonçalo Felício | https://polyhaven.com/a/fire_hydrant |
| `large_iron_gate.glb` | Josh Dean | https://polyhaven.com/a/large_iron_gate |
| `metal_trash_can.glb` | GurJas Studios | https://polyhaven.com/a/metal_trash_can |
| `modular_airduct_circular_01.glb` | Riley Queen | https://polyhaven.com/a/modular_airduct_circular_01 |
| `modular_chainlink_fence.glb` | James Ray Cock, Amal Kumar | https://polyhaven.com/a/modular_chainlink_fence |
| `modular_electricity_poles.glb` | James Ray Cock | https://polyhaven.com/a/modular_electricity_poles |
| `modular_factory_facade.glb` | James Ray Cock | https://polyhaven.com/a/modular_factory_facade |
| `modular_fire_escape.glb` | Juniix | https://polyhaven.com/a/modular_fire_escape |
| `modular_metal_gutter.glb` | Maxim Domnin | https://polyhaven.com/a/modular_metal_gutter |
| `modular_street_seating.glb` | Stuart Attenborrow | https://polyhaven.com/a/modular_street_seating |
| `modular_urban_apartments_facade.glb` | James Ray Cock | https://polyhaven.com/a/modular_urban_apartments_facade |
| `old_tyre.glb` | MP | https://polyhaven.com/a/old_tyre |
| `rollershutter_door.glb` | MP | https://polyhaven.com/a/rollershutter_door |
| `rollershutter_window_01.glb` | MP | https://polyhaven.com/a/rollershutter_window_01 |
| `rollershutter_window_02.glb` | MP | https://polyhaven.com/a/rollershutter_window_02 |
| `rollershutter_window_03.glb` | MP | https://polyhaven.com/a/rollershutter_window_03 |
| `security_camera_01.glb` | Alexander Otterbeck, Yann Kervran | https://polyhaven.com/a/security_camera_01 |
| `security_camera_02.glb` | Garrison Gager, Yann Kervran | https://polyhaven.com/a/security_camera_02 |
| `security_light.glb` | Maximilian Schuster | https://polyhaven.com/a/security_light |
| `street_lamp_01.glb` | Josh Dean | https://polyhaven.com/a/street_lamp_01 |
| `street_lamp_02.glb` | Josh Dean | https://polyhaven.com/a/street_lamp_02 |
| `utility_box_01.glb` | James Ray Cock | https://polyhaven.com/a/utility_box_01 |
| `utility_box_02.glb` | James Ray Cock | https://polyhaven.com/a/utility_box_02 |
| `water_manhole_cover.glb` | Raunox | https://polyhaven.com/a/water_manhole_cover |

## Ingest notes

- Sources (`.gltf` + `.bin` + 1k JPEG maps, 118.7 MB) live in
  `assets/source/vendor/polyhaven/` and are NOT shipped. Only the 27 packed
  `.glb` files here ship (93.5 MB).
- Textures are left exactly as Poly Haven ships them: 1k JPEG, which is
  already the mid-distance ceiling in `docs/BUDGETS.md`. They deliberately do
  NOT go through `tools/optimise-glb.mjs`, whose PNG re-encode of normal/ORM
  maps made every file bigger (old_tyre 2.1 -> 3.6 MB).
- Poly Haven's `arm` map is occlusion/roughness/metalness packed into RGB —
  the same ORM convention `docs/BUDGETS.md` asks for.
- No Draco and no meshopt: geometry is plain, so a bare `new GLTFLoader()`
  reads these. The only extensions present are KHR_texture_transform,
  KHR_materials_ior and KHR_materials_specular, all supported by three r185.1.
- 19 of 27 meet their single-prop triangle ceiling. The 8 `modular_*` files
  are multi-part KITS that keep their node hierarchy so parts can be placed
  individually; their file totals are kit totals (median part 58-381 tris,
  biggest 2,907), so no budget in `docs/BUDGETS.md` was raised for them.

## Not yet placed

Nothing in the world builder references these yet. They are a library to draw
from, not a change to the city.

⚠ Art-direction caveat: these are photoscan-derived and read PHOTOREAL, while
CLAUDE.md targets "GTA-level graphics, stylised — not photoreal" and the
existing kit is flat-shaded Kenney/Quaternius. Mixing them needs a deliberate
call per asset — the rollershutters, utility boxes, manhole cover and aircon
unit sit closest to the existing look.
