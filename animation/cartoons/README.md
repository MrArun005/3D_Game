# Clawd's Stories: cartoons

Flat 2D cartoons, taught by Clawd. Every character, prop and sound effect is
drawn or synthesised in code; the narration is Kokoro (local neural TTS).

**How we invented farming** (97 s): Ana, a hunter-gatherer in the Fertile
Crescent, the wild wheat that shatters, the rare plants whose seeds stay on,
seeds sprouting by camp, generations of selection, the first villages, tamed
sheep and goats, farming's independent origins around the world, and what it
led to.

```sh
npm install
python3 ../whiteboard/tools/voice.py stories/farming.lines.json out   # narration + timing
node tools/audio.mjs                                                  # music, birds, effects, voice
node tools/render.mjs                                                 # out/cartoon-farming.mp4 (~1 min)
```

`src/art.js` is the drawing kit (landscape, wheat, people, tents, houses,
animals, map, Clawd); `src/main.js` has one scene per narration line,
cross-faded at the line boundaries.
