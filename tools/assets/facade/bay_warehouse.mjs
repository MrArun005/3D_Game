import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_COMM, opening, punched } from '../../lib/facade-parts.mjs';

/** Industrial bay: wide steel-mullioned glazing under a steel lintel. */

export const tags = ["bay","industrial","period"];

export default () => {
  const m = new Mesh(), h = H_COMM + 0.6;
  punched(m, 'brick_red', { w: BAY, h, ow: 2.7, oh: 2.1, oy: 0.8 });
  opening(m, { w: 2.7, h: 2.1, y: 0.8, glass: 'glass_curtain', frame: 'metal_galv' });
  m.repeatX(3, 0.9, (x) => m.box('metal_galv', { size: [0.07, 2.1, 0.1], pos: [x, 0.8 + 1.05, -0.06] }));
  m.box('metal_rust', { size: [3.0, 0.18, 0.16], pos: [0, 0.8 + 2.1 + 0.09, 0.01] }); // steel lintel
  return m;
};
