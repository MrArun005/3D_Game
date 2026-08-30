import { Mesh } from '../../lib/mesh.mjs';

/** Overhead sign gantry for arterial junctions. */

export const tags = ["street","junction","arterial"];

export default () => {
  const m = new Mesh();
  for (const x of [-4.2, 4.2]) {
    m.box('concrete_cast', { size: [0.7, 0.3, 0.7], pos: [x, 0.15, 0] });
    m.cylinder('metal_galv', { r: 0.16, h: 6.2, seg: 10, pos: [x, 0.3, 0] });
  }
  m.box('metal_galv', { size: [8.8, 0.22, 0.22], pos: [0, 6.4, 0] });
  m.box('metal_galv', { size: [8.8, 0.22, 0.22], pos: [0, 5.5, 0] });
  m.repeatX(7, 1.3, (x) => m.box('metal_galv', { size: [0.1, 0.9, 0.1], pos: [x, 5.95, 0] }));
  m.box('plastic_signage', { size: [4.4, 1.7, 0.1], pos: [-1.8, 5.9, 0.18] });
  m.box('plastic_signage', { size: [2.6, 1.2, 0.1], pos: [2.4, 5.9, 0.18] });
  return m;
};
