import { Mesh } from '../../lib/mesh.mjs';

/** Sheffield-style cycle stands. */

export const tags = ["street","kerb","clutter"];

export default () => {
  const m = new Mesh();
  m.repeatX(4, 0.8, (x) => {
    m.box('metal_galv', { size: [0.06, 0.75, 0.06], pos: [x - 0.28, 0.375, 0] });
    m.box('metal_galv', { size: [0.06, 0.75, 0.06], pos: [x + 0.28, 0.375, 0] });
    m.box('metal_galv', { size: [0.62, 0.06, 0.06], pos: [x, 0.75, 0] });
  });
  return m;
};
