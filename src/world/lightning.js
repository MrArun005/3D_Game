/**
 * Lightning timing, pure and tested. A storm night gets a strike every
 * STRIKE_MIN..STRIKE_MAX seconds; each strike is two or three pulses of
 * ~60 ms with short gaps (the stutter is what makes it read as lightning
 * rather than a lamp), and the thunder follows after a distance delay.
 *
 * step(state, dt, rnd) mutates `state` and returns the flash 0..1 for this
 * frame. `state.strike` is set to { delay } on the frame a strike begins,
 * cleared otherwise, so the caller can schedule the thunder once.
 */
export const STRIKE_MIN = 18, STRIKE_MAX = 50;

export function newState(rnd = Math.random) {
  return { next: STRIKE_MIN + rnd() * (STRIKE_MAX - STRIKE_MIN), pulses: [], strike: null };
}

export function step(s, dt, rnd = Math.random) {
  s.strike = null;
  s.next -= dt;
  if (s.next <= 0) {
    s.next = STRIKE_MIN + rnd() * (STRIKE_MAX - STRIKE_MIN);
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    let t = 0;
    for (let i = 0; i < n; i++) { s.pulses.push({ at: t, len: 0.05 + rnd() * 0.04, peak: 0.6 + rnd() * 0.4 }); t += 0.08 + rnd() * 0.14; }
    s.strike = { delay: 0.4 + rnd() * 2.6 };   // 0.4 s is a strike on the next block, 3 s one across the bay
  }
  let flash = 0;
  for (let i = s.pulses.length - 1; i >= 0; i--) {
    const p = s.pulses[i];
    p.at -= dt;
    if (p.at > 0) continue;                                  // not yet
    const age = -p.at;
    if (age > p.len) { s.pulses.splice(i, 1); continue; }
    flash = Math.max(flash, p.peak * (1 - age / p.len));    // sharp on, linear off
  }
  return flash;
}
