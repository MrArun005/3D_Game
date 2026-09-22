/**
 * Frame-rate governor (2026-09-22). "It plays like a slideshow" on a weak GPU
 * is a fill-rate problem: every pixel runs the MRT scene pass, GTAO, bloom,
 * SMAA and the grade. The cheapest lever that exists at runtime is the render
 * resolution, so this watches frame time and scales the pixel ratio between
 * MIN and MAX -- the same trick GTA V and every console game use (dynamic
 * resolution). Pure: no DOM, tested in test/governor.test.js.
 *
 *   step(ms) -> { scale, changed, giveUp }
 *   scale    current pixel-ratio multiplier
 *   giveUp   true once: still slow at MIN for GIVE_UP_S -- the caller should
 *            recommend the lite tier (no GTAO, half crowd) for the next load
 */
export const TARGET_MS = 1000 / 58;   // a hair under 60 so vsync jitter does not trigger it
export const MIN = 0.5, MAX = 1.0;
const WINDOW = 45;          // frames averaged before any decision (~0.75 s)
const DOWN = 0.85, UP = 1.06;
const GIVE_UP_S = 6;

export function createGovernor({ min = MIN, max = MAX, start = max, target = TARGET_MS } = {}) {
  let scale = start, acc = 0, n = 0, slowAtMin = 0, gaveUp = false, cool = 0;
  return {
    get scale() { return scale; },
    step(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return { scale, changed: false, giveUp: false };
      ms = Math.min(ms, 100);            // a tab switch or a GC pause is not a trend
      acc += ms; n++;
      if (cool > 0) cool--;
      if (n < WINDOW) return { scale, changed: false, giveUp: false };
      const avg = acc / n; acc = 0; n = 0;
      let next = scale, giveUp = false;
      if (avg > target * 1.08) next = Math.max(min, scale * DOWN);          // slow: drop fast
      else if (avg < target * 0.72 && cool === 0) next = Math.min(max, scale * UP);   // lots of headroom: creep back
      if (next < scale) cool = WINDOW * 4;       // after a drop, wait ~3 s before trying higher again (no oscillation)
      if (scale <= min + 1e-6 && avg > target * 1.3) {
        slowAtMin += (WINDOW * avg) / 1000;
        if (slowAtMin > GIVE_UP_S && !gaveUp) { gaveUp = true; giveUp = true; }
      } else slowAtMin = 0;
      const changed = Math.abs(next - scale) > 1e-3;
      scale = Math.round(next * 100) / 100;
      return { scale, changed, giveUp };
    },
  };
}
