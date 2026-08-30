import { Mesh } from '../../lib/mesh.mjs';

/** Kerbed planting bed, mounded soil, mixed low planting. */

export const tags = ["park","green"];

const R = (s) => { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

export default () => {
  const m = new Mesh();
  const r = R(23);
  // edging as four kerb runs rather than one slab, so the corners read.
  // profile() extrudes along X, so the two side runs are boxes with the same
  // section rather than a rotated extrusion.
  const SECTION = [[-0.09, 0], [0.09, 0], [0.09, 0.2], [0.06, 0.24], [-0.09, 0.24]];
  for (const pz of [-0.83, 0.83]) {
    m.profile('kerb_stone', { pts: SECTION, length: 2.78, pos: [0, 0, pz], rot: pz > 0 ? Math.PI : 0 });
  }
  for (const px of [-1.3, 1.3]) {
    m.box('kerb_stone', { size: [0.18, 0.23, 1.48], pos: [px, 0.115, 0], bevel: 0.02 });
  }
  m.box('grass', { size: [2.5, 0.22, 1.5], pos: [0, 0.11, 0] });
  for (let i = 0; i < 9; i++) {
    const s = 0.24 + r() * 0.22;
    m.box('foliage', {
      size: [s, s * 0.9, s * 0.9],
      pos: [(r() - 0.5) * 2.1, 0.22 + s * 0.42, (r() - 0.5) * 1.15],
      rot: [0, r() * 2, 0], bevel: 0.03,
    });
  }
  return m;
};
