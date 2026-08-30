import { Mesh } from '../../lib/mesh.mjs';

/** Recessed quay ladder. */

export const tags = ["harbour","edge"];

export default () => {
  const m = new Mesh();
  m.box('metal_rust', { size: [0.06, 2.6, 0.06], pos: [-0.24, 1.3, 0] });
  m.box('metal_rust', { size: [0.06, 2.6, 0.06], pos: [0.24, 1.3, 0] });
  for (let i = 0; i < 8; i++) m.box('metal_rust', { size: [0.54, 0.04, 0.04], pos: [0, 0.2 + i * 0.32, 0] });
  return m;
};
