/**
 * Street trees, bark and lawns as TSL node materials (2026-09-28, the owner:
 * "they've got better ... lawns, trees" -- techniques only, our own palette).
 *
 * What was wrong, measured from the code, not guessed:
 *  - Every canopy was `instance colour x material colour`: the per-tree colour
 *    (a mid green, ~0.2 linear) times main.js's 0x4e6b3a (~0.15 linear) --
 *    two greens multiplied, so a lit plane tree came out at ~0.03 albedo, a
 *    near-black blob, and every leaf of it the same value.
 *  - Park lawns wore A.mat.leaf itself: one flat dark green, no pattern.
 *  - Bark was one flat Lambert brown on every species.
 *
 * All three are single node materials that REPLACE the old ones in assets.js,
 * so no draw is added and no mesh changes. Colour now comes from the instance
 * colour (the tree's hue and value, districtWorld treeColour) times a shading
 * term that sits around 1.0:
 *  - canopy: darker low and inside the crown (the leaves shade each other),
 *    lighter on the outer, upper shell; the sky-facing leaves warmer, the
 *    underside blue-green; clump-scale value/hue breakup from object-space
 *    noise, so two trees of one colour still read as two trees; and the crown
 *    SILHOUETTE is broken up by a crack-free vertex jitter (noise of the
 *    position, so the split vertices of a flat-shaded face move together).
 *    The shadow pass runs the same positionNode, so the shadows are lumpy too.
 *  - bark: plane-tree mottle (grey-olive with cream flakes), darker at the foot.
 *  - lawn: mown stripes along the block's own axis, faded out where a stripe is
 *    under a pixel (no moire at distance), dry warm patches and lush dark ones
 *    at park scale, the sky-facing cool shift left to the light rig.
 *
 * Cost: canopy vertex stage +3 noise evals a vertex (~1k-1.5k verts a tree);
 * canopy fragment +1 noise; bark +1 noise; lawn +2 noise and a sin. No
 * textures, no draws, no triangles. Alpha-cut leaf cards were NOT done: the
 * authored canopies are closed low-poly shells with no card UVs, and alpha
 * test would cost early-z on every leaf pixel -- the vertex jitter buys the
 * broken silhouette instead.
 */
import * as THREE from 'three';
import {
  attribute, positionLocal, positionWorld, normalWorld, uv, vec3, float,
  mix, smoothstep, clamp, length, sin, fwidth, abs, max, mx_noise_float,
} from 'three/tsl';

const lin = (hex) => new THREE.Color().setHex(hex);   // setHex: authored sRGB, stored linear
const v3 = (hex) => { const c = lin(hex); return vec3(c.r, c.g, c.b); };

/** The canopy: shading only; the hue is the instance colour. */
export function leafMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.78, metalness: 0 });
  m.name = 'leaf_canopy';
  const raw = attribute('position', 'vec3');                     // the tree's own space, before the instance matrix
  // silhouette: move each vertex by a smooth 3D noise of where it stands
  const pj = positionLocal.mul(0.7);
  m.positionNode = positionLocal.add(vec3(
    mx_noise_float(pj), mx_noise_float(pj.add(vec3(17.1, 3.3, 9.2))), mx_noise_float(pj.add(vec3(5.7, 29.4, 13.8))),
  ).mul(0.28));
  // self-shading: the crown's inside and underside sit in its own shade
  const hN = smoothstep(1.2, 5.8, raw.y);
  const rN = smoothstep(0.3, 2.6, length(raw.xz));
  const occl = mix(float(0.52), float(1.12), clamp(hN.mul(0.55).add(rN.mul(0.55)), 0, 1));
  // clumps: value and a touch of hue per leaf mass, in world space so neighbours differ
  const n = mx_noise_float(positionWorld.mul(0.55));
  const clump = mix(vec3(0.82, 0.86, 0.9), vec3(1.14, 1.1, 0.86), smoothstep(-0.45, 0.55, n));
  // sky-facing leaves warmer (sun + sky), the underside cooler and blue-green
  const up = normalWorld.y;
  const face = mix(vec3(0.8, 0.9, 1.02), vec3(1.1, 1.06, 0.9), smoothstep(-0.6, 0.8, up));
  m.colorNode = vec3(1).mul(occl).mul(clump).mul(face);
  return m;
}

/** Bark: mottled, darker at the root flare. Hue from the instance colour. */
export function barkMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  m.name = 'bark_mottled';
  const n = mx_noise_float(positionWorld.mul(vec3(2.2, 0.9, 2.2)));
  const flake = smoothstep(0.15, 0.4, n);                        // the plane tree's pale flakes
  const foot = mix(float(0.62), float(1), smoothstep(0.1, 1.4, attribute('position', 'vec3').y));
  m.colorNode = mix(vec3(0.78), vec3(1.45, 1.4, 1.2), flake).mul(foot);
  return m;
}

/** Bark hue by species (sRGB authored). */
export const BARK = {
  plane: 0x7c7560, ginkgo: 0x6b5e50, sakura: 0x4e3a34, red_maple: 0x5a4a40, willow: 0x655a4a,
  palm: 0x8a7e6a, pine: 0x5e4232, poplar: 0x8a8676, cypress: 0x5a4a3c, magnolia: 0x6e665c, autumn_oak: 0x5c5044,
};

/**
 * A park lawn. The slabs' UVs are block-local metres / 2.4 (districtWorld
 * roundedSlab), so the stripes follow the block, as a mower would.
 */
export function lawnMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0 });
  m.name = 'lawn';
  const base = v3(0x5d7d34);                                     // mown turf, ~0.11/0.2/0.03 linear
  const dry = v3(0x8c8a4a), lush = v3(0x3e6230);
  const w = positionWorld.xz;
  const big = mx_noise_float(vec3(w.mul(0.035), 0));             // park-scale: worn and lush ground
  const mid = mx_noise_float(vec3(w.mul(0.22), 3.1));            // patch-scale: clover, thin turf
  let c = mix(base, lush, smoothstep(0.1, 0.6, big));
  c = mix(c, dry, smoothstep(0.25, 0.75, big.negate()).mul(0.55));
  c = c.mul(float(1).add(mid.mul(0.1)));
  // mown stripes, 1.6 m wide, faded where one stripe is thinner than a pixel
  const sx = uv().x.mul(2.4 / 1.6);
  const stripe = smoothstep(-0.25, 0.25, sin(sx.mul(Math.PI)));
  const fade = float(1).sub(smoothstep(0.25, 0.7, fwidth(sx)));
  const k = stripe.mul(2).sub(1).mul(fade);                      // -1 dark stripe .. +1 light
  c = c.mul(mix(vec3(0.88, 0.9, 0.95), vec3(1.12, 1.1, 1.0), k.mul(0.5).add(0.5)));
  m.colorNode = max(c, vec3(0.005));
  return m;
}

/* Leaf colours by species, sRGB authored: our cities, not a postcard.
   London's streets are London plane (a mid, slightly yellow green), with lime
   and a few copper beech; Little Tokyo's are zelkova (keyaki) and ginkgo, both
   green in the summer the game runs in, with cherries as a minority and the
   maple a rare accent. Each tree then moves in value and hue (treeColour). */
export const LEAF_OF = {
  plane: [0x5e7d38, 0x6a8840, 0x55742f, 0x66823a],
  magnolia: [0x4a6e34, 0x557a3a],
  autumn_oak: [0x5a7034, 0x66783a, 0x8a7a3a],              // an oak, mostly still green, one in three turning
  pine: [0x3e5a34, 0x46603a],
  poplar: [0x6a8a3e, 0x74903f],
  cypress: [0x34503a, 0x3a5840],
  ginkgo: [0x6e8e38, 0x7a963c, 0x8fa044],                  // ginkgo's summer yellow-green
  sakura: [0xd9b0ba, 0xe0bcc4, 0x6a8a44],                  // bloom, bloom, and one already in leaf
  red_maple: [0x8a3a2c, 0x6e7e3a],
  willow: [0x7a9448, 0x86a050],
  palm: [0x5e7a3a, 0x6a8440],
};

/** One tree's leaf colour: the species' colour, moved in value and hue by `r1`, `r2` in [0, 1). */
export function treeColour(sp, r1, r2) {
  const set = LEAF_OF[sp] ?? LEAF_OF.plane;
  const c = new THREE.Color().setHex(set[Math.floor(r1 * set.length) % set.length]);
  const hsl = {}; c.getHSL(hsl);
  // +-4% hue, +-12% lightness: a street of one species, but no two alike
  c.setHSL((hsl.h + (r2 - 0.5) * 0.04 + 1) % 1, hsl.s * (0.9 + r1 * 0.2), hsl.l * (0.88 + r2 * 0.24));
  return c.getHex();
}
