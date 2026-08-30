import { Mesh } from '../../lib/mesh.mjs';

/**
 * Broadleaf street tree. Tapered trunk, three orders of branch, canopy built
 * from overlapping clusters sized by their distance from the crown centre.
 *
 * Still not authored art — a real tree needs alpha-cut leaf cards — but it is
 * a tree rather than a box on a stick, and it holds up in the mid-ground.
 */

export const tags = ["park","green","tree"];

const R = (s) => { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

export default () => {
  const m = new Mesh();
  const r = R(97);

  m.cylinder('bark', { r: [0.26, 0.15], h: 2.9, seg: 10 });

  // primary limbs off the trunk, then a fork on each
  const limbs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r() * 0.6;
    const lean = 0.62 + r() * 0.22;
    const len = 1.25 + r() * 0.4;
    const x = Math.cos(a) * len * 0.5, z = Math.sin(a) * len * 0.5;
    m.box('bark', { size: [0.14, len, 0.14], pos: [x, 2.9 + len * 0.28, z], rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean] });
    const tipX = Math.cos(a) * len * 0.95, tipZ = Math.sin(a) * len * 0.95;
    limbs.push([tipX, 3.5 + r() * 0.4, tipZ]);
    m.box('bark', { size: [0.09, len * 0.6, 0.09], pos: [tipX * 1.15, 3.9 + r() * 0.3, tipZ * 1.15], rot: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
  }

  // canopy: big cluster at the crown, smaller ones out at the limb tips, then
  // a scatter of small ones to break the silhouette
  // a cluster is a box chamfered almost to its limit, which rounds it into a
  // blob for the same 44 triangles a cube costs
  const puff = (s, x, y, z) => m.box('foliage', {
    size: [s, s * 0.82, s * 0.94], pos: [x, y, z],
    rot: [r() * 0.3, r() * 2, r() * 0.3], bevel: s * 0.3,
  });
  puff(2.5, 0, 4.5, 0);
  for (const [x, y, z] of limbs) puff(1.25 + r() * 0.4, x * 1.05, y + 0.6, z * 1.05);
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2, rad = 0.8 + r() * 1.0;
    puff(0.75 + r() * 0.5, Math.cos(a) * rad, 3.9 + r() * 1.7, Math.sin(a) * rad);
  }
  return m;
};
