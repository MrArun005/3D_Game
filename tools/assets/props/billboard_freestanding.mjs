import { Mesh } from '../../lib/mesh.mjs';

/** Freestanding billboard on twin posts. */

export const tags = ["signage","street"];

export default () => {
  const m = new Mesh();
  for (const x of [-2.2, 2.2]) {
    m.box('concrete_cast', { size: [0.8, 0.3, 0.8], pos: [x, 0.15, 0] });
    m.box('metal_galv', { size: [0.28, 5.0, 0.28], pos: [x, 2.5, 0] });
  }
  m.box('metal_galv', { size: [6.6, 3.4, 0.2], pos: [0, 5.4, 0] });
  m.box('plastic_signage', { size: [6.3, 3.15, 0.06], pos: [0, 5.4, 0.13] });
  m.box('metal_galv', { size: [6.8, 0.14, 0.6], pos: [0, 7.15, 0.2] });
  return m;
};
