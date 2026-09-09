/**
 * Render interpolation for the fixed physics step.
 *
 * The car steps at 1/120 s behind an accumulator, so a 60 Hz frame gets 2
 * steps on average but 1 or 3 when the frame time drifts either side of
 * 16.7 ms. Posing the hero straight from `car` shows the leftover of the
 * accumulator (0..STEP) as a visible 8 ms judder in position and yaw. The
 * standard fix ("fix your timestep"): keep the pose from BEFORE the last
 * step, and draw `prev + (cur - prev) * accumulator / STEP`. The rendered car
 * lags the simulation by at most one step (8.3 ms), which is not perceptible;
 * the aliasing was.
 *
 * Pure: no three.js, so it runs under node's test runner.
 */

const TAU = Math.PI * 2;

/** Shortest-arc angle lerp: 3.1 -> -3.1 turns 0.08 rad, not 6.2. */
export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/** The fields the pose reads. Everything else stays on the raw `car`. */
export const POSE_KEYS = ['x', 'y', 'z', 'yaw', 'heave', 'roll', 'pitch'];
const ANGLE_KEYS = new Set(['yaw', 'roll', 'pitch']);

/** Copy the pose fields of `src` into `dst` (a plain scratch record). */
export function copyPose(dst, src) {
  for (const k of POSE_KEYS) dst[k] = src[k] || 0;
  return dst;
}

/**
 * Write `prev` -> `cur` at `alpha` (clamped to 0..1) into `out`. A jump larger
 * than `snapDist` metres between the two (a respawn, a teleport, the drowning
 * reset) is not interpolated: the frame snaps to `cur`, or the car would be
 * drawn streaking across the city for one frame.
 */
export function lerpPose(prev, cur, alpha, out = {}, snapDist = 5) {
  const t = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  const dx = (cur.x || 0) - (prev.x || 0), dz = (cur.z || 0) - (prev.z || 0);
  if (t === 1 || dx * dx + dz * dz > snapDist * snapDist) return copyPose(out, cur);
  if (t === 0) return copyPose(out, prev);
  for (const k of POSE_KEYS) {
    const a = prev[k] || 0, b = cur[k] || 0;
    out[k] = ANGLE_KEYS.has(k) ? lerpAngle(a, b, t) : a + (b - a) * t;
  }
  return out;
}
