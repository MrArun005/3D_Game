import { Mesh } from '../../lib/mesh.mjs';

/** Covered market stall. */

export const tags = ["street","spillout","market"];

export default () => {
  const m = new Mesh();
  for (const [x, z] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]]) {
    m.box('metal_galv', { size: [0.07, 2.3, 0.07], pos: [x, 1.15, z] });
  }
  m.box('fabric_awning', { size: [3.4, 0.1, 1.2], pos: [0, 2.42, -0.55], rot: [-0.3, 0, 0] });
  m.box('fabric_awning', { size: [3.4, 0.1, 1.2], pos: [0, 2.42, 0.55], rot: [0.3, 0, 0] });
  m.box('timber_bare', { size: [3.2, 0.07, 1.1], pos: [0, 0.85, 0] });
  m.box('timber_bare', { size: [3.2, 0.5, 0.06], pos: [0, 0.6, -0.52] });
  m.box('plastic_signage', { size: [1.4, 0.3, 0.05], pos: [0, 2.15, 1.0] });
  return m;
};
