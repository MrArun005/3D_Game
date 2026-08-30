import { Mesh } from '../../lib/mesh.mjs';

/** Bus shelter: glazed rear, perch seat, timetable panel. */

export const tags = ["street","kerb","transit"];

export default () => {
  const m = new Mesh();
  m.repeatX(2, 3.2, (x) => {
    m.box('metal_galv', { size: [0.1, 2.5, 0.1], pos: [x, 1.25, -0.6] });
    m.box('metal_galv', { size: [0.1, 2.5, 0.1], pos: [x, 1.25, 0.6] });
  });
  m.box('metal_galv', { size: [3.6, 0.12, 1.5], pos: [0, 2.56, 0] });
  m.box('glass_shop', { size: [3.3, 2.2, 0.04], pos: [0, 1.35, -0.62] });
  m.box('glass_shop', { size: [0.04, 2.2, 1.1], pos: [-1.68, 1.35, 0] });
  m.box('timber_bare', { size: [2.6, 0.08, 0.42], pos: [0, 0.62, -0.36] });
  m.box('metal_galv', { size: [2.6, 0.4, 0.06], pos: [0, 0.85, -0.56] });
  m.box('plastic_signage', { size: [0.72, 1.1, 0.06], pos: [1.5, 1.5, 0.62] });
  return m;
};
