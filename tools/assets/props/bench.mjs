import { Mesh } from '../../lib/mesh.mjs';

/** Slatted street bench on cast ends. */

export const tags = ["street","kerb","seating"];

export default () => {
  const m = new Mesh();
  for (const x of [-0.7, 0.7]) {
    m.box('metal_painted', { size: [0.08, 0.42, 0.5], pos: [x, 0.21, 0] });
    m.box('metal_painted', { size: [0.08, 0.55, 0.08], pos: [x, 0.68, -0.2] });
  }
  m.repeatX(4, 0.14, (z) => m.box('timber_bare', { size: [1.8, 0.05, 0.11], pos: [0, 0.45, z] }));
  m.box('timber_bare', { size: [1.8, 0.42, 0.05], pos: [0, 0.72, -0.22] });
  return m;
};
