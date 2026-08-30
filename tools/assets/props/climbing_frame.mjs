import { Mesh } from '../../lib/mesh.mjs';

/** Cube climbing frame with monkey bars. */

export const tags = ["park","playground"];

export default () => {
  const m = new Mesh();
  for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
    m.box('metal_painted', { size: [0.09, 2.4, 0.09], pos: [x, 1.2, z] });
  }
  for (const y of [1.2, 2.4]) {
    for (const z of [-1.5, 1.5]) m.box('metal_painted', { size: [3.1, 0.07, 0.07], pos: [0, y, z] });
    for (const x of [-1.5, 1.5]) m.box('metal_painted', { size: [0.07, 0.07, 3.1], pos: [x, y, 0] });
  }
  m.repeatX(4, 0.75, (x) => m.box('metal_galv', { size: [0.05, 0.05, 3.0], pos: [x, 2.4, 0] }));
  m.box('plastic_signage', { size: [1.4, 0.08, 1.4], pos: [0, 1.2, 0] });
  return m;
};
