# TASKS.md — the GTA goal

The live checklist for the owner's goal. Read this file, not the chat
scrollback, to see where the run is. Tick items as they land (with the commit),
add anything new that is found. Last updated 2026-11-11 (the smoothness pass, at the end).

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
- [x] Grass verges in front of Regent Street shops → the city ground is paved
      (pavement slab texture) — `1df8689` *(seen)*
- [x] Lit shop windows show their stock instead of flat beige / brown boards
      — Regent `1df8689`, every Tokyo type `250ea7b`, muted `7c87fb6` *(seen)*
- [x] Regent Street upper windows are white sash windows, not navy panes —
      `b5d8d27` *(seen)*
- [x] On-foot HUD: the weapon row shows on change, fades after 3 s — `8029204`
- [x] Grain hash no longer collapses to a lattice; zero-mean — `1df8689`
- [ ] A faint 6 px grid in flat sky persists in the software-GL shots: most
      likely that renderer's coarse texture filtering, unverified on a GPU —
      `[owner]` tell me if you see a screen-door pattern in the sky
- [x] Night check at 21:30: displays read as lit shops with shelves, neon and
      headlamps hold — `d890a35` *(seen)*; the near shop walls still read a little
      pale in software GL — judge on the M2
- [ ] Minimap looks tilted on touch — needs a screenshot from Arun
- [ ] `[owner]` sign-off on the four shots

### Feel
- [x] Street skill loop: near miss, drift, combo, cash — `3e28216`
- [x] Crash weight: hit-stop + pad rumble — `d21c705`
- [x] On-foot running: walk/run blend space (the jog was a 0.62x slow-motion
      sprint), phase-locked feet, body roll capped at 7° (was ~50° on a sharp
      turn), near-miss whoosh — `1df8689` *(seen: jog = walk 0.61 / run 0.39
      at ~1x, sprint = run 1.0 at 1.15x, stop = idle; 0 errors)*
- [ ] `[owner]` run around on foot: does it read as running now?
- [ ] `[owner]` play-test: the chain pays, a crash feels heavy, slow motion
      never sticks

### Phone
- [x] WebGPU empty-buffer crash — `f2515d7`; tab memory cuts — `8327526`
- [x] Joystick, pedals, drawer taps, no title card, loader, offline save —
      `59c7f5a` … `f9a7024`
- [ ] `[owner]` confirm the iPhone plays on `f9a7024` or later

### Deploy
- [ ] Cloudflare Worker `3d-game`: production branch `main`, deploy command
      must be `npx wrangler deploy` (`versions upload` never goes live);
      other branches stay `versions upload` previews

### Smoothness pass, 2026-11-11 (branch `claude/smooth-streaming-physics`)

The owner: "as I drive forward the city loads but it freezes the car", "so
many physics issues". Measured in a GPU-less container with
`tools/perf/drive-bench.mjs` (the F9 benchmark route under a virtual 30 fps
clock, GL draws stubbed, balanced tier, WebGL2 fallback): CPU milliseconds of
JS per frame, shader programs, uploads. Those transfer to the M2; fps does not.
Nothing below has been driven on a real GPU.

- [x] **The freeze at a chunk border.** Worst frame at a border, same drive:
      3729 ms -> ~210 ms. Frames over 250 ms while driving past four
      borders: 12 (with only the first fix below) -> 0; the price is ~30
      frames of 110-215 ms while a new block's cars and trees join.
      Three causes, three fixes:
      - three compiled a NEW shader for every small InstancedMesh of a new
        chunk (67 programs at one border): instancing now takes the shared
        attribute path (`core/renderer.js tuneBackend`, `?ubo` for the old way).
      - three also builds its node state per InstancedMesh OBJECT (~90 builds
        a border): released chunks' meshes are recycled (`world/instPool.js`),
        glare sprites and the signal-lens material too.
      - what is still new starts two a frame instead of thirty on the frame
        the chunk lands (`districtWorld #warmCold`, `COLD_PER_FRAME`).
- [x] Pulling away from a stop freed 16 chunks on one frame (358 buffer
      deletes, a 231 ms GC pause): two chunks a frame now.
- [x] Uniform uploads: 9,691 -> ~640 buffer writes a frame (one write per
      uniform block); steady frame 57 -> ~46 ms in the harness.
- [x] The raceway's eight floodlight SpotLights were being evaluated in every
      lit pixel of the whole map (three has no light clustering): they are
      real lights only within ~450 m of the island now. CPU side measured
      (steady frame 50.4 -> 42.0 ms in the harness); the GPU side is the
      bigger half and is `[owner]` to see on the M2. Cost: a one-off stall
      when you drive or teleport out to the raceway (every shader rebuilds).
      Still in the scene: 11 point + 8 spot light slots, most at intensity 0
      (pool, headlamps, muzzle flashes) -- each one is a per-pixel cost too.
- [x] Slow frames no longer slow the GAME: the world keeps real time down to
      15 fps and the car catches up to 0.1 s through a hitch (was a 0.05 s
      clamp: slow motion under 20 fps, a dead car on every hitch).
- [x] Physics (`node tools/sim/contact.mjs` prints the table): walls deflect
      (20/30/45 deg hit at 60 km/h, speed 1 s later 31/13/1 -> 73/62/40 km/h),
      a building corner with air beside the body is no longer a dead stop,
      brushing a parked car costs no speed (was a 7.5 m shove), traffic can be
      pushed from behind (rear-end at 60 into 40: both dropped to 16 km/h).
- [x] `tools/smoke-boot.mjs` runs again (`npm run smoke`): finds Playwright,
      starts and stops its own preview server, `?nowarm` skips the warm-up.
- [ ] `[owner]` **fn + F9 on the M2 Air** (screenshot the panel), then drive
      Little Tokyo -> Regent Street at speed and watch for a stall each time a
      new block of city appears (every 256 m). If it still hitches: note
      whether parked cars / trees of the far block pop in over a second (they
      now arrive two a frame) -- that is the knob (`COLD_PER_FRAME`).
- [ ] `[owner]` hit a wall at 30-45 degrees with the throttle held (should
      slide along it), squeeze past a building corner, brush a parked car,
      rear-end traffic, a handbrake turn into a kerb. Tell me what feels wrong.
- [ ] `[owner]` at night: lamp glare, traffic-light colours and shop windows
      look right after driving a few blocks (those meshes are recycled now).
- [ ] Not done: a wall hit at 60-70 degrees with the throttle held still
      stops the car (steer or reverse frees it); a building corner overlapped
      by 0.3 m+ is still a crash stop; no gravity along slopes (a parked car
      on a 10% grade does not roll); police cruisers cannot be pushed.
- [ ] Not done: the first frame after the loading screen (5.2 s of CPU in
      software GL while late assets land); the benchmark / respawn teleport
      frame (the whole ring builds in one frame, ~3.5 s in the harness).
- [ ] Not measured: WebGPU itself (the harness runs the WebGL2 fallback);
      `kingsway-corner` on `high`.

