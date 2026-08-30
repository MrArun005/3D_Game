import { Mesh } from '../../lib/mesh.mjs';

/** Picnic table with attached benches. */

export const tags = ["park","seating"];

export default () => {
  const m = new Mesh();
  m.box('timber_bare', { size: [1.9, 0.07, 0.85], pos: [0, 0.74, 0] });
  for (const z of [-0.72, 0.72]) m.box('timber_bare', { size: [1.9, 0.06, 0.3], pos: [0, 0.45, z] });
  for (const x of [-0.75, 0.75]) {
    m.box('timber_bare', { size: [0.08, 0.85, 0.1], pos: [x, 0.42, -0.55], rot: [0.45, 0, 0] });
    m.box('timber_bare', { size: [0.08, 0.85, 0.1], pos: [x, 0.42, 0.55], rot: [-0.45, 0, 0] });
  }
  return m;
};
