import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_GROUND, punched } from '../../lib/facade-parts.mjs';

/** Roller-shutter opening for service and industrial frontages. */

export const tags = ["ground","industrial","service"];

export default () => {
  const m = new Mesh(), h = H_GROUND;
  punched(m, 'concrete_cast', { w: BAY, h, ow: 2.9, oh: 3.0, oy: 0 });
  m.box('metal_galv', { size: [2.9, 3.0, 0.08], pos: [0, 1.5, -0.14] });
  m.repeatX(6, 0.5, (_, i) => m.box('metal_galv', { size: [2.9, 0.05, 0.13], pos: [0, 0.35 + i * 0.5, -0.1] }));
  return m;
};
