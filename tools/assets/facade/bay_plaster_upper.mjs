import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_RES, opening, punched } from '../../lib/facade-parts.mjs';

/** Plain rendered upper bay. The filler between the ones with character. */

export const tags = ["bay","residential","mixed"];

export default () => {
  const m = new Mesh(), h = H_RES;
  punched(m, 'plaster_worn', { w: BAY, h, ow: 1.5, oh: 1.6, oy: 0.8 });
  opening(m, { w: 1.5, h: 1.6, y: 0.8, sill: 'stone_dressed', frame: 'timber_painted' });
  return m;
};
