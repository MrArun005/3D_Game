import { Mesh } from '../../lib/mesh.mjs';

/** Piered park entrance with iron gates. */

export const tags = ["park","entrance","landmark"];

export default () => {
  const m = new Mesh();
  for (const x of [-2.3, 2.3]) {
    m.box('stone_dressed', { size: [0.62, 2.9, 0.62], pos: [x, 1.45, 0] });
    m.box('stone_dressed', { size: [0.76, 0.2, 0.76], pos: [x, 2.98, 0] });
    m.cylinder('stone_dressed', { r: [0.24, 0.06], h: 0.4, seg: 8, pos: [x, 3.08, 0] });
  }
  for (const x of [-1.1, 1.1]) {
    m.box('metal_painted', { size: [1.9, 0.07, 0.05], pos: [x, 1.85, 0] });
    m.box('metal_painted', { size: [1.9, 0.06, 0.05], pos: [x, 0.35, 0] });
    m.repeatX(6, 0.32, (dx) => m.box('metal_painted', { size: [0.05, 1.6, 0.05], pos: [x + dx, 1.05, 0] }));
  }
  return m;
};
