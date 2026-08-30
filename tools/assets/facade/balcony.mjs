import { Mesh } from '../../lib/mesh.mjs';

/** Cantilevered slab balcony with a glazed balustrade. */

export const tags = ["vertical","residential"];

export default () => {
  const m = new Mesh();
  m.box('concrete_precast', { size: [2.6, 0.16, 1.0], pos: [0, 0.08, -0.5] });
  m.box('metal_painted', { size: [2.6, 0.06, 0.06], pos: [0, 1.05, -0.97] });
  m.repeatX(9, 0.3, (x) => m.box('metal_painted', { size: [0.04, 0.98, 0.04], pos: [x, 0.55, -0.97] }));
  m.box('metal_painted', { size: [0.05, 1.0, 0.98], pos: [-1.28, 0.55, -0.5] });
  m.box('metal_painted', { size: [0.05, 1.0, 0.98], pos: [1.28, 0.55, -0.5] });
  return m;
};
