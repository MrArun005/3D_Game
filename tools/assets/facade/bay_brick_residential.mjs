import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_RES, opening, punched } from '../../lib/facade-parts.mjs';

/** Brick bay, sash proportions, stone sill and lintel. */

export const tags = ["bay","residential","period"];

export default () => {
  const m = new Mesh(), h = H_RES;
  punched(m, 'brick_red', { w: BAY, h, ow: 1.3, oh: 1.55, oy: 0.85 });
  opening(m, { w: 1.3, h: 1.55, y: 0.85, glass: 'glass_shop', sill: 'stone_dressed', frame: 'timber_painted' });
  m.box('stone_dressed', { size: [1.6, 0.14, 0.1], pos: [0, 0.85 + 1.55 + 0.07, 0.02] }); // lintel
  return m;
};
