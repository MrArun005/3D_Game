import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_RES, opening, punched } from '../../lib/facade-parts.mjs';

/** Tall period brick bay with a string course at head height. */

export const tags = ["bay","residential","period"];

export default () => {
  const m = new Mesh(), h = H_RES + 0.4;
  punched(m, 'brick_painted', { w: BAY, h, ow: 1.15, oh: 2.0, oy: 0.7 });
  opening(m, { w: 1.15, h: 2.0, y: 0.7, sill: 'stone_dressed', frame: 'timber_painted' });
  m.box('stone_dressed', { size: [BAY, 0.16, 0.12], pos: [0, h - 0.3, 0.03] });  // string course
  return m;
};
