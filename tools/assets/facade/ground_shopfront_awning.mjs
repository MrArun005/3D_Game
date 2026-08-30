import { Mesh } from '../../lib/mesh.mjs';
import ground_shopfront from './ground_shopfront.mjs';
import { BAY } from '../../lib/facade-parts.mjs';

/** Shopfront with a fabric awning on struts. */

export const tags = ["ground","retail"];

export default () => {
  const m = ground_shopfront();
  m.box('fabric_awning', { size: [BAY - 0.4, 0.1, 1.5], pos: [0, 3.05, -0.78], rot: [0.22, 0, 0] });
  m.box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [-BAY / 2 + 0.35, 2.85, -1.4] });
  m.box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [BAY / 2 - 0.35, 2.85, -1.4] });
  return m;
};
