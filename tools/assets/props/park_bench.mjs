import { Mesh } from '../../lib/mesh.mjs';

/** Park bench on stone ends. */

export const tags = ["park","seating"];

export default () => {
  const m = new Mesh();
  for (const x of [-0.78, 0.78]) {
    m.box('stone_dressed', { size: [0.14, 0.44, 0.56], pos: [x, 0.22, 0] });
    m.box('timber_bare', { size: [0.07, 0.6, 0.07], pos: [x, 0.74, -0.22] });
  }
  m.repeatX(5, 0.13, (z) => m.box('timber_bare', { size: [1.95, 0.05, 0.1], pos: [0, 0.46, z] }));
  m.repeatX(3, 0.16, (y) => m.box('timber_bare', { size: [1.95, 0.12, 0.05], pos: [0, 0.72 + y, -0.24] }));
  return m;
};
