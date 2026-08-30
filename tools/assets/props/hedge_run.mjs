import { Mesh } from '../../lib/mesh.mjs';

/** Clipped hedge over a low kerb. Blocks jitter so a long run does not read as one extrusion. */

export const tags = ["park","green","boundary"];

const R = (s) => { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

export default () => {
  const m = new Mesh();
  const r = R(17);
  m.box('kerb_stone', { size: [4.0, 0.16, 0.9], pos: [0, 0.08, 0] });
  for (let i = 0; i < 7; i++) {
    const h = 1.02 + r() * 0.16;
    m.box('foliage', {
      size: [0.62, h, 0.72 + r() * 0.1],
      pos: [i * 0.57 - 1.71, 0.16 + h / 2, (r() - 0.5) * 0.06],
      rot: [0, (r() - 0.5) * 0.14, 0],
      bevel: 0.09,
    });
  }
  return m;
};
