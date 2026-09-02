# Mixamo clip pull — the twelve the carjack needs

Free with an Adobe account at https://www.mixamo.com. Search each name exactly
as written, download, and drop the FBX files into `assets/source/clips/`.
`character.js` matches clips by the END of their name, so the file name is the
clip name — keep Mixamo's defaults.

## Download settings (same for every clip)

| Setting | Value | Why |
|---|---|---|
| Format | **FBX Binary (.fbx)** | the only thing `tools/avatar/fbx2glb.py` reads with animation |
| Skin | **Without Skin** | we retarget onto our own rigs; a skin doubles the file for nothing |
| Frames per second | **30** | matches the existing Quaternius clips |
| Keyframe reduction | **none** | the retargeter wants every key; reduction adds foot-slide |
| Character | any Mixamo default (X Bot / Y Bot) | only the skeleton matters |

## The clips

| # | Mixamo search name | Used for |
|---|---|---|
| 1 | `Opening A Door` | player reaches for the door handle |
| 2 | `Entering Car` | slide into the seat, door pulls shut |
| 3 | `Exiting Car` | step out, door swings behind |
| 4 | `Driving` | seated pose with hands on the wheel |
| 5 | `Grab And Pull` | the carjack: hauling the driver out |
| 6 | `Being Pulled Out` (fallback: `Stumble Backwards`) | the driver, yanked |
| 7 | `Falling Back Death` → rename file to `FallBack` | the driver hits the tarmac |
| 8 | `Getting Up` | the driver gets up and runs |
| 9 | `Standing Idle` | citizens |
| 10 | `Walking` | citizens and player |
| 11 | `Running` | fleeing driver, sprinting player |
| 12 | `Punching` | breaking a window to get into a locked car |

Tick **In Place** on Walking and Running: the game moves the root, so a clip
that also translates its hips fights the movement (the retargeter already
strips lateral hip drift — see `hipInfluence` in `character.js`).

## Convert

```
pip install bpy                                  # once; headless Blender
python3 tools/avatar/fbx2glb.py assets/source/clips public/models/clips
```

Each FBX becomes one `.glb` carrying its clip. The script prints
`N clips` per file; every line should say `1 clips`.

## Then I take over

`character.js` gains a clip pack loader: every `public/models/clips/*.glb` is
retargeted onto the active avatar at load with the same `retargetClip` path
the Quaternius donor uses, and registered under its file name. The carjack
state machine in `main.js` plays them by name. Nothing else changes.
