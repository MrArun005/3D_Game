import * as THREE from 'three';
import { CELL, ROAD_HALF, LANE } from './metrics.js';

/* Traffic signals.
   The phase is a pure function of the junction's grid coordinates and the
   clock — no per-junction state to store, nothing to keep in sync, and a cell
   that streams out and back in resumes on exactly the phase it should be on. */

export const GREEN = 9.0, AMBER = 2.5, ALL_RED = 1.5;
const HALF = GREEN + AMBER + ALL_RED;
export const CYCLE = HALF * 2;

/** Axis 0 runs along X, axis 1 runs along Z. */
export function signalState(i, j, axis, t) {
  // desync neighbouring junctions, but keep it deterministic
  const h = Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
  const p = (((t + h * CYCLE) % CYCLE) + CYCLE) % CYCLE;
  const firstHalf = p < HALF;
  const local = firstHalf ? p : p - HALF;
  const greenAxis = firstHalf ? 0 : 1;
  if (axis !== greenAxis) return 'red';
  if (local < GREEN) return 'green';
  if (local < GREEN + AMBER) return 'amber';
  return 'red';
}

/** Where a car on this approach must stop. */
export const STOP_LINE = ROAD_HALF + 1.2;

export const LAMP_COLOURS = {
  red:   [0xff2a1c, 0x2a0a08, 0x0a1408],
  amber: [0x2a0a08, 0xffa61e, 0x0a1408],
  green: [0x2a0a08, 0x2a1c08, 0x2bd85a],
};

/** Three stacked lenses; the head geometry itself comes from props.js. */
export function buildLampGeometry() {
  return new THREE.SphereGeometry(0.11, 8, 6);
}

/**
 * World placement of the four signal heads at a junction, one per approach,
 * each mounted over the lane it governs.
 */
export function signalHeads(ox, oz) {
  const out = [];
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const d of dirs) {
    const axis = d[0] !== 0 ? 0 : 1;
    const r = [-d[1], d[0]];                       // right of travel
    // the head hangs over the approach, on the near side of the junction
    const bx = ox - d[0] * (ROAD_HALF + 0.6) + r[0] * (LANE * 1.1);
    const bz = oz - d[1] * (ROAD_HALF + 0.6) + r[1] * (LANE * 1.1);
    const yaw = Math.atan2(-d[1], d[0]);
    out.push({ axis, dir: d, x: bx, z: bz, yaw });
  }
  return out;
}
