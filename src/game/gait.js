/**
 * Locomotion blend maths for the player character (2026-09-25).
 *
 * The rig ships Walk (authored for ~1.9 m/s) and Run (~5.2 m/s) and no jog.
 * The default on-foot pace is 3.2 m/s, and it used to play the RUN clip at
 * 0.62x: a full sprint in slow motion, big strides and slow pumping arms --
 * "he runs so weird". Games without a jog clip blend the two instead, as a
 * one-dimensional blend space:
 *
 *   w      = where the speed sits between the two clips' own speeds (0..1)
 *   vb, Db = the blended gait's natural speed and cycle length
 *   rate   = speed / vb: the playback rate that keeps the feet on the ground
 *
 * Both clips then finish one cycle in the same time (Db / rate), so they can be
 * phase-locked; tsWalk / tsRun are the per-clip time scales that achieve that.
 * Pure: numbers in, numbers out. Tested in test/gait.test.js.
 */
export const WALK_SPEED = 1.9;
export const RUN_SPEED = 5.2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The blend at `speed` m/s for clips of cycle length `Dw` (walk) and `Dr` (run) seconds. */
export function gaitBlend(speed, Dw, Dr, vw = WALK_SPEED, vr = RUN_SPEED) {
  const w = clamp((speed - vw) / (vr - vw), 0, 1);
  const vb = vw + (vr - vw) * w, Db = Dw + (Dr - Dw) * w;
  const rate = clamp(speed / vb, 0.55, 1.45);
  return { w, rate, tsWalk: (rate * Dw) / Db, tsRun: (rate * Dr) / Db };
}

/**
 * The phase (0..1) to add to the walk's normalised time to land the run on the
 * same step: the shift of `b` (run samples) that best matches `a` (walk
 * samples) over one cycle. Samples are quaternions [x, y, z, w] of the same
 * bone (a thigh) at N evenly spaced points; |dot| because q and -q are one
 * rotation. Returns 0 when there is nothing to compare.
 */
export function bestPhaseOffset(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0);
  if (n < 2) return 0;
  let best = 0, bestScore = -Infinity;
  for (let k = 0; k < n; k++) {
    let score = 0;
    for (let i = 0; i < n; i++) {
      const p = a[i], q = b[(i + k) % n];
      score += Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]);
    }
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best / n;
}

/** Move `cur` toward `target` linearly, reaching it over `fade` seconds (0 = at once). */
export function stepWeight(cur, target, dt, fade) {
  if (!(fade > 0)) return target;
  const step = dt / fade;
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}
