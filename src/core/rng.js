/** Deterministic 32-bit PRNG. Same seed, same city, every reload. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Painter-scoped RNG. Texture painters reseed this so their output is stable. */
export const painter = { rand: mulberry32(1) };
export const seed = (n) => { painter.rand = mulberry32(n); };
export const rp = () => painter.rand();
export const rr = (a, b) => a + painter.rand() * (b - a);
export const ri = (a, b) => Math.floor(a + painter.rand() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(painter.rand() * arr.length)];
