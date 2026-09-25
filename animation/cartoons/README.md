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

**The Unicorn Seal** (92 s, 1080p 16:9, the rich engine): Mohenjo-daro, 4,500
years ago. Siya, a seal carver's daughter, must get her father's unicorn seal to
a merchant's boat before sunset. A monkey steals it, and the chase runs through
the real city: grid streets, covered brick drains, the carnelian bead market,
the Great Bath (it hops across on the bathers' heads). The seal falls into a
drain, rides it to the river, and is stamped onto a cotton bale bound for
Mesopotamia. Epilogue: the city under the sand, an archaeologist's brush, and
the writing no one has read yet. `src/indus/` is the rich engine: `core.js`
(parallax camera, brick/mud textures, sky, god rays, depth-of-field blur,
grade), `world.js` (2.5D houses, the citadel panorama, river and boats, bath,
market, drain), `people.js` (the outlined clothed rig, monkey, zebu and cart),
`seal.js` (the unicorn seal, carved stroke by stroke, and its impression).
Dialogue: Kokoro's Indian voices (hf_alpha, hm_omega, hf_beta, hm_psi). Score:
synthesised tanpura, sitar, bansuri, santoor and tabla (`tools/audio-indus.mjs`).

```sh
npm install
python3 ../whiteboard/tools/voice.py stories/farming.lines.json out   # narration + timing
node tools/audio.mjs farming                                          # music, birds, effects, voice
node tools/render.mjs --story farming                                 # out/cartoon-farming.mp4 (~1 min)
# the same three steps with coconut for The Coconut Problem
python3 ../whiteboard/tools/voice.py stories/firstpet.lines.json out  # Oog's lines
node tools/audio-firstpet.mjs && node tools/render.mjs --story firstpet
python3 ../whiteboard/tools/voice.py stories/indus.lines.json out      # The Unicorn Seal
node tools/audio-indus.mjs && node tools/render.mjs --story indus      # ~10 min at 1080p
```

`src/art.js` is the drawing kit (landscape, wheat, people, tents, houses,
animals, map, Clawd); `src/main.js` has one scene per narration line,
cross-faded at the line boundaries.
