import * as THREE from 'three';

/**
 * The dev overlay. F3.
 *
 * Every number in docs/BUDGETS.md, live, red when over. It exists because
 * nothing else on the roadmap can be honestly claimed without it: "no frame
 * over 20 ms" and "texture memory is flat, not climbing" are acceptance tests,
 * and an acceptance test you cannot read is a wish.
 *
 * Frame time is reported as a rolling 1% -worst as well as a median. A median
 * hides exactly the thing chunk streaming does wrong -- one 60 ms frame in
 * sixty is invisible in an average and very visible to a player.
 */

const BUDGET = {
  frameMs: 16.6,
  draws: 1400,   // docs/BUDGETS.md; 1150 / 3.2M is the Phase-0 target, not the limit
  tris: 4.0e6,
  textureMB: 512,
  chunks: 25,
  chunkBuildMs: 3,
};

const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

export class Stats {
  constructor() {
    this.on = false;
    this.samples = [];          // rolling 600 frames
    this.spikeLog = [];         // recorded spikes
    this.frameIndex = 0;
    this.currentFrameChunkMs = 0;
    this.currentFrameChunkSlices = 0;
    this.lastPrograms = 0;
    this.worstCause = 'normal';

    this.chunkMs = 0;
    this.worstChunkMs = 0;
    this.spikeCount = 0;          // whole session
    this.byCause = {};            // cause -> count, whole session
    this.sessionFrames = 0;
    this.sessionWorst = { ms: 0, cause: 'none', frame: 0, t: 0 };
    this.lastSpikeLog = 0;
    this.lastSummary = performance.now();
    this.summarySpikes = 0;
    this.chunkTotals = [];      // whole-chunk build cost, last ten, for photo.line()
    this.el = null;
    this.snapshot = { draws: 0, tris: 0, bundledDraws: 0, bundledTris: 0 };

    if (typeof window !== 'undefined') {
      /* The paste-back report. Plain text, one call, everything a stall
         diagnosis needs in ~15 lines: how long you played, the frame-time
         distribution, every spike cause with a count, the worst single frame
         and where you were, the last ten whole-chunk build costs, and the
         last 20 spikes with timestamps. Type __lagReport() in the console and
         paste what it prints. */
      window.__lagReport = () => {
        const win = this.samples.map((e) => e.ms).sort((a, b) => a - b);
        const q = (p) => win.length ? win[Math.min(win.length - 1, Math.floor(p * win.length))].toFixed(1) : '-';
        const causes = Object.entries(this.byCause).sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `    ${String(n).padStart(4)}  ${c}`).join('\n') || '    (none)';
        const recent = this.spikeLog.slice(-20)
          .map((e) => `    f${e.frame}  ${e.ms.toFixed(1)} ms  ${e.cause}`).join('\n') || '    (none)';
        const text = [
          `HALSTEAD BAY LAG REPORT  ${new Date().toISOString()}`,
          `  session   ${(performance.now() / 1000).toFixed(0)} s, ${this.sessionFrames} frames, ${this.spikeCount} spikes (${(100 * this.spikeCount / Math.max(1, this.sessionFrames)).toFixed(2)}%)`,
          `  last 600  p50 ${q(0.5)} ms · p95 ${q(0.95)} ms · p99 ${q(0.99)} ms · worst ${q(1)} ms`,
          `  worst     ${this.sessionWorst.ms.toFixed(1)} ms at ${this.sessionWorst.t.toFixed(1)} s (frame ${this.sessionWorst.frame}): ${this.sessionWorst.cause}`,
          `  chunks    last ten whole builds: ${this.chunkTotals.map((m) => m.toFixed(0)).join(' ') || '-'} ms · worst slice ${this.worstChunkMs.toFixed(1)} ms`,
          `  scene     ${this.snapshot.draws} draws · ${(this.snapshot.tris / 1e6).toFixed(2)}M tris · ${this.snapshot.programs} pipelines · ${this.snapshot.textures} textures`,
          `  gpu       ${window.__gpuInfo ? JSON.stringify(window.__gpuInfo).slice(0, 120) : 'n/a'}${window.__isLite ? ' · LITE' : ''}`,
          `  spikes by cause:`, causes,
          `  last 20 spikes:`, recent,
        ].join('\n');
        console.log(text);
        return text;
      };
      window.dumpSpikes = () => {
        if (!this.spikeLog.length) {
          console.log('[perf] No frame spikes recorded.');
          return;
        }
        console.table(this.spikeLog.map((s) => ({
          Frame: s.frame,
          'Time (ms)': s.ms.toFixed(1),
          Cause: s.cause,
          'Chunk ms': s.chunkMs.toFixed(1),
          'Compiles': s.compiles,
        })));
      };
    }

    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { this.on = !this.on; this.#ensure().style.display = this.on ? 'block' : 'none'; }
    });
  }

  #ensure() {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:12px;left:12px;z-index:50;display:none;'
      + 'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + 'background:rgba(8,11,16,.82);color:#cfe0f5;padding:10px 13px;'
      + 'border-radius:7px;white-space:pre;pointer-events:none;'
      + 'text-shadow:0 1px 2px rgba(0,0,0,.6)';
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  /** Called by the world when it builds a chunk, in milliseconds. */
  reportChunkTotal(ms) {
    this.chunkTotals.push(ms);
    if (this.chunkTotals.length > 10) this.chunkTotals.shift();
  }

  reportChunkBuild(ms) {
    this.chunkMs = ms;
    this.currentFrameChunkMs += ms;
    this.currentFrameChunkSlices++;
    this.worstChunkMs = Math.max(this.worstChunkMs * 0.995, ms);
  }

  /**
   * Read `renderer.info` AFTER grade.render() -- the counters accumulate
   * across every pass in the frame (the renderer's own animation pump resets
   * them once per rAF), and since Tier 1.1 the pipeline render IS the frame:
   * scene MRT pass, shadows, GTAO, bloom chain, output quad, all of it.
   */
  sample(renderer) {
    /* WebGPU counts differently: `render.calls` includes every pass three
       issues (shadows, the grade quad, compute) and accumulates across the
       frame, while `render.drawCalls` is the comparable number to WebGL's
       `calls`. Prefer it where it exists so the budget still means something. */
    const r = renderer.info.render;
    this.snapshot.draws = r.drawCalls ?? r.calls;
    this.snapshot.tris = renderer.info.render.triangles;
    this.snapshot.programs = renderer.info.programs ? renderer.info.programs.length : 0;
    this.snapshot.geometries = renderer.info.memory.geometries;
    this.snapshot.textures = renderer.info.memory.textures;
  }

  update(dt, world, renderer, framePhases = null, ctx = null) {
    this.frameIndex++;
    /* WALL CLOCK, not `dt`. The frame loop clamps dt to 50 ms so the physics
       cannot explode after a stall, which means dt*1000 saturates at exactly
       50.0 -- and the first report from this logger showed every spike as
       "50.0 ms", including one whose render phase measured 20,932 ms. A lag
       logger that cannot say how long the lag was is not one. */
    const wall = performance.now();
    const frameMs = this.lastWall ? wall - this.lastWall : dt * 1000;
    this.lastWall = wall;
    const currentPrograms = this.snapshot.programs;
    const compiles = this.lastPrograms > 0 && currentPrograms > this.lastPrograms
      ? currentPrograms - this.lastPrograms
      : 0;
    this.lastPrograms = currentPrograms;

    const chunkMs = this.currentFrameChunkMs;
    const chunkSlices = this.currentFrameChunkSlices;
    this.currentFrameChunkMs = 0;
    this.currentFrameChunkSlices = 0;

    // Diagnose spike cause
    const reasons = [];
    if (chunkMs > 3.0 || chunkSlices > 0) {
      reasons.push(`chunk build (${chunkSlices} slice${chunkSlices > 1 ? 's' : ''}, ${chunkMs.toFixed(1)}ms)`);
    }
    if (compiles > 0) {
      reasons.push(`${compiles} pipeline compile${compiles > 1 ? 's' : ''}`);
    }
    if (framePhases) {
      if (framePhases.physics > 6.0) reasons.push(`physics (${framePhases.physics.toFixed(1)}ms)`);
      if (framePhases.render > 16.0) reasons.push(`render pass (${framePhases.render.toFixed(1)}ms)`);
    }
    /* Causes the game can actually know about, beyond its own render loop
       (2026-09-15). These are what a stall usually IS when it is not a chunk:
       an asset still downloading, the texture library still decoding, or a
       boot phase still running. Without them every such frame said
       "GC / script execution", which is the diagnosis you give when you have
       not looked. */
    if (ctx?.pendingLoads > 0) reasons.push(`${ctx.pendingLoads} asset fetch${ctx.pendingLoads > 1 ? 'es' : ''} in flight`);
    if (ctx?.texturesLoading) reasons.push('textures still loading');
    if (ctx?.bootPhase) reasons.push(`boot: ${ctx.bootPhase}`);
    if (frameMs > 28.0 && reasons.length === 0) {
      reasons.push('GC / script execution');
    }
    const cause = reasons.length ? reasons.join(' + ') : 'normal';

    const entry = {
      frame: this.frameIndex,
      ms: frameMs,
      chunkMs,
      chunkSlices,
      compiles,
      cause,
    };

    // Rolling 600-frame window
    this.samples.push(entry);
    if (this.samples.length > 600) this.samples.shift();
    this.sessionFrames++;
    if (frameMs > this.sessionWorst.ms) this.sessionWorst = { ms: frameMs, cause, frame: this.frameIndex, t: performance.now() / 1000 };

    /* A summary line every 30 s, so a pasted console has a TIMELINE and not
       just the bad frames: what the median and 95th were, how many spikes and
       of what kind, how many chunks were built. A quiet 30 s prints nothing. */
    const tNow = performance.now();
    if (tNow - this.lastSummary > 30000) {
      this.lastSummary = tNow;
      const win = this.samples.map((e) => e.ms).sort((a, b) => a - b);
      if (win.length > 30) {
        const q = (p) => win[Math.min(win.length - 1, Math.floor(p * win.length))].toFixed(1);
        const spikesHere = this.spikeCount - this.summarySpikes; this.summarySpikes = this.spikeCount;
        if (spikesHere > 0 || PERF) {
          console.info(`[lag] ${(tNow / 1000).toFixed(0)}s summary: p50 ${q(0.5)} ms · p95 ${q(0.95)} ms · worst ${win[win.length - 1].toFixed(1)} ms · ${spikesHere} spikes in 30 s · chunks built ${this.chunkTotals.length}`);
        }
      }
    }

    // Log spike if ?perf active or significant hitch
    if (frameMs > 33.3 || (frameMs > 24.0 && (chunkMs > 2.0 || compiles > 0))) {
      this.spikeLog.push(entry);
      if (this.spikeLog.length > 100) this.spikeLog.shift();
      this.spikeCount++;
      this.byCause[cause] = (this.byCause[cause] || 0) + 1;
      /* Logged BY DEFAULT now, not only under ?perf, because the ask is "if it
         lags, the console must have something I can paste back". Rate-limited
         to one line per 250 ms so a bad second is a few lines, not a hundred;
         the full ring is still in __lagReport(). Position included so a stall
         can be walked to. */
      const nowMs = performance.now();
      if (PERF || nowMs - this.lastSpikeLog > 250) {
        this.lastSpikeLog = nowMs;
        const at = world?.camera ? ` @ ${Math.round(world.camera.position.x)},${Math.round(world.camera.position.z)}` : '';
        console.warn(`[lag] ${(nowMs / 1000).toFixed(1)}s frame ${this.frameIndex}: ${frameMs.toFixed(1)} ms — ${cause}${at}`);
      }
    }

    // Every 10th frame, overlay or not: photo.line() reads these too
    if (world?.bundleStats && (this.frameIndex % 10) === 0) {
      const b = world.bundleStats();
      this.snapshot.bundledDraws = b.draws;
      this.snapshot.bundledTris = b.tris;
    }

    if (!this.on) return;

    // Statistical percentiles (computed only when F3 overlay is visible)
    const sorted = [...this.samples].sort((a, b) => a.ms - b.ms);
    const n = sorted.length;
    const median = sorted[n >> 1]?.ms || 0;
    const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))]?.ms || 0;
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))]?.ms || 0;
    const worstSample = sorted[n - 1];
    const worst = worstSample?.ms || 0;
    this.worstCause = worstSample?.cause || 'normal';

    const live = world && world.chunks ? world.chunks.size : 0;
    const texMB = this.snapshot.textures * 0.35; // rough: most are 1024^2 RGBA
    const isLite = world?.isLite ?? (world?.radius === 1);
    const chunkBudget = isLite ? 9 : BUDGET.chunks;

    const row = (label, value, budget, unit = '', fmt = (v) => v.toFixed(0)) => {
      const over = budget !== null && value > budget;
      const b = budget === null ? '' : ` / ${fmt(budget)}`;
      return `${over ? '!' : ' '} ${label.padEnd(13)}${fmt(value).padStart(7)}${b}${unit}\n`;
    };

    let out = '';
    out += `  quality     ${(isLite ? 'LITE' : 'FULL').padStart(7)}\n`;
    out += row('frame med', median, BUDGET.frameMs, ' ms', (v) => v.toFixed(1));
    out += row('frame 95th', p95, 20, ' ms', (v) => v.toFixed(1));
    out += row('frame 99th', p99, 24, ' ms', (v) => v.toFixed(1));
    out += row('frame worst', worst, 33.3, ' ms', (v) => v.toFixed(1));
    out += `  worst cause: ${this.worstCause}\n`;
    // counted draws + what the chunk bundles replay: the number the budget is about
    out += row('draw calls', this.snapshot.draws + this.snapshot.bundledDraws, BUDGET.draws);
    out += row('triangles', (this.snapshot.tris + this.snapshot.bundledTris) / 1e6, BUDGET.tris / 1e6, ' M', (v) => v.toFixed(2));
    out += `  of which bundled ${String(this.snapshot.bundledDraws).padStart(5)} draws / ${(this.snapshot.bundledTris / 1e6).toFixed(2)} M\n`;
    out += row('texture mem', texMB, BUDGET.textureMB, ' MB');
    out += row('live chunks', live, chunkBudget);
    out += row('chunk build', this.worstChunkMs, BUDGET.chunkBuildMs, ' ms', (v) => v.toFixed(1));
    out += `  geometries  ${String(this.snapshot.geometries).padStart(7)}\n`;
    out += `  textures    ${String(this.snapshot.textures).padStart(7)}\n`;
    out += `  programs    ${String(this.snapshot.programs).padStart(7)}\n`;
    out += `  px ratio    ${renderer.getPixelRatio().toFixed(2).padStart(7)}`;
    this.#ensure().textContent = out;
  }
}
