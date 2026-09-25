# TASKS.md — the GTA goal

The live checklist for the owner's goal. Read this file, not the chat
scrollback, to see where the run is. Tick items as they land (with the commit),
add anything new that is found. Last updated 2026-09-25.

**Goal (Arun):** GTA-level graphics — stylised, "GTA IV-era geometry under
modern lighting" (`docs/ART_BIBLE.md`) — running smoothly on Arun's M2 Air,
with gameplay that feels top-notch and leaves you happy after playing.

## Done means — all five

1. **Frame rate** `[owner]` — on Arun's M2 Air, default boot (no URL flags),
   the in-game benchmark (**fn + F9**) says **SMOOTH**: average ≥ 58 fps and
   1% low ≥ 50 fps.
2. **Look** `[owner]` — four shots signed off by Arun against his reference
   photos: Little Tokyo day, Little Tokyo night, Regent Street day, Kingsway
   night; and no item open under *Look* below.
3. **Feel** `[owner]` — Arun plays for 10 minutes (drive, a skill chain, a
   crash, a 2-star chase, one job) and says it feels good.
4. **Phone** `[owner]` — iPhone 15: in the car in ≤ 10 s, no tab crash in
   10 minutes, joystick, pedals and menu all work.
5. **Engineering** — `npm test` green, `tools/smoke-boot.mjs` passes, the
   CLAUDE.md budgets hold (≤ 1400 draws, ≤ 4.0M triangles at kingsway-corner).

## When to stop and ask Arun

Only for items marked `[owner]` (his laptop, his eyes, his thumbs), before
anything destructive or outside this repository, or before shipping the
non-commercial Sketchfab / RPM assets anywhere public. Everything else: keep
going, and put status in the same message as the next action.

## Checklist

### Performance
- [x] In-game benchmark, fn + F9 — `b6d5df6`
- [x] KTX2 library textures, ~4x less VRAM per map — `43dbca8`
- [x] Boot capped for a ~5 s start; phones get the mobile preset — `7d67a19`
- [ ] `[owner]` Arun's fn + F9 result on the M2 Air (screenshot of the panel)
- [ ] Next perf step chosen FROM that result: distance LOD for props if it is
      GPU-bound, the chunk-build hitch if it shows hitches — not before

### Look
- [x] Night environment map (was the noon sky all night) — `43dbca8`
- [x] Tail lamps decoded from the lamp mask (were green / blue) — `3e28216`
- [x] Punchier afternoon grade — `3e28216`
- [ ] Building detail up close: Downtown + Regent Street shots → the weakest
      facade → fix it (shots running 2026-09-25)
- [ ] Minimap looks tilted on touch — needs a screenshot from Arun
- [ ] `[owner]` sign-off on the four shots

### Feel
- [x] Street skill loop: near miss, drift, combo, cash — `3e28216`
- [x] Crash weight: hit-stop + pad rumble — `d21c705`
- [ ] `[owner]` play-test: the chain pays, a crash feels heavy, slow motion
      never sticks

### Phone
- [x] WebGPU empty-buffer crash — `f2515d7`; tab memory cuts — `8327526`
- [x] Joystick, pedals, drawer taps, no title card, loader, offline save —
      `59c7f5a` … `f9a7024`
- [ ] `[owner]` confirm the iPhone plays on `f9a7024` or later
