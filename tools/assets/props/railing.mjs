import { Mesh } from '../../lib/mesh.mjs';

/** Pedestrian guard railing. */

export const tags = ["boundary","kerb"];

export default () => {
  const m = new Mesh();
  m.box('metal_painted', { size: [2.4, 0.06, 0.06], pos: [0, 1.05, 0] });
  m.box('metal_painted', { size: [2.4, 0.05, 0.05], pos: [0, 0.55, 0] });
  m.repeatX(2, 2.3, (x) => m.box('metal_painted', { size: [0.07, 1.1, 0.07], pos: [x, 0.55, 0] }));
  m.repeatX(8, 0.3, (x) => m.box('metal_painted', { size: [0.03, 1.0, 0.03], pos: [x, 0.53, 0] }));
  return m;
};
