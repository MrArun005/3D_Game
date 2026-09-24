# Frame-rate matrix (run on the real laptop, ~10 minutes)

Why: the renders in the cloud container are software GL (1-3 fps) and prove
nothing about speed. This splits the frame cost on real hardware.

How, for EACH row:
1. Chrome, window in front, nothing else running. Plugged in.
2. Open the URL, wait until the city is built (the loading card is gone), then
   press **F3** for the stats overlay.
3. Drive Regent Street east for 30 s (it starts you there). Note the average
   frame time (ms) and fps shown, plus draws / triangles.

Base: `https://3d-game.arunmarun005.workers.dev/?spawn=regent&quality=balanced&nodrs`
(`nodrs` stops the automatic resolution scaler hiding the cost.)

| # | Add to the base URL | What it isolates | ms | fps |
|---|---|---|---|---|
| 1 | *(nothing)* | baseline | | |
| 2 | `&nopost` | the whole post stack (AO, bloom, AA, grade) | | |
| 3 | `&nobloom` | bloom alone | | |
| 4 | `&noaa` | SMAA alone | | |
| 5 | `&res=0.5` | fill rate: if this alone reaches 16.7 ms, the cost is pixels | | |
| 6 | `&quality=low` (replace balanced) | shadows, draw distance, crowd | | |
| 7 | `&nocrowd` | the pedestrians | | |
| 8 | `&cars=0` | traffic | | |
| 9 | `?spawn=tokyo&quality=balanced&nodrs` | Little Tokyo instead of London | | |

Boot time (once each, stopwatch from Enter to the car on screen):

| URL | seconds |
|---|---|
| `?quality=balanced` | |
| `?quality=balanced&nowarm` (skips the up-front shader warm-up) | |

Reading it: if row 5 fixes it, cut pixels (resolution cap, post passes). If
row 2 fixes it, pick the post pass from rows 3-4. If rows 6-8 matter most, it
is scene work (shadow casters, draws), not pixels. The boot pair says whether
the warm-up (~1,355 shader programs) is the wait.
