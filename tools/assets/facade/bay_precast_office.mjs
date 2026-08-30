import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_COMM, opening, punched } from '../../lib/facade-parts.mjs';

/** Precast panel bay with a punched window and a cast sill. */

export const tags = ["bay","commercial","modern"];

export default () => {
  const m = new Mesh(), h = H_COMM;
  punched(m, 'concrete_precast', { w: BAY, h, ow: 2.4, oh: 1.7, oy: 0.95 });
  opening(m, { w: 2.4, h: 1.7, y: 0.95, glass: 'glass_curtain', sill: 'concrete_precast' });
  m.box('concrete_precast', { size: [BAY, 0.12, 0.1], pos: [0, h - 0.06, 0.02] });
  return m;
};
