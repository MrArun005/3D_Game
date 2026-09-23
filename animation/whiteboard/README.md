# Whiteboard stories

Short teaching stories drawn on a whiteboard, narrated by a little orange pixel
critter. Every stroke, sprite, sound and note is generated in code; there are
no external assets.

**Story 1: Flight 1549, how an airliner became a glider** (84 s):
the bird strike, the 17:1 glide, why not LaGuardia or Teterboro, the ditching
attitude, the rescue, and three lessons.

```sh
npm install
node tools/audio.mjs     # out/whiteboard-1549.wav: marker squeaks, eraser, 8-bit voice, plucked tune
node tools/render.mjs    # out/whiteboard-1549.mp4 (renders in under a minute)
```

Open `index.html` from any static server for a live preview.

| File | What it holds |
|---|---|
| `src/ink.js` | Hand-drawn marker shapes (wobbly lines, arrows, checks, planes, geese, boats) drawn progressively |
| `src/story.js` | The script: every stroke, word, bubble, walk, hop and point, timed in seconds |
| `src/main.js` | A frame: the board, the ink, the eraser wipe, the 16 x 11 pixel critter, the speech bubbles |
| `tools/audio.mjs` | The soundtrack, synthesised from the same timings |
| `tools/render.mjs` | Headless Chromium, canvas pixels into ffmpeg |

To make a new story, write a new `story.js`: shapes and text go on the board at
their times, and the eraser sweeps at each `WIPES` time.
