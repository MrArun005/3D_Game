import { Mesh } from '../../lib/mesh.mjs';

/** Galvanised palisade fence panel. */

export const tags = ["boundary","industrial"];

export default () => {
  const m = new Mesh();
  m.box('metal_galv', { size: [0.09, 2.0, 0.09], pos: [-1.45, 1.0, 0] });
  m.box('metal_galv', { size: [0.09, 2.0, 0.09], pos: [1.45, 1.0, 0] });
  m.box('metal_galv', { size: [3.0, 0.06, 0.05], pos: [0, 1.92, 0] });
  m.box('metal_galv', { size: [3.0, 0.06, 0.05], pos: [0, 0.12, 0] });
  m.repeatX(14, 0.2, (x) => m.box('metal_galv', { size: [0.035, 1.9, 0.035], pos: [x, 1.0, 0] }));
  return m;
};
