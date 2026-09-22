import { Mesh } from '../../lib/mesh.mjs';
import { BAY, H_GROUND, opening, punched } from '../../lib/facade-parts.mjs';

/** Dense Little Tokyo storefront: deep glazing, a raised fascia and a tiled awning. */

export const tags = ['ground', 'retail', 'tokyo'];

export default () => {
  const m = new Mesh();
  // Two unequal shop bays and a narrow, recessed centre door avoid the
  // perfectly symmetrical shopfront that makes procedural streets read flat.
  punched(m, 'concrete_cast', { w: BAY, h: H_GROUND, ow: 3.08, oh: 2.7, oy: 0.42 });
  opening(m, { w: 1.25, h: 2.7, y: 0.42, frame: 'metal_painted', sill: 'stone_dressed' });
  opening(m, { w: 0.68, h: 2.92, y: 0.26, frame: 'alloy_polished' });
  // Offset mullion and transom: enough rhythm to read as a real frontage.
  m.box('metal_painted', { size: [0.07, 2.7, 0.18], pos: [-0.62, 1.77, -0.11] });
  m.box('metal_painted', { size: [1.22, 0.07, 0.18], pos: [-0.62, 2.42, -0.11] });
  m.box('metal_painted', { size: [0.07, 2.7, 0.18], pos: [0.94, 1.77, -0.11] });
  // Signboard, canopy and tiny rain chain make the ground floor project into
  // the street rather than ending at the building shell.
  m.box('plastic_signage', { size: [BAY - 0.28, 0.58, 0.11], pos: [0, 3.54, 0.03] });
  m.box('fabric_awning', { size: [BAY - 0.34, 0.10, 1.14], pos: [0, 3.04, -0.58], rot: [0.13, 0, 0] });
  for (const x of [-1.38, 1.38]) {
    m.box('metal_painted', { size: [0.045, 0.44, 0.045], pos: [x, 2.81, -1.08] });
  }
  return m;
};
