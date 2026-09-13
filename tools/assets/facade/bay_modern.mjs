import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_COMM, opening, punched } from '../../lib/facade-parts.mjs';

/** Little Tokyo commercial bay with asymmetric glazing and projecting ceramic fins. */

export const tags = ['bay', 'commercial', 'tokyo'];

export default () => {
  const m = new Mesh(), h = H_COMM;
  punched(m, 'plaster_worn', { w: BAY, h, ow: 2.76, oh: 2.12, oy: 0.48 });
  opening(m, { w: 2.76, h: 2.12, y: 0.48, glass: 'glass_curtain', frame: 'alloy_polished', sill: 'stone_dressed' });
  // A deliberately off-centre pair of fins creates a recognisable vertical
  // rhythm and catches low-angle light better than a flat window grid.
  for (const x of [-1.46, -0.32, 1.46]) {
    m.box('metal_painted', { size: [0.12, h - 0.18, 0.30], pos: [x, h / 2, 0.03] });
  }
  m.box('concrete_precast', { size: [BAY, 0.18, 0.24], pos: [0, h - 0.16, 0.02] });
  m.box('metal_painted', { size: [2.54, 0.06, 0.16], pos: [0.12, 1.55, 0.01] });
  return m;
};
