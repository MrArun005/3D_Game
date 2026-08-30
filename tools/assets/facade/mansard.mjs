import { Mesh } from '../../lib/mesh.mjs';
import { BAY } from '../../lib/facade-parts.mjs';

/** Mansard roof storey: steep slate slope, flat deck behind, one dormer. */

export const tags = ["topper","period","roof"];

export default () => {
  const m = new Mesh();
  m.box('stone_dressed', { size: [BAY, 0.2, 0.55], pos: [0, 0.1, 0.02] });          // eaves band
  m.wedge('metal_galv', { size: [BAY, 2.1, 1.5], pos: [0, 0.2, -0.75], flip: true }); // the slope
  m.box('metal_galv', { size: [BAY, 0.12, 1.6], pos: [0, 2.24, -2.3] });            // deck behind

  // dormer, cut into the slope
  m.box('timber_painted', { size: [0.95, 1.0, 0.9], pos: [0, 0.95, -0.62] });
  m.box('glass_shop', { size: [0.66, 0.72, 0.04], pos: [0, 1.0, -0.16] });
  m.wedge('metal_galv', { size: [1.05, 0.28, 1.0], pos: [0, 1.45, -0.62], flip: true });
  return m;
};
