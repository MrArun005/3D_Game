import { Mesh } from '../../lib/mesh.mjs';

/** Two-bay swing frame. */

export const tags = ["park","playground"];

export default () => {
  const m = new Mesh();
  for (const x of [-1.9, 1.9]) {
    m.box('metal_painted', { size: [0.1, 2.6, 0.1], pos: [x, 1.3, -0.9], rot: [-0.32, 0, 0] });
    m.box('metal_painted', { size: [0.1, 2.6, 0.1], pos: [x, 1.3, 0.9], rot: [0.32, 0, 0] });
  }
  m.box('metal_painted', { size: [4.2, 0.11, 0.11], pos: [0, 2.5, 0] });
  for (const x of [-0.95, 0.95]) {
    m.box('metal_galv', { size: [0.04, 1.75, 0.04], pos: [x - 0.22, 1.6, 0] });
    m.box('metal_galv', { size: [0.04, 1.75, 0.04], pos: [x + 0.22, 1.6, 0] });
    m.box('plastic_signage', { size: [0.56, 0.07, 0.2], pos: [x, 0.7, 0] });
  }
  return m;
};
