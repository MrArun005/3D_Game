import { Mesh } from '../../lib/mesh.mjs';

/** Stacked containers. One draw call for a whole yard block. */

export const tags = ["harbour","industrial"];

export default () => {
  const m = new Mesh();
  const one = (x, y, z) => m.box('metal_rust', { size: [6.05, 2.59, 2.44], pos: [x, y + 1.295, z] });
  one(0, 0, 0); one(0, 2.62, 0); one(0, 5.24, 0);
  one(0, 0, 2.55); one(0, 2.62, 2.55);
  one(0, 0, -2.55);
  return m;
};
