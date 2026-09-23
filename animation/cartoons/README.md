# Clawd's Stories: cartoons

Flat 2D cartoons, taught by Clawd. Every character, prop and sound effect is
drawn or synthesised in code; the narration is Kokoro (local neural TTS).

**How we invented farming** (97 s): Ana, a hunter-gatherer in the Fertile
Crescent, the wild wheat that shatters, the rare plants whose seeds stay on,
seeds sprouting by camp, generations of selection, the first villages, tamed
sheep and goats, farming's independent origins around the world, and what it
led to.

**The Coconut Problem** (79 s): Koa and friends race through the corn; Koa
spots coconuts, slips down the palm, finds the trick to climbing, and can't
open the shell (bite, squeeze, kick, ow) until he uses a stone. A stone used
to do a job is a tool; the oldest known stone tools are about 3.3 million
years old (Lomekwi, Kenya). `src/humans.js` is the jointed early-human rig
(no clothes, kept smooth and simple) and the beach, palm, corn and coconut props.

**The First Pet** (46 s, vertical 9:16, no narrator, no Clawd): a caveman
keeps losing his food to a wolf pup. Plan A (a basket trap) and Plan B (a
pit) both backfire; that night a cave lion creeps into camp and the pup
stands its ground with its first bark. Morning: he shares his fish. Wolves
were the first animals people tamed, more than 15,000 years ago. Slapstick
with speech bubbles; every beat time is in `stories/firstpet.beats.json`,
read by both `src/firstpet.js` and `tools/audio-firstpet.mjs`.

```sh
npm install
python3 ../whiteboard/tools/voice.py stories/farming.lines.json out   # narration + timing
node tools/audio.mjs farming                                          # music, birds, effects, voice
node tools/render.mjs --story farming                                 # out/cartoon-farming.mp4 (~1 min)
# the same three steps with coconut for The Coconut Problem
python3 ../whiteboard/tools/voice.py stories/firstpet.lines.json out  # Oog's lines
node tools/audio-firstpet.mjs && node tools/render.mjs --story firstpet
```

`src/art.js` is the drawing kit (landscape, wheat, people, tents, houses,
animals, map, Clawd); `src/main.js` has one scene per narration line,
cross-faded at the line boundaries.
