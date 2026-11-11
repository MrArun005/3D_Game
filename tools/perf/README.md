# tools/perf: streaming-hitch and contact harnesses (2026-11-11)

Built to answer "the car freezes as the city loads". They measure the CPU side
only, which is the part that transfers from a GPU-less container to a real
machine: JS ms per frame, shader programs linked, buffer uploads, draw counts.
Absolute milliseconds are this machine's; compare runs, not machines.

## Drive harnesses (browser)

    npx vite build --minify false --outDir /tmp/dist-dbg --emptyOutDir   # unminified: profiler names stay readable
    npx vite preview --port 4174 --strictPort --outDir /tmp/dist-dbg &
    PLAYWRIGHT=/path/to/playwright/index.mjs \
      node tools/perf/drive-links.mjs 'http://localhost:4174/?quality=balanced&webgl&nodrs&debug' out 625 30 bench

Arguments: url, output tag, frames, virtual fps, `bench` (drives window.runBenchmark's route).
Writes `<tag>.log`, `<tag>.json` (per-frame), `<tag>-links.json` (every program
linked after boot, with shader sources past frame 250), `<tag>-new.json`
(instanced objects that entered the scene between frames 300 and 309).

What they do to the page:
- virtual clock (performance.now, rAF, timers), so the game advances exactly
  1/fps per step however slow the machine is;
- GL draw calls are NO-OPS, so software rasterisation does not swamp the CPU
  numbers. The page renders nothing: never judge the look from these runs;
- counters on linkProgram, compileShader, tex uploads, bufferData/SubData
  (calls and bytes), deleteBuffer.

Known artefact: under the virtual clock districtWorld's 2 ms slicing never
trips, so a whole chunk builds inside one frame. Border frames here are an
upper bound on what the real game puts on one frame.

`drive-profile.mjs` is the same drive with a CDP CPU profile per frame (top
self-time functions per frame in `<tag>.json`); ~1.4 s a frame here.
On the route from the spawn the chunk borders are at frames ~305 (x = 2560)
and ~604 (x = 2816) at 30 fps.

    node tools/perf/analyse.mjs out.json            # frame stats, hitch list, top self time
    node tools/perf/shader-diff.mjs out-links.json  # what distinguishes the programs linked at the border

For a look check use real GL instead (slow): tools/smoke-boot.mjs's launch
flags, `?quality=low&webgl&mobile`, screenshot after `_world.chunks.size >= 9`.

## Physics (node, no browser)

    node tools/perf/phys-contacts.mjs   # standstill, head-on, reverse, posts, parked car, traffic, dt, slope
    node tools/perf/phys-walls.mjs      # wall glances at 6-45 deg, corner clips with clearance

Both drive the shipped stepVehicle at 1/120 s with the gta assist and the
muscle profile on flat open tarmac.
