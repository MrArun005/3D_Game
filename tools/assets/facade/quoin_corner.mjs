import { Mesh } from '../../lib/mesh.mjs';

/** Alternating stone quoins for a period building corner. */

export const tags = ["vertical","corner","period"];

export default () => {
  const m = new Mesh();
  for (let i = 0; i < 8; i++) {
    const w = i % 2 ? 0.62 : 0.44;
    m.box('stone_dressed', { size: [w, 0.4, 0.42], pos: [w / 2 - 0.31, 0.2 + i * 0.4, -0.21] });
  }
  return m;
};
