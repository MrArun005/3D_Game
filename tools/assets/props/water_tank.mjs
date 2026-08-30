import { Mesh } from '../../lib/mesh.mjs';

/** Timber water tank on a steel frame. Reads as a landmark on a skyline. */

export const tags = ["roof","plant","landmark"];

export default () => {
  const m = new Mesh();
  m.repeatX(2, 1.7, (x) => {
    m.box('metal_rust', { size: [0.13, 2.6, 0.13], pos: [x, 1.3, -0.85] });
    m.box('metal_rust', { size: [0.13, 2.6, 0.13], pos: [x, 1.3, 0.85] });
  });
  m.cylinder('timber_bare', { r: 1.05, h: 2.2, seg: 14, pos: [0, 2.6, 0] });
  m.cylinder('metal_galv', { r: 1.12, h: 0.5, seg: 14, pos: [0, 4.8, 0] });
  return m;
};
