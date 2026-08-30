import { Mesh } from '../../lib/mesh.mjs';

/** Full-size goal frame. */

export const tags = ["park","sport"];

export default () => {
  const m = new Mesh();
  for (const x of [-3.66, 3.66]) m.cylinder('metal_painted', { r: 0.06, h: 2.44, seg: 8, pos: [x, 0, 0] });
  m.box('metal_painted', { size: [7.44, 0.12, 0.12], pos: [0, 2.5, 0] });
  for (const x of [-3.66, 3.66]) m.box('metal_painted', { size: [0.06, 2.6, 0.06], pos: [x, 1.3, -1.4], rot: [0.5, 0, 0] });
  return m;
};
