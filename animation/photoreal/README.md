# Photoreal: "Before Us"

A photoreal short (about 63 s) on Earth before people, told by a documentary
narrator: a young Earth on fire, the first rain filling the oceans, a bare
coast with no life on land, an ice age, and wild wheat on warm hills when the
last ice age ends.

Every frame is rendered by Blender's Cycles path tracer, driven from Python
(`pip install bpy`). Nothing is downloaded: terrain, water, sky, clouds, ice,
wheat and lava are all procedural. The narration is Kokoro (local neural TTS).

```sh
python3 ../whiteboard/tools/voice.py stories/before-us.lines.json out   # narration + timing
python3 shots/volcano.py --still 6        # one test frame
tools/queue.sh                            # renders every shot in out/queue.txt, one after another
node tools/score.mjs                      # music, nature sound, narration
python3 tools/stitch.py                   # 12 fps renders -> 24 fps, dissolves, titles -> out/before-us.mp4
```

| Shot | File | What it is |
|---|---|---|
| 1 | `shots/volcano.py` | Volcanoes on a plain of cracked lava crust; lava rivers in polar noise; a smoke column |
| 2 | `shots/rain.py` | A storm-dark ocean (FFT ocean modifier), rain streaks, lightning in a procedural cloud sky |
| 3 | `shots/coast.py` | A barren coast: fractured cliffs, sea stacks, turquoise water, a hazy young sky |
| 4 | `shots/glacier.py` | An ice-sheet front over a meltwater lake with bergs, low cold sun |
| 5 | `shots/wheat.py` | Wild wheat, ~200k instanced stalks via geometry nodes, wind, golden hour, depth of field |

Render cost on 4 CPU cores, 16 samples with denoising: about 20-45 s a frame.
Shots render at 12 fps and are motion-interpolated to 24 fps (slow camera moves
interpolate cleanly); shots 2 to 5 render at 960x540 and are upscaled.
