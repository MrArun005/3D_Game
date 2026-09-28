/**
 * Per-building wall colour for the procedural massing and the far stand-ins
 * (2026-09-28). The facade canvases (facades.js) are painted in neutral greys
 * and shared by every building of an archetype, so a street of them read as
 * one grey building repeated. Each building now carries `aWall` (vec4 per
 * instance: rgb multiplier on the WALL pixels, a = grime strength), consumed
 * by city.js makeTileable. Glass is left alone: the mask is the ORM
 * roughness the painter already writes (glass 0.10-0.16, walls ~0.78).
 *
 * Palettes are ours, from the references (docs/REF-REGENT-STREET.md,
 * docs/REF-SHIBUYA.md), authored as sRGB hex and converted to linear:
 *  - London districts: Portland stone, London stock brick (the yellow-grey
 *    of the Georgian terraces), red brick, cream stucco, sooted brick.
 *  - Modern districts: pale stone and warm render with a few brick and
 *    blue-grey clad slabs -- mostly light, like the West End's newer blocks.
 *  - Industrial: engineering brick, rusted and cement cladding.
 *  - Little Tokyo: "pale grey or white; the colour is in the signage, not
 *    the walls" (REF-SHIBUYA) -- so pale tile and render, very low chroma.
 *
 * The multiplier keeps the canvas's own value structure (reveals, ledges):
 * it is the palette colour divided by a mid grey, with chroma damped so no
 * wall exceeds the ART_BIBLE albedo ceiling once multiplied.
 */
import * as THREE from 'three';

const PAL = {
  london: [0xd8ccb2, 0xcdbf9f, 0xb8a37c, 0xa89070, 0x9c5a44, 0x8a4e3c, 0xe4dac4, 0x7a6a58],
  modern: [0xd9cfbd, 0xe2d8c6, 0xc9b79a, 0xbfae94, 0xa8674e, 0x9aa4ac, 0xcfc7b8, 0xb49a7a],
  industrial: [0x8a4c3a, 0x7a5a48, 0x9a9488, 0x7c867c, 0xa08a6a],
  tokyo: [0xd6d4ce, 0xcfd2d2, 0xdad2c2, 0xc4c8c6, 0xe0dcd2],
};
const STYLE = {
  KINGSWAY: 'modern', 'THE FLATS': 'modern',
  STEELGATE: 'industrial', 'HARBOUR POINT': 'industrial',
  'LITTLE TOKYO': 'tokyo',
};
const MID = 0.5;                          // linear value the facade canvases' walls sit near after the texture
const _c = new THREE.Color();

/**
 * One building's wall multiplier and grime strength, from three seeded rolls
 * in [0, 1): r1 picks the colour, r2 moves its value +-12%, r3 the grime.
 * Returns [r, g, b, grime].
 */
export function wallTint(district, r1, r2, r3) {
  const set = PAL[STYLE[district] ?? 'london'];
  _c.setHex(set[Math.floor(r1 * set.length) % set.length]);      // sRGB authored -> linear
  const lum = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b;
  const v = Math.min(1.25, Math.max(0.55, Math.sqrt(lum / MID * 1.6))) * (0.88 + r2 * 0.24);
  const k = (x) => (1 + (x / Math.max(lum, 1e-3) - 1) * 0.75) * v;   // damped chroma, then value
  return [k(_c.r), k(_c.g), k(_c.b), 0.6 + r3 * 0.9];
}
