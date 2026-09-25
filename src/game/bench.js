/**
 * Frame-time statistics for the in-game benchmark (2026-09-25). The one
 * number this project could never measure from a container is the owner's
 * real frame rate: an automated browser runs an EMPTY rAF loop at 44 fps
 * (CLAUDE.md). So the game measures itself, on the machine that matters.
 * Pure: frame times in ms in, a summary out. Tested in test/bench.test.js.
 */
export function benchStats(ms) {
  const a = ms.filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const sum = a.reduce((s, x) => s + x, 0);
  const pct = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const worst1 = a.slice(Math.floor(a.length * 0.99));   // the slowest 1% of frames
  const low1 = worst1.reduce((s, x) => s + x, 0) / worst1.length;
  return {
    frames: a.length,
    avgFps: +(1000 / (sum / a.length)).toFixed(1),
    low1Fps: +(1000 / low1).toFixed(1),       // "1% low": the average of the worst 1%, as fps
    p50Ms: +pct(0.5).toFixed(2),
    p99Ms: +pct(0.99).toFixed(2),
    worstMs: +a[a.length - 1].toFixed(1),
    over33: a.filter((x) => x > 33.4).length,  // frames under 30 fps: the hitches you feel
    verdict: 1000 / low1 >= 50 && 1000 / (sum / a.length) >= 58 ? 'SMOOTH' : 1000 / (sum / a.length) >= 45 ? 'PLAYABLE' : 'TOO SLOW',
  };
}
