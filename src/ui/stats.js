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
  draws: 1400,
  tris: 4.0e6,
  textureMB: 512,
  chunks: 25,
  chunkBuildMs: 4,
};

export class Stats {
  constructor() {
    this.on = false;
    this.samples = [];
    this.chunkMs = 0;
    this.worstChunkMs = 0;
    this.el = null;
    this.snapshot = { draws: 0, tris: 0 };
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
  reportChunkBuild(ms) {
    this.chunkMs = ms;
    this.worstChunkMs = Math.max(this.worstChunkMs * 0.995, ms);
  }

  /**
   * Read `renderer.info` BEFORE the grade pass overwrites it -- three resets
   * the counters on every render() call, so reading after post gives you the
   * stats for a fullscreen quad.
   */
  sample(renderer) {
    this.snapshot.draws = renderer.info.render.calls;
    this.snapshot.tris = renderer.info.render.triangles;
    this.snapshot.programs = renderer.info.programs ? renderer.info.programs.length : 0;
    this.snapshot.geometries = renderer.info.memory.geometries;
    this.snapshot.textures = renderer.info.memory.textures;
  }

  update(dt, world, renderer) {
    this.samples.push(dt * 1000);
    if (this.samples.length > 180) this.samples.shift();
    if (!this.on) return;

    const s = [...this.samples].sort((a, b) => a - b);
    const median = s[s.length >> 1] || 0;
    const worst = s[Math.max(0, Math.floor(s.length * 0.99) - 1)] || 0;
    const live = world && world.chunks ? world.chunks.size : 0;
    const texMB = this.snapshot.textures * 0.35;   // rough: most are 1024^2 RGBA

    const row = (label, value, budget, unit = '', fmt = (v) => v.toFixed(0)) => {
      const over = budget !== null && value > budget;
      const b = budget === null ? '' : ` / ${fmt(budget)}`;
      return `${over ? '!' : ' '} ${label.padEnd(13)}${fmt(value).padStart(7)}${b}${unit}\n`;
    };

    let out = '';
    out += row('frame med', median, BUDGET.frameMs, ' ms', (v) => v.toFixed(1));
    out += row('frame 1% low', worst, 20, ' ms', (v) => v.toFixed(1));
    out += row('draw calls', this.snapshot.draws, BUDGET.draws);
    out += row('triangles', this.snapshot.tris / 1e6, BUDGET.tris / 1e6, ' M', (v) => v.toFixed(2));
    out += row('texture mem', texMB, BUDGET.textureMB, ' MB');
    out += row('live chunks', live, BUDGET.chunks);
    out += row('chunk build', this.worstChunkMs, BUDGET.chunkBuildMs, ' ms', (v) => v.toFixed(1));
    out += `  geometries  ${String(this.snapshot.geometries).padStart(7)}\n`;
    out += `  textures    ${String(this.snapshot.textures).padStart(7)}\n`;
    out += `  programs    ${String(this.snapshot.programs).padStart(7)}\n`;
    out += `  px ratio    ${renderer.getPixelRatio().toFixed(2).padStart(7)}`;
    this.#ensure().textContent = out;
  }
}
