import { Mesh } from '../../lib/mesh.mjs';

/** Guyed aerial mast. Landmark silhouette. */

export const tags = ["roof","plant","landmark"];

export default () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [1.0, 0.28, 1.0], pos: [0, 0.14, 0] });
  m.cylinder('metal_galv', { r: [0.11, 0.06], h: 6.5, seg: 8, pos: [0, 0.28, 0] });
  for (const [y, w] of [[3.4, 1.5], [4.4, 1.2], [5.3, 0.9]]) {
    m.box('metal_galv', { size: [w, 0.05, 0.05], pos: [0, y, 0] });
    m.box('metal_galv', { size: [0.05, 0.05, w * 0.7], pos: [0, y - 0.12, 0] });
  }
  m.box('plastic_signage', { size: [0.16, 0.16, 0.16], pos: [0, 6.85, 0] });
  return m;
};
