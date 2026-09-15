# Audio brief — what Halstead Bay sounds like, and what it is missing

Companion to `ASSET-BRIEF.md`. Same rule: everything here is measured against
this codebase, not guessed.

---

## 0. Where we actually are

**The project ships ZERO audio files.** Not one `.wav`, `.mp3` or `.ogg` in
`public/` or `assets/`. Every sound in the game is synthesised at runtime in
WebAudio — 30 oscillator/noise/buffer nodes in `game/audio.js`, and the engine
loops are *rendered* at boot by `game/engine-samples.js:renderEngineLoop`, not
loaded.

That is a defensible position and it fits the "everything must be free"
constraint absolutely. It is also why the outside review said the audio was
thin: a synthesised skid is a filtered noise burst, and ears know.

### What exists today (24 sounds, all synthesised)

| | |
| --- | --- |
| Vehicle | engine (6 RPM bands, on/off load crossfade), horn, doorOpen, doorShut, rumble, thud |
| Weapons | gunshot (pistol / smg / rifle / shotgun), reload, whiz, hitmark |
| Police | siren, farSiren, alarm |
| World | thunder, setRain, tokyo (ambience) |
| UI | click, cash, victoryFanfare, heartbeat, boot, bus, mute |

The engine architecture is already right — `ENGINE_BANDS = [900, 1800, 3000,
4200, 5500, 6800]` with a two-layer on/off load crossfade is exactly how a
racing game does it. It wants better source material, not a rewrite.

### The five signals the game computes that NOTHING listens to

This is the cheapest audio win in the project. The physics already knows:

| signal | where | the sound it should drive |
| --- | --- | --- |
| `car.slip` | `dynamics.js` — rear slip, 0..1 | **tyre squeal**, rising with slip |
| `car.wet` | weather / `wetTarmacLook` | **wet-road hiss**, spray under the arches |
| `car.flat[]` | `dynamics.js`, set by `w.shot` | **flat-tyre flap**, rim scrape |
| `car.hitForce` | `collision.js`, per contact | **impact severity** — scrape / crunch / heavy |
| `gear` | `dynamics.js` driveline | **shift clunk**, and the engine's pitch reset |

None of these make a sound today. Wiring them needs no new asset at all for the
first pass — the existing noise/filter machinery can carry them.

---

## 1. The categories

Priority is what a DRIVING game needs, in order. P0 means the game feels wrong
without it.

### P0 — the car (the thing you listen to for 100% of play)

| sound | have? | hangs off |
| --- | --- | --- |
| Engine idle / load / overrun | rendered | `rpm`, `throttle` |
| Rev limiter bounce | `renderLimiterLoop` exists, unused | `rpm >= REDLINE` |
| **Gear shift clunk** (up / down) | ✗ | `gear` change |
| **Tyre squeal** | ✗ | `car.slip` |
| **Skid / lock-up** | ✗ | brake + slip |
| **Surface roll** — tarmac, wet, sand, gravel, grass | ✗ | `roadDepth`, beach sand, `car.wet` |
| **Wind noise** | ✗ | speed |
| **Suspension** — bump, bottom-out, landing | partial (`thud`) | `car.heave`, 4-ray suspension |
| Brake squeal at low speed | ✗ | brake + speed |
| Handbrake | ✗ | input |
| **Flat tyre flap** | ✗ | `car.flat[]` |
| Damage — knock, radiator hiss, dragging metal | ✗ | `damage` |
| Starter / ignition | ✗ | enter vehicle |
| Turbo spool + blow-off, overrun pops | ✗ | boost, throttle lift |

### P0 — collision (you hit things constantly)

| sound | have? | hangs off |
| --- | --- | --- |
| **Scrape** (glancing, metal on metal) | ✗ | `car.hitForce` low |
| **Crunch** — light / medium / heavy | `thud` only | `car.hitForce` bands |
| Glass break | ✗ | damage model |
| Prop break by class | ✗ | `breakables.js` light / heavy |

### P1 — world ambience (sells the map, per district)

`districtAt` is already polled twice a second, so a per-district bed is nearly
free to wire.

| bed | have? |
| --- | --- |
| Little Tokyo | ✔ `tokyo` |
| City hum — distant traffic | ✗ |
| **Harbour Point** — gulls, water lapping, ship horn, crane | ✗ |
| **Beach / promenade** — surf, gulls, wind | ✗ (and the beach is ON now) |
| **River / under a bridge** — water, echo | ✗ (riverside is new) |
| Steelgate / Northline — machinery, rail | ✗ |
| Greenfell Park — birds, leaves | ✗ |
| Rain on the roof, gutters | partial `setRain` |
| Wind on an elevated deck | ✗ |

### P1 — traffic and NPCs

| sound | have? |
| --- | --- |
| Pass-by doppler (oncoming car) | ✗ |
| Other cars' horns | ✔ `honk` path |
| Siren doppler | ✔ siren, no doppler |
| **Helicopter rotor** | ✗ (`helicopter.js` exists) |
| Pedestrian footsteps / crowd murmur | ✗ (crowd, beach crowd, Tokyo scramble) |

### P1 — on foot

Footsteps by surface (pavement / sand / grass / metal deck), jump, land,
enter / exit vehicle. All missing.

### P2 — weapons (already the best-covered area)

Have pistol / smg / rifle / shotgun / reload / whiz / hitmark. Missing: shell
casing on tarmac, empty-magazine click, weapon switch, grenade pin / throw /
blast.

### P2 — race and UI

Checkpoint pass, countdown and start lights, finish, mission accept / fail,
map open / close. Have: click, cash, victoryFanfare.

---

## 2. Sourcing — and the licence rule

`CLAUDE.md`: **everything must be free. Free tools, free/CC0 assets, or authored
by me. No paid licences anywhere in the pipeline.**

That rules out most commercial SFX libraries, and it means attribution-only
licences need checking before use, not after.

| source | licence | good for |
| --- | --- | --- |
| **Freesound**, CC0 filter | CC0 | everything; filter to CC0, not "CC-BY" |
| **OpenGameArt**, CC0 filter | CC0 | impacts, UI, ambience |
| **Pixabay Sound Effects** | Pixabay licence, no attribution | ambience, beds |
| Zapsplat | free w/ attribution | usable, but attribution must go in NOTICE.md |
| BBC Sound Effects | **research/personal only** | ✗ — do not ship |

Practical shape: engine and tyre want *loops*; impacts and UI want *one-shots*;
ambience wants 30–60 s seamless beds.

Keep it small. A 3 MB audio budget is generous against a 25 MB initial download,
and beds compress hard as mono `.ogg` at 96 kbps.

---

## 3. The order I would do it in

1. **Wire the five dead signals.** Tyre squeal off `car.slip`, impact bands off
   `car.hitForce`, shift clunk off `gear`, flap off `car.flat`, hiss off
   `car.wet`. No new assets — the existing synthesis carries the first pass, and
   it is the single biggest felt improvement per hour.
2. **Surface roll + wind by speed.** The constant bed under all driving.
3. **District ambience beds.** Cheap to wire (`districtAt` already polls), and
   the beach, promenade and riverside are brand new and silent.
4. **Replace the engine's rendered loops with real CC0 samples**, keeping the
   band/crossfade architecture exactly as it is.
5. Helicopter, footsteps, crowd.

Steps 1–3 need no downloads at all.
