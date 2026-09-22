/** Every dimension in the city, in metres. Change CELL and the grid follows. */
export const CELL = 130;              // block pitch, intersection to intersection
export const LANE = 3.5;
export const CARRIAGE = LANE * 4;     // two lanes each way
export const PARKING = 2.2;           // kerbside bay
export const ROAD_HALF = CARRIAGE / 2 + PARKING;
export const WALK_W = 4.0;
export const CORR_HALF = ROAD_HALF + WALK_W;
export const KERB_H = 0.15;
export const BLOCK = CELL - CORR_HALF * 2;

/**
 * §D  Analytic collision.
 * In a grid city "am I on tarmac?" is arithmetic, not a mesh query. Returns
 * metres OUTSIDE the kerb line: <= 0 anywhere on asphalt.
 */
/* The body swaps; the name, the signature and the units do not. Four callers
   depend on this — hull collision, tyre grip, the chase camera un-clipping
   itself, and the traffic stop-line gates — and none of them need to know the
   world stopped being arithmetic and became a document. */
let DISTRICT = null;
export function useDistrict(d) { DISTRICT = d; }
export function hasDistrict() { return !!DISTRICT; }

export function roadDepth(x, z) {
  if (DISTRICT) return DISTRICT.roadDepth(x, z);
  const dx = Math.abs((((x % CELL) + CELL * 1.5) % CELL) - CELL / 2);
  const dz = Math.abs((((z % CELL) + CELL * 1.5) % CELL) - CELL / 2);
  return Math.min(dx - ROAD_HALF, dz - ROAD_HALF);
}

/* Off the pavement the ground is whatever block the wheel is on (2026-09-22):
   park grass slides but rolls, yards / lots / vacant plots are gravel and dirt
   that grip better and drag less than the old catch-all, and anything else off
   the plan keeps the old rough value. Only consulted off the pavement, so the
   on-road cost is unchanged. */
const GROUND = {
  park:   { grip: 0.52, drag: 11.0 },
  yard:   { grip: 0.60, drag: 8.0 },
  lot:    { grip: 0.62, drag: 7.0 },
  vacant: { grip: 0.56, drag: 9.5 },
};
const ROUGH = { grip: 0.45, drag: 16.0 };

export function surfaceAt(x, z) {
  const d = roadDepth(x, z);
  if (d <= 0) return { grip: 1.0, drag: 0, kerb: 0, off: 0 };
  if (d < WALK_W) return { grip: 0.62, drag: 5.5, kerb: 1, off: d };
  const g = GROUND[DISTRICT?.blockTypeAt?.(x, z)] ?? ROUGH;
  return { grip: g.grip, drag: g.drag, kerb: 1, off: d };
}


/**
 * Height of the driveable surface. The road sits at 0 and the pavement a kerb
 * higher, with the kerb face itself ramped over ~0.35m rather than left as a
 * cliff — a vertical step makes a raycast wheel spike its spring and launch the
 * car. Real kerbs have a radius; this is that radius.
 */
const KERB_RAMP = 0.35;

export function groundHeightAt(x, z) {
  // bridges and the expressway sit above everything else the road does
  const lift = DISTRICT ? DISTRICT.elevationAt(x, z) : 0;
  const d = roadDepth(x, z);          // <=0 on tarmac, grows off it
  if (d <= 0) return lift;
  if (d >= KERB_RAMP) return lift + KERB_H;
  const t = d / KERB_RAMP;
  return lift + KERB_H * t * t * (3 - 2 * t);   // smoothstep up the kerb face
}
