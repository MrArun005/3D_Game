import { Mesh } from '../../lib/mesh.mjs';

/** Louvred screen that hides rooftop plant. */

export const tags = ["roof","plant"];

export default () => {
  const m = new Mesh();
  m.repeatX(2, 3.6, (x) => m.box('metal_galv', { size: [0.1, 2.2, 0.1], pos: [x, 1.1, -1.4] }));
  m.repeatX(2, 3.6, (x) => m.box('metal_galv', { size: [0.1, 2.2, 0.1], pos: [x, 1.1, 1.4] }));
  for (const z of [-1.4, 1.4]) {
    m.box('metal_galv', { size: [3.7, 2.1, 0.05], pos: [0, 1.15, z] });
  }
  m.box('metal_galv', { size: [0.05, 2.1, 2.8], pos: [-1.85, 1.15, 0] });
  m.box('metal_galv', { size: [0.05, 2.1, 2.8], pos: [1.85, 1.15, 0] });
  return m;
};
