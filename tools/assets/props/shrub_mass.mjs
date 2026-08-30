import { Mesh } from '../../lib/mesh.mjs';

/** Low shrub mass. Clusters at mixed sizes so a group does not read as one shape. */

export const tags = ["park","green"];

const R = (s) => { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

export default () => {
  const m = new Mesh();
  const r = R(41);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.7;
    const rad = i === 0 ? 0 : 0.22 + r() * 0.3;
    const s = i === 0 ? 0.95 : 0.44 + r() * 0.4;
    m.box('foliage', {
      size: [s, s * 0.86, s * 0.94],
      pos: [Math.cos(a) * rad, s * 0.42 + r() * 0.08, Math.sin(a) * rad],
      rot: [r() * 0.25, r() * 2, r() * 0.25], bevel: s * 0.28,
    });
  }
  return m;
};
