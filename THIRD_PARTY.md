# Third-party content in Halstead Bay

Everything shipped must be free (CLAUDE.md). This is the ledger: every vendor
set under `public/`, its licence, and whether it may ship. Per-set details live
in the `LICENSE*` / `NOTICE.md` file beside each set; this file only has to be
right about the column "Ship?".

| Set | Path | Licence | Ship? |
| --- | --- | --- | --- |
| Kenney Car Kit 3.1 | `public/models/vendor/kenney/cars/` | CC0 1.0 (`LICENSE.txt`) | yes |
| Kenney City Kit Commercial 2.1 | `public/models/vendor/kenney/commercial/` | CC0 1.0 | yes |
| Kenney City Kit Suburban 2.0 | `public/models/vendor/kenney/suburban/` | CC0 1.0 | yes |
| Kenney City Kit Industrial | `public/models/vendor/kenney/industrial/` | CC0 1.0 | yes |
| Kenney Train Kit | `public/models/vendor/kenney/train/` | CC0 1.0 | yes |
| Kenney Blocky Characters 2.0 | `public/models/vendor/kenney/characters/` | CC0 1.0 | yes |
| Quaternius Realistic Car Pack | `public/models/vendor/quaternius/cars/` | CC0 1.0 (`LICENSE.txt`) | yes |
| Quaternius Animated Men + Women | `public/models/characters/` | CC0 1.0 (`LICENSE-Quaternius.txt`) | yes |
| Poly Haven `hidden_alley` set (27 models) | `public/models/vendor/polyhaven/` | CC0 1.0 (`NOTICE.md`); the GLBs are gitignored and nothing loads them yet | yes (unused) |
| Sketchfab Chevrolet bodies (6, Ddiaz Design) | `public/models/vendor/sketchfab/*.glb` | five CC-BY-NC-SA-4.0, `corvette-c6r` CC-BY-4.0; all Chevrolet-branded (`NOTICE.md`) | **no** -- non-commercial, trademarked. Dev builds only |
| Sketchfab landmarks `gun-shop`, `supermarket`, `street-set` | `public/models/vendor/sketchfab/props/` | "Sketchfab Standard" per `../NOTICE.md`: usable in the game, files not redistributable | **no** -- the deploy serves the raw GLBs, which is redistribution |
| Sketchfab `gun.glb` (Dries Deryckere) | `public/models/vendor/sketchfab/props/` | CC-BY-4.0 per `../NOTICE.md` | yes, with credit |
| Sketchfab `building-pack.glb`, `city-street.glb` | `public/models/vendor/sketchfab/props/` | **licence unrecorded** -- no entry in any NOTICE.md | **do not ship** until a licence is written down |
| Avatar wardrobe GLBs (male/female) | `public/models/avatar/` | derived from unlicensed Ready Player Me exports (`assets/source/avatar/vendor/NOTICE.md`: "Do not ship") | **no** -- dev fixtures; a licensed base mesh must replace them |
| three.js example characters (Soldier, Michelle, Xbot, RobotExpressive) | `public/models/lib/` | Mixamo-derived, bundled with three.js for its examples (`README.md` there); not loaded by `src/` | **no** -- download your own from mixamo.com before shipping |
| Metro train `train_ride.glb` | `public/models/metro/` | **licence unrecorded** | **do not ship** until recorded |
| Authored kit (91 assets, 32 materials, textures) | `public/models/props`, `facade`, `public/textures/` | authored in-repo (`assets/source/`, `tools/`) | yes |

Libraries: `three` (MIT), `trystero` (MIT); build tooling `vite`,
`@gltf-transform/*`, `meshoptimizer` (MIT) is not shipped.

## Deploy

`.vercelignore` excludes `public/models/vendor/sketchfab` and
`public/models/avatar` from the upload, so the public build never carries the
non-commercial, trademarked or unlicensed sets. Every loader that reads them is
guarded (`vendorCars.js:loadHeroSkin` `.catch`, `landmarks.js:58` try/catch,
`character.js` `onFail`): the garage bodies `s-*` fall back to the loft with a
console warning, the three Sketchfab landmarks are skipped, `?me=8/9` keep the
box figure. `public/models/lib` and `public/models/metro` are NOT excluded yet:
`lib` is unused by `src/` but 8.5 MB of Mixamo-derived rigs; `metro` is loaded
(`world/metro.js:106`, guarded) and needs a licence recorded before a call is
made either way.
