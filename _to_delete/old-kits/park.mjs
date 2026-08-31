/**
 * Park kit — greybox blockouts.
 *
 * tree_blockout and shrub_blockout are PLACEHOLDERS. Organic form does not come
 * out of code well; replace them with authored or CC0 meshes (Poly Haven,
 * Kenney) before Tier 3 ships. They exist so a park is not an empty lawn while
 * the layout rules are being written.
 */
import { Mesh } from '../lib/mesh.mjs';

export const path_segment = () => new Mesh()
  .slab('pavement_slab', { size: [4.0, 0.09, 2.4] })
  .box('kerb_stone', { size: [4.0, 0.13, 0.16], pos: [0, 0.065, -1.28], base: false })
  .box('kerb_stone', { size: [4.0, 0.13, 0.16], pos: [0, 0.065, 1.28], base: false });

export const path_junction = () => new Mesh()
  .slab('pavement_slab', { size: [2.4, 0.09, 2.4] })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [-1.28, 0.065, -1.28], base: false })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [1.28, 0.065, -1.28], base: false })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [-1.28, 0.065, 1.28], base: false })
  .box('kerb_stone', { size: [0.16, 0.13, 0.16], pos: [1.28, 0.065, 1.28], base: false });

export const hedge_run = () => {
  const m = new Mesh();
  // slight per-block jitter so a run of these does not read as one extrusion
  for (let i = 0; i < 5; i++) {
    const h = 1.1 + (i % 3) * 0.07;
    m.box('timber_bare', { size: [0.82, h, 0.76 + (i % 2) * 0.06], pos: [i * 0.8 - 1.6, h / 2, 0] });
  }
  return m;
};

export const flower_bed = () => new Mesh()
  .box('kerb_stone', { size: [2.6, 0.24, 1.6], pos: [0, 0.12, 0] })
  .box('timber_bare', { size: [2.3, 0.16, 1.3], pos: [0, 0.3, 0] })
  .box('timber_bare', { size: [1.6, 0.26, 0.8], pos: [-0.2, 0.4, 0.1] });

export const park_bench = () => {
  const m = new Mesh();
  for (const x of [-0.78, 0.78]) {
    m.box('stone_dressed', { size: [0.14, 0.44, 0.56], pos: [x, 0.22, 0] });
    m.box('timber_bare', { size: [0.07, 0.6, 0.07], pos: [x, 0.74, -0.22] });
  }
  m.repeatX(5, 0.13, (z) => m.box('timber_bare', { size: [1.95, 0.05, 0.1], pos: [0, 0.46, z] }));
  m.repeatX(3, 0.16, (y) => m.box('timber_bare', { size: [1.95, 0.12, 0.05], pos: [0, 0.72 + y, -0.24] }));
  return m;
};

export const picnic_table = () => {
  const m = new Mesh();
  m.box('timber_bare', { size: [1.9, 0.07, 0.85], pos: [0, 0.74, 0] });
  for (const z of [-0.72, 0.72]) m.box('timber_bare', { size: [1.9, 0.06, 0.3], pos: [0, 0.45, z] });
  for (const x of [-0.75, 0.75]) {
    m.box('timber_bare', { size: [0.08, 0.85, 0.1], pos: [x, 0.42, -0.55], rot: [0.45, 0, 0] });
    m.box('timber_bare', { size: [0.08, 0.85, 0.1], pos: [x, 0.42, 0.55], rot: [-0.45, 0, 0] });
  }
  return m;
};

export const bandstand = () => {
  const m = new Mesh();
  m.cylinder('stone_dressed', { r: 3.4, h: 0.55, seg: 12 });
  m.cylinder('timber_painted', { r: 3.15, h: 0.09, seg: 12, pos: [0, 0.55, 0] });
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    m.box('timber_painted', {
      size: [0.16, 3.0, 0.16],
      pos: [Math.cos(t) * 2.85, 2.14, Math.sin(t) * 2.85],
    });
  }
  m.cylinder('metal_galv', { r: [3.5, 0.4], h: 1.5, seg: 12, pos: [0, 3.64, 0], caps: false });
  m.cylinder('metal_painted', { r: 0.14, h: 0.7, seg: 8, pos: [0, 5.1, 0] });
  return m;
};

export const fountain = () => {
  const m = new Mesh();
  m.cylinder('stone_dressed', { r: 2.6, h: 0.52, seg: 16 });
  m.cylinder('asphalt_wet', { r: 2.3, h: 0.06, seg: 16, pos: [0, 0.42, 0] });
  m.cylinder('stone_dressed', { r: 0.55, h: 0.85, seg: 12, pos: [0, 0.42, 0] });
  m.cylinder('stone_dressed', { r: [1.15, 0.9], h: 0.24, seg: 12, pos: [0, 1.27, 0] });
  m.cylinder('stone_dressed', { r: 0.24, h: 0.75, seg: 10, pos: [0, 1.51, 0] });
  m.cylinder('stone_dressed', { r: [0.6, 0.45], h: 0.18, seg: 10, pos: [0, 2.26, 0] });
  return m;
};

export const notice_board = () => new Mesh()
  .box('timber_bare', { size: [0.1, 1.9, 0.1], pos: [-0.75, 0.95, 0] })
  .box('timber_bare', { size: [0.1, 1.9, 0.1], pos: [0.75, 0.95, 0] })
  .box('timber_painted', { size: [1.7, 1.05, 0.09], pos: [0, 1.5, 0] })
  .box('glass_shop', { size: [1.5, 0.88, 0.03], pos: [0, 1.5, 0.06] })
  .wedge('timber_painted', { size: [1.85, 0.22, 0.34], pos: [0, 2.03, 0.02] });

export const park_gate = () => {
  const m = new Mesh();
  for (const x of [-2.3, 2.3]) {
    m.box('stone_dressed', { size: [0.62, 2.9, 0.62], pos: [x, 1.45, 0] });
    m.box('stone_dressed', { size: [0.76, 0.2, 0.76], pos: [x, 2.98, 0] });
    m.cylinder('stone_dressed', { r: [0.24, 0.06], h: 0.4, seg: 8, pos: [x, 3.08, 0] });
  }
  for (const x of [-1.1, 1.1]) {
    m.box('metal_painted', { size: [1.9, 0.07, 0.05], pos: [x, 1.85, 0] });
    m.box('metal_painted', { size: [1.9, 0.06, 0.05], pos: [x, 0.35, 0] });
    m.repeatX(6, 0.32, (dx) => m.box('metal_painted', { size: [0.05, 1.6, 0.05], pos: [x + dx, 1.05, 0] }));
  }
  return m;
};

export const swing_set = () => {
  const m = new Mesh();
  for (const x of [-1.9, 1.9]) {
    m.box('metal_painted', { size: [0.1, 2.6, 0.1], pos: [x, 1.3, -0.9], rot: [-0.32, 0, 0] });
    m.box('metal_painted', { size: [0.1, 2.6, 0.1], pos: [x, 1.3, 0.9], rot: [0.32, 0, 0] });
  }
  m.box('metal_painted', { size: [4.2, 0.11, 0.11], pos: [0, 2.5, 0] });
  for (const x of [-0.95, 0.95]) {
    m.box('metal_galv', { size: [0.04, 1.75, 0.04], pos: [x - 0.22, 1.6, 0] });
    m.box('metal_galv', { size: [0.04, 1.75, 0.04], pos: [x + 0.22, 1.6, 0] });
    m.box('plastic_signage', { size: [0.56, 0.07, 0.2], pos: [x, 0.7, 0] });
  }
  return m;
};

export const slide = () => {
  const m = new Mesh();
  m.box('metal_painted', { size: [1.1, 1.9, 1.1], pos: [0, 0.95, -1.4], skip: ['py', 'ny'] });
  m.box('timber_painted', { size: [1.2, 0.09, 1.2], pos: [0, 1.9, -1.4] });
  for (let i = 0; i < 6; i++) m.box('metal_galv', { size: [0.9, 0.05, 0.06], pos: [0, 0.28 + i * 0.3, -2.0] });
  m.box('plastic_signage', { size: [0.8, 0.07, 3.2], pos: [0, 1.18, 0.35], rot: [0.5, 0, 0] });
  m.box('plastic_signage', { size: [0.07, 0.3, 3.2], pos: [-0.42, 1.3, 0.35], rot: [0.5, 0, 0] });
  m.box('plastic_signage', { size: [0.07, 0.3, 3.2], pos: [0.42, 1.3, 0.35], rot: [0.5, 0, 0] });
  return m;
};

export const climbing_frame = () => {
  const m = new Mesh();
  for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
    m.box('metal_painted', { size: [0.09, 2.4, 0.09], pos: [x, 1.2, z] });
  }
  for (const y of [1.2, 2.4]) {
    for (const z of [-1.5, 1.5]) m.box('metal_painted', { size: [3.1, 0.07, 0.07], pos: [0, y, z] });
    for (const x of [-1.5, 1.5]) m.box('metal_painted', { size: [0.07, 0.07, 3.1], pos: [x, y, 0] });
  }
  m.repeatX(4, 0.75, (x) => m.box('metal_galv', { size: [0.05, 0.05, 3.0], pos: [x, 2.4, 0] }));
  m.box('plastic_signage', { size: [1.4, 0.08, 1.4], pos: [0, 1.2, 0] });
  return m;
};

export const basketball_hoop = () => new Mesh()
  .box('concrete_cast', { size: [0.7, 0.14, 0.7], pos: [0, 0.07, 0] })
  .cylinder('metal_galv', { r: 0.11, h: 3.4, seg: 8, pos: [0, 0.14, 0] })
  .box('metal_galv', { size: [0.1, 0.1, 1.0], pos: [0, 3.5, 0.5] })
  .box('plastic_signage', { size: [1.8, 1.05, 0.08], pos: [0, 3.55, 1.0] })
  .cylinder('metal_painted', { r: 0.23, h: 0.05, seg: 10, pos: [0, 3.05, 0.75], base: false });

export const goalposts = () => {
  const m = new Mesh();
  for (const x of [-3.66, 3.66]) m.cylinder('metal_painted', { r: 0.06, h: 2.44, seg: 8, pos: [x, 0, 0] });
  m.box('metal_painted', { size: [7.44, 0.12, 0.12], pos: [0, 2.5, 0] });
  for (const x of [-3.66, 3.66]) m.box('metal_painted', { size: [0.06, 2.6, 0.06], pos: [x, 1.3, -1.4], rot: [0.5, 0, 0] });
  return m;
};

export const pond_edge = () => new Mesh()
  .box('stone_dressed', { size: [3.0, 0.5, 0.8], pos: [0, 0.25, 0] })
  .box('stone_dressed', { size: [3.0, 0.14, 1.0], pos: [0, 0.57, 0] })
  .box('timber_bare', { size: [3.0, 0.5, 0.25], pos: [0, 0.25, 0.52] });

export const litter_bin_park = () => new Mesh()
  .cylinder('timber_bare', { r: [0.26, 0.3], h: 0.8, seg: 10 })
  .cylinder('timber_painted', { r: 0.34, h: 0.07, seg: 10, pos: [0, 0.8, 0] })
  .box('metal_galv', { size: [0.05, 0.9, 0.05], pos: [0, 0.45, 0.3] });

/* ------------------------------------------------------ PLACEHOLDERS ----- */
/* Replace before Tier 3 ships. Code does not make convincing organic form. */

export const tree_blockout = () => {
  const m = new Mesh();
  m.cylinder('timber_bare', { r: [0.24, 0.16], h: 2.6, seg: 8 });
  m.box('timber_bare', { size: [1.4, 0.12, 0.12], pos: [0.4, 2.3, 0], rot: [0, 0, 0.5] });
  m.box('timber_bare', { size: [1.2, 0.12, 0.12], pos: [-0.35, 2.6, 0.2], rot: [0, 1.1, -0.6] });
  for (const [x, y, z, s] of [[0, 3.9, 0, 2.5], [-1.0, 3.4, 0.5, 1.7], [0.9, 3.5, -0.6, 1.6], [0.2, 4.6, 0.4, 1.5]]) {
    m.box('timber_painted', { size: [s, s * 0.75, s], pos: [x, y, z], rot: [0, (x + z) * 0.7, 0] });
  }
  return m;
};

export const shrub_blockout = () => {
  const m = new Mesh();
  for (const [x, y, z, s] of [[0, 0.42, 0, 0.95], [-0.4, 0.3, 0.3, 0.65], [0.35, 0.34, -0.25, 0.7]]) {
    m.box('timber_painted', { size: [s, s * 0.85, s], pos: [x, y, z], rot: [0, x * 2, 0] });
  }
  return m;
};
