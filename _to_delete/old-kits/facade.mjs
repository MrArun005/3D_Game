/**
 * Facade kit — greybox blockouts.
 *
 * Every module is authored as a SHELL, not a solid: the facade plane sits at
 * z = 0 and the module extends backwards into -z. districtWorld stacks these
 * against a building mass rather than replacing it, so a 78 m tower is still
 * one box plus n instanced bays.
 *
 * Bay width is fixed at BAY so modules interchange freely. Storey heights come
 * from docs/ART_BIBLE.md. Do not change these without changing the assembly.
 */
import { Mesh } from '../lib/mesh.mjs';

export const BAY = 3.6;          // module width, metres
export const H_COMM = 3.2;       // commercial storey
export const H_RES = 2.9;        // residential storey
export const H_GROUND = 4.2;     // ground floor is always taller
const D = 0.45;                  // shell depth

/* A recessed opening: reveal box back from the facade plane, glazing behind. */
function opening(m, { w, h, y, glass = 'glass_shop', reveal = 0.18, sill = null, frame = 'metal_painted' }) {
  m.box(glass, { size: [w - 0.1, h - 0.1, 0.04], pos: [0, y + h / 2, -reveal] });
  // reveal jambs and head, so the window reads as a hole with depth
  m.box(frame, { size: [0.09, h, reveal], pos: [-w / 2 + 0.045, y + h / 2, -reveal / 2] });
  m.box(frame, { size: [0.09, h, reveal], pos: [w / 2 - 0.045, y + h / 2, -reveal / 2] });
  m.box(frame, { size: [w, 0.09, reveal], pos: [0, y + h - 0.045, -reveal / 2] });
  if (sill) m.box(sill, { size: [w + 0.24, 0.09, 0.26], pos: [0, y - 0.02, -0.02] });
  return m;
}

/* Wall panel with a rectangular hole punched in it. Four boxes, no booleans. */
function punched(m, mat, { w, h, ow, oh, oy, depth = D }) {
  const side = (w - ow) / 2;
  m.box(mat, { size: [side, h, depth], pos: [-(ow / 2 + side / 2), h / 2, -depth / 2] });
  m.box(mat, { size: [side, h, depth], pos: [ow / 2 + side / 2, h / 2, -depth / 2] });
  m.box(mat, { size: [ow, oy, depth], pos: [0, oy / 2, -depth / 2] });
  const above = h - (oy + oh);
  if (above > 0.01) m.box(mat, { size: [ow, above, depth], pos: [0, oy + oh + above / 2, -depth / 2] });
  return m;
}

/* ------------------------------------------------------------------ bays -- */

export const bay_glass_office = () => {
  const m = new Mesh(), h = H_COMM;
  m.box('glass_curtain', { size: [BAY, h, 0.06], pos: [0, h / 2, -0.08] });
  // mullions are what stop curtain wall reading as a blue rectangle
  m.repeatX(4, BAY / 3, (x) => m.box('alloy_polished', { size: [0.11, h, 0.14], pos: [x, h / 2, 0] }));
  m.box('alloy_polished', { size: [BAY, 0.16, 0.16], pos: [0, 0.08, 0] });
  m.box('alloy_polished', { size: [BAY, 0.16, 0.16], pos: [0, h - 0.08, 0] });
  m.box('concrete_precast', { size: [BAY, 0.34, D], pos: [0, h - 0.17, -D / 2 - 0.05] });
  return m;
};

export const bay_precast_office = () => {
  const m = new Mesh(), h = H_COMM;
  punched(m, 'concrete_precast', { w: BAY, h, ow: 2.4, oh: 1.7, oy: 0.95 });
  opening(m, { w: 2.4, h: 1.7, y: 0.95, glass: 'glass_curtain', sill: 'concrete_precast' });
  m.box('concrete_precast', { size: [BAY, 0.12, 0.1], pos: [0, h - 0.06, 0.02] });
  return m;
};

export const bay_brick_residential = () => {
  const m = new Mesh(), h = H_RES;
  punched(m, 'brick_red', { w: BAY, h, ow: 1.3, oh: 1.55, oy: 0.85 });
  opening(m, { w: 1.3, h: 1.55, y: 0.85, glass: 'glass_shop', sill: 'stone_dressed', frame: 'timber_painted' });
  m.box('stone_dressed', { size: [1.6, 0.14, 0.1], pos: [0, 0.85 + 1.55 + 0.07, 0.02] }); // lintel
  return m;
};

export const bay_tenement = () => {
  const m = new Mesh(), h = H_RES + 0.4;
  punched(m, 'brick_painted', { w: BAY, h, ow: 1.15, oh: 2.0, oy: 0.7 });
  opening(m, { w: 1.15, h: 2.0, y: 0.7, sill: 'stone_dressed', frame: 'timber_painted' });
  m.box('stone_dressed', { size: [BAY, 0.16, 0.12], pos: [0, h - 0.3, 0.03] });  // string course
  return m;
};

export const bay_warehouse = () => {
  const m = new Mesh(), h = H_COMM + 0.6;
  punched(m, 'brick_red', { w: BAY, h, ow: 2.7, oh: 2.1, oy: 0.8 });
  opening(m, { w: 2.7, h: 2.1, y: 0.8, glass: 'glass_curtain', frame: 'metal_galv' });
  m.repeatX(3, 0.9, (x) => m.box('metal_galv', { size: [0.07, 2.1, 0.1], pos: [x, 0.8 + 1.05, -0.06] }));
  m.box('metal_rust', { size: [3.0, 0.18, 0.16], pos: [0, 0.8 + 2.1 + 0.09, 0.01] }); // steel lintel
  return m;
};

export const bay_plaster_upper = () => {
  const m = new Mesh(), h = H_RES;
  punched(m, 'plaster_worn', { w: BAY, h, ow: 1.5, oh: 1.6, oy: 0.8 });
  opening(m, { w: 1.5, h: 1.6, y: 0.8, sill: 'stone_dressed', frame: 'timber_painted' });
  return m;
};

/* --------------------------------------------------------- ground floors -- */

export const ground_shopfront = () => {
  const m = new Mesh(), h = H_GROUND;
  m.box('concrete_cast', { size: [0.3, h, D], pos: [-BAY / 2 + 0.15, h / 2, -D / 2] });
  m.box('concrete_cast', { size: [0.3, h, D], pos: [BAY / 2 - 0.15, h / 2, -D / 2] });
  m.box('timber_painted', { size: [BAY - 0.6, 0.55, 0.3], pos: [0, 0.275, -0.1] });     // stallriser
  m.box('glass_shop', { size: [BAY - 0.7, 2.5, 0.05], pos: [0, 1.85, -0.14] });
  m.box('metal_painted', { size: [0.08, 2.5, 0.12], pos: [-0.55, 1.85, -0.1] });
  m.box('metal_painted', { size: [0.08, 2.5, 0.12], pos: [0.55, 1.85, -0.1] });
  m.box('plastic_signage', { size: [BAY - 0.5, 0.7, 0.16], pos: [0, h - 0.45, -0.02] }); // fascia
  m.box('concrete_cast', { size: [BAY, 0.24, D], pos: [0, h - 0.12, -D / 2] });
  return m;
};

export const ground_shopfront_awning = () => {
  const m = ground_shopfront();
  m.box('fabric_awning', { size: [BAY - 0.4, 0.1, 1.5], pos: [0, 3.05, -0.78], rot: [0.22, 0, 0] });
  m.box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [-BAY / 2 + 0.35, 2.85, -1.4] });
  m.box('metal_painted', { size: [0.06, 0.5, 0.06], pos: [BAY / 2 - 0.35, 2.85, -1.4] });
  return m;
};

export const ground_lobby = () => {
  const m = new Mesh(), h = H_GROUND;
  m.box('stone_dressed', { size: [1.0, h, D], pos: [-BAY / 2 + 0.5, h / 2, -D / 2] });
  m.box('stone_dressed', { size: [1.0, h, D], pos: [BAY / 2 - 0.5, h / 2, -D / 2] });
  m.box('stone_dressed', { size: [BAY, 1.0, D], pos: [0, h - 0.5, -D / 2] });
  m.box('glass_shop', { size: [1.55, 2.6, 0.05], pos: [0, 1.3, -0.6] });     // recessed
  m.box('alloy_polished', { size: [0.08, 2.6, 0.1], pos: [0, 1.3, -0.55] }); // door split
  m.box('stone_dressed', { size: [BAY, 0.14, 1.3], pos: [0, 2.68, -0.65] }); // canopy
  m.box('pavement_slab', { size: [1.6, 0.12, 0.6], pos: [0, 0.06, -0.3] });
  return m;
};

export const ground_garage = () => {
  const m = new Mesh(), h = H_GROUND;
  punched(m, 'concrete_cast', { w: BAY, h, ow: 2.9, oh: 3.0, oy: 0 });
  m.box('metal_galv', { size: [2.9, 3.0, 0.08], pos: [0, 1.5, -0.14] });
  m.repeatX(6, 0.5, (_, i) => m.box('metal_galv', { size: [2.9, 0.05, 0.13], pos: [0, 0.35 + i * 0.5, -0.1] }));
  return m;
};

export const ground_service = () => {
  const m = new Mesh(), h = H_GROUND;
  m.box('concrete_cast', { size: [BAY, h, D], pos: [0, h / 2, -D / 2] });
  m.box('metal_painted', { size: [1.0, 2.1, 0.1], pos: [-0.9, 1.05, 0.01] });
  m.box('metal_galv', { size: [0.9, 0.7, 0.12], pos: [1.0, 2.6, 0.01] });   // louvre
  m.box('metal_rust', { size: [0.4, 0.5, 0.22], pos: [1.5, 1.1, 0.05] });   // meter box
  return m;
};

export const ground_cafe = () => {
  const m = ground_shopfront();
  m.box('metal_painted', { size: [0.05, 0.75, 0.05], pos: [-1.2, 0.375, -1.5] });
  m.box('timber_bare', { size: [0.7, 0.06, 0.7], pos: [-1.2, 0.75, -1.5] });
  m.box('metal_painted', { size: [0.05, 0.75, 0.05], pos: [1.2, 0.375, -1.5] });
  m.box('timber_bare', { size: [0.7, 0.06, 0.7], pos: [1.2, 0.75, -1.5] });
  return m;
};

/* ------------------------------------------------------------- verticals -- */

export const pilaster = () => new Mesh()
  .box('stone_dressed', { size: [0.55, 3.2, 0.28], pos: [0, 1.6, -0.14] })
  .box('stone_dressed', { size: [0.7, 0.3, 0.36], pos: [0, 0.15, -0.14] })
  .box('stone_dressed', { size: [0.7, 0.26, 0.36], pos: [0, 3.07, -0.14] });

export const quoin_corner = () => {
  const m = new Mesh();
  for (let i = 0; i < 8; i++) {
    const w = i % 2 ? 0.62 : 0.44;
    m.box('stone_dressed', { size: [w, 0.4, 0.42], pos: [w / 2 - 0.31, 0.2 + i * 0.4, -0.21] });
  }
  return m;
};

export const downpipe = () => new Mesh()
  .cylinder('metal_galv', { r: 0.055, h: 3.2, seg: 8, pos: [0, 0, -0.1] })
  .box('metal_galv', { size: [0.16, 0.06, 0.16], pos: [0, 1.0, -0.1] })
  .box('metal_galv', { size: [0.16, 0.06, 0.16], pos: [0, 2.4, -0.1] });

export const fire_escape = () => {
  const m = new Mesh();
  m.box('metal_rust', { size: [2.4, 0.07, 1.2], pos: [0, 0.9, -0.6] });          // platform
  m.repeatX(9, 0.28, (x) => m.box('metal_rust', { size: [0.04, 0.04, 1.2], pos: [x, 0.94, -0.6] }));
  for (const z of [-0.02, -1.18]) {
    m.box('metal_rust', { size: [2.4, 0.05, 0.05], pos: [0, 1.9, z] });
    m.repeatX(3, 1.1, (x) => m.box('metal_rust', { size: [0.05, 1.0, 0.05], pos: [x, 1.4, z] }));
  }
  m.box('metal_rust', { size: [0.05, 2.6, 0.05], pos: [-0.4, 2.2, -1.15], rot: [0.5, 0, 0] });
  m.box('metal_rust', { size: [0.05, 2.6, 0.05], pos: [0.4, 2.2, -1.15], rot: [0.5, 0, 0] });
  return m;
};

export const balcony = () => {
  const m = new Mesh();
  m.box('concrete_precast', { size: [2.6, 0.16, 1.0], pos: [0, 0.08, -0.5] });
  m.box('metal_painted', { size: [2.6, 0.06, 0.06], pos: [0, 1.05, -0.97] });
  m.repeatX(9, 0.3, (x) => m.box('metal_painted', { size: [0.04, 0.98, 0.04], pos: [x, 0.55, -0.97] }));
  m.box('metal_painted', { size: [0.05, 1.0, 0.98], pos: [-1.28, 0.55, -0.5] });
  m.box('metal_painted', { size: [0.05, 1.0, 0.98], pos: [1.28, 0.55, -0.5] });
  return m;
};

export const string_course = () => new Mesh()
  .box('stone_dressed', { size: [BAY, 0.22, 0.14], pos: [0, 0.11, 0.02] });

/* --------------------------------------------------------------- toppers -- */

export const cornice_simple = () => new Mesh()
  .box('concrete_precast', { size: [BAY, 0.26, 0.5], pos: [0, 0.13, -0.1] })
  .box('concrete_precast', { size: [BAY, 0.2, 0.36], pos: [0, 0.36, -0.16] });

export const cornice_ornate = () => new Mesh()
  .box('stone_dressed', { size: [BAY, 0.18, 0.62], pos: [0, 0.09, -0.06] })
  .box('stone_dressed', { size: [BAY, 0.14, 0.5], pos: [0, 0.25, -0.12] })
  .box('stone_dressed', { size: [BAY, 0.3, 0.38], pos: [0, 0.47, -0.18] })
  .box('stone_dressed', { size: [BAY, 0.12, 0.7], pos: [0, 0.68, -0.04] });

export const parapet = () => new Mesh()
  .box('brick_painted', { size: [BAY, 1.05, 0.35], pos: [0, 0.525, -0.17] })
  .box('stone_dressed', { size: [BAY, 0.12, 0.45], pos: [0, 1.11, -0.17] });

export const mansard = () => new Mesh()
  .box('metal_galv', { size: [BAY, 2.0, 1.4], pos: [0, 1.0, -1.0], rot: [-0.32, 0, 0] })
  .box('stone_dressed', { size: [BAY, 0.16, 0.5], pos: [0, 0.08, -0.15] })
  .box('timber_painted', { size: [0.85, 0.9, 0.7], pos: [0, 1.05, -0.95] })
  .box('glass_shop', { size: [0.62, 0.7, 0.04], pos: [0, 1.08, -0.62] });

/* ------------------------------------------------------------ roof kit --- */

export const hvac_unit = () => {
  const m = new Mesh();
  m.box('metal_galv', { size: [2.2, 1.0, 1.6], pos: [0, 0.5, 0] });
  m.box('metal_painted', { size: [2.3, 0.12, 1.7], pos: [0, 1.06, 0] });
  m.cylinder('metal_painted', { r: 0.42, h: 0.22, seg: 12, pos: [-0.5, 1.12, 0] });
  m.cylinder('metal_painted', { r: 0.42, h: 0.22, seg: 12, pos: [0.5, 1.12, 0] });
  m.box('metal_rust', { size: [2.4, 0.14, 0.2], pos: [0, 0.07, -0.6] });
  m.box('metal_rust', { size: [2.4, 0.14, 0.2], pos: [0, 0.07, 0.6] });
  return m;
};

export const water_tank = () => {
  const m = new Mesh();
  m.repeatX(2, 1.7, (x) => {
    m.box('metal_rust', { size: [0.13, 2.6, 0.13], pos: [x, 1.3, -0.85] });
    m.box('metal_rust', { size: [0.13, 2.6, 0.13], pos: [x, 1.3, 0.85] });
  });
  m.cylinder('timber_bare', { r: 1.05, h: 2.2, seg: 14, pos: [0, 2.6, 0] });
  m.cylinder('metal_galv', { r: 1.12, h: 0.5, seg: 14, pos: [0, 4.8, 0] });
  return m;
};

export const vent_stack = () => new Mesh()
  .box('brick_red', { size: [1.1, 1.9, 1.1], pos: [0, 0.95, 0] })
  .box('concrete_cast', { size: [1.3, 0.16, 1.3], pos: [0, 1.98, 0] })
  .cylinder('metal_rust', { r: 0.19, h: 0.8, seg: 8, pos: [-0.25, 2.06, 0] })
  .cylinder('metal_rust', { r: 0.19, h: 1.1, seg: 8, pos: [0.25, 2.06, 0] });

export const aerial_mast = () => {
  const m = new Mesh();
  m.box('concrete_cast', { size: [1.0, 0.28, 1.0], pos: [0, 0.14, 0] });
  m.cylinder('metal_galv', { r: [0.11, 0.06], h: 6.5, seg: 8, pos: [0, 0.28, 0] });
  for (const [y, w] of [[3.4, 1.5], [4.4, 1.2], [5.3, 0.9]]) {
    m.box('metal_galv', { size: [w, 0.05, 0.05], pos: [0, y, 0] });
    m.box('metal_galv', { size: [0.05, 0.05, w * 0.7], pos: [0, y - 0.12, 0] });
  }
  m.box('plastic_signage', { size: [0.16, 0.16, 0.16], pos: [0, 6.85, 0] });
  return m;
};

export const roof_hut = () => new Mesh()
  .box('brick_painted', { size: [2.4, 2.3, 2.0], pos: [0, 1.15, 0] })
  .box('concrete_cast', { size: [2.6, 0.16, 2.2], pos: [0, 2.38, 0] })
  .box('metal_painted', { size: [0.9, 2.0, 0.1], pos: [0, 1.0, 1.02] })
  .box('metal_galv', { size: [0.7, 0.45, 0.1], pos: [0, 2.0, -1.02] });

export const skylight = () => new Mesh()
  .box('metal_galv', { size: [2.2, 0.24, 1.6], pos: [0, 0.12, 0] })
  .box('glass_curtain', { size: [2.0, 0.5, 1.4], pos: [0, 0.42, 0], rot: [0.2, 0, 0] });

export const plant_enclosure = () => {
  const m = new Mesh();
  m.repeatX(2, 3.6, (x) => m.box('metal_galv', { size: [0.1, 2.2, 0.1], pos: [x, 1.1, -1.4] }));
  m.repeatX(2, 3.6, (x) => m.box('metal_galv', { size: [0.1, 2.2, 0.1], pos: [x, 1.1, 1.4] }));
  for (const z of [-1.4, 1.4]) {
    m.box('metal_galv', { size: [3.7, 2.1, 0.05], pos: [0, 1.15, z] });
  }
  m.box('metal_galv', { size: [0.05, 2.1, 2.8], pos: [-1.85, 1.15, 0] });
  m.box('metal_galv', { size: [0.05, 2.1, 2.8], pos: [1.85, 1.15, 0] });
  return m;
};
