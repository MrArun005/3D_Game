import { Mesh } from '../../lib/mesh.mjs';

/** Rear fire escape: platform, rails and a run of stair down to the yard. */

export const tags = ["vertical","industrial","rear"];

export default () => {
  const m = new Mesh();
  const PLAT = 3.0;                    // platform height above the yard

  // stringers, aligned to the tread run: the treads go from (0.32, -0.42) up
  // to (2.80, -2.74), so the stringer is that vector, not an eyeballed angle
  for (const x of [-1.08, -0.32]) {
    m.box('metal_rust', { size: [0.07, 3.7, 0.16], pos: [x, 1.56, -1.58], rot: [-0.762, 0, 0] });
  }
  for (let i = 0; i < 9; i++) {
    m.box('metal_rust', { size: [0.76, 0.045, 0.27], pos: [-0.7, 0.32 + i * 0.31, -0.42 - i * 0.29] });
  }
  // handrail following the same rake
  for (const x of [-1.08, -0.32]) {
    m.box('metal_rust', { size: [0.05, 3.5, 0.05], pos: [x, 2.42, -1.42], rot: [-0.762, 0, 0] });
    for (let i = 0; i < 3; i++) {
      m.box('metal_rust', { size: [0.05, 0.95, 0.05], pos: [x, 0.9 + i * 0.92, -0.95 - i * 0.86] });
    }
  }

  m.box('metal_rust', { size: [2.4, 0.07, 1.2], pos: [0, PLAT, -0.6] });
  m.repeatX(9, 0.28, (x) => m.box('metal_rust', { size: [0.04, 0.04, 1.2], pos: [x, PLAT + 0.04, -0.6] }));

  // guard rail round the open sides
  for (const [px, pz, sx, sz] of [[0, -1.2, 2.4, 0.05], [-1.2, -0.6, 0.05, 1.2], [1.2, -0.6, 0.05, 1.2]]) {
    m.box('metal_rust', { size: [sx, 0.05, sz], pos: [px, PLAT + 1.05, pz] });
    m.box('metal_rust', { size: [sx * 0.98, 0.04, sz * 0.98], pos: [px, PLAT + 0.58, pz] });
  }
  for (const [px, pz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 0], [1.2, 0]]) {
    m.box('metal_rust', { size: [0.06, 1.1, 0.06], pos: [px, PLAT + 0.55, pz] });
  }
  return m;
};
