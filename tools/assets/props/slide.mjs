import { Mesh } from '../../lib/mesh.mjs';

/** Platform slide with a step ladder. */

export const tags = ["park","playground"];

export default () => {
  const m = new Mesh();
  m.box('metal_painted', { size: [1.1, 1.9, 1.1], pos: [0, 0.95, -1.4], skip: ['py', 'ny'] });
  m.box('timber_painted', { size: [1.2, 0.09, 1.2], pos: [0, 1.9, -1.4] });
  for (let i = 0; i < 6; i++) m.box('metal_galv', { size: [0.9, 0.05, 0.06], pos: [0, 0.28 + i * 0.3, -2.0] });
  m.box('plastic_signage', { size: [0.8, 0.07, 3.2], pos: [0, 1.18, 0.35], rot: [0.5, 0, 0] });
  m.box('plastic_signage', { size: [0.07, 0.3, 3.2], pos: [-0.42, 1.3, 0.35], rot: [0.5, 0, 0] });
  m.box('plastic_signage', { size: [0.07, 0.3, 3.2], pos: [0.42, 1.3, 0.35], rot: [0.5, 0, 0] });
  return m;
};
