/**
 * Road wear as TSL (2026-09-28): the carriageway, its paint and its kerb.
 *
 * Asphalt is never one tone. A used road is polished dark in the wheel paths
 * (rubber and oil pressed in), carries a faint oil-drip stripe down the middle
 * of each lane, gathers pale grit along the kerb where no tyre sweeps it, and
 * changes tone where a stretch was resurfaced. Those are the four things this
 * multiplies into the tarmac's own colour (materialColor = colour x map, so
 * the map is sampled ONCE -- CLAUDE.md's materialColor trap).
 *
 * The lane geometry comes from `aLane` (vec2: across the carriageway 0..1,
 * half-width in metres), written beside the UVs by districtWorld for the near
 * roads and the far-city roads -- every mesh on the tarmac material carries it.
 * Lanes per direction = floor(half / 3.3), at least one; wheel tracks sit
 * 0.85 m either side of each lane's centre. Where a track would be thinner
 * than a pixel it fades to its mean, so distant roads do not shimmer.
 *
 * Paint: worn at the edges and in blotches (a world-space noise threshold
 * pulls the paint toward asphalt), crisp where it is intact.
 * Kerb: granite speckle and weathering blots, and it receives shadow now.
 *
 * Cost: tarmac fragment +2 noise, a fract and a few exp; paint +2 noise; kerb
 * +2 noise. No textures, no draws, no triangles.
 */
import * as THREE from 'three';
import {
  attribute, positionWorld, vec3, float, mix, smoothstep, abs, fract, floor, max,
  exp, fwidth, mx_noise_float, materialColor,
} from 'three/tsl';

export function roadWear() {
  const lane = attribute('aLane', 'vec2');
  const half = max(lane.y, float(1));
  const lat = lane.x.sub(0.5).mul(2).mul(half);               // metres from the centreline, signed
  const a = abs(lat);
  const n = max(floor(half.div(3.3)), float(1));
  const lw = half.div(n);                                     // one lane's width
  const m = fract(a.div(lw)).sub(0.5).mul(lw);                // metres from this lane's centre
  const dT = abs(abs(m).sub(0.85));
  const w = positionWorld.xz;
  const along = mx_noise_float(vec3(w.mul(0.09), 1.7));       // tracks come and go along the road
  const px = fwidth(a);                                        // metres a pixel spans across the road
  const sharp = float(1).sub(smoothstep(0.12, 0.5, px));       // under a pixel: fade to the mean
  const track = exp(dT.mul(dT).div(0.11).negate()).mul(sharp).add(float(0.35).mul(float(1).sub(sharp)));
  const drip = exp(m.mul(m).div(0.08).negate()).mul(sharp);
  const kerb = smoothstep(half.sub(1.1), half.sub(0.15), a);  // the gutter strip: grit and dust
  const resurf = mx_noise_float(vec3(w.mul(0.012), 4.2));      // a resurfaced stretch is darker, newer
  const k = float(1)
    .sub(track.mul(float(0.16).add(along.mul(0.05))))
    .sub(drip.mul(0.07))
    .add(kerb.mul(0.16))
    .mul(float(1).add(resurf.mul(0.09)));
  return vec3(k, k, k.mul(float(1).add(kerb.mul(-0.03))));     // grit is a touch warm
}

/** Worn road paint: blotches and ragged edges go back to asphalt tone. */
export function wornPaint(m) {
  const w = positionWorld.xz;
  const blot = mx_noise_float(vec3(w.mul(0.45), 0.3));
  const fine = mx_noise_float(vec3(w.mul(7.0), 2.1));
  const worn = smoothstep(0.35, 0.75, blot.mul(0.7).add(fine.mul(0.45)));
  const asphalt = vec3(0.075, 0.074, 0.072);
  m.colorNode = mix(materialColor.rgb, asphalt, worn.mul(0.8));
  return m;
}

/** Granite kerb faces. Their geometry has no UVs (districtWorld #streetFurniture), so world space it is. */
export function kerbStone() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0xa6a49c, roughness: 0.8, metalness: 0 });
  m.name = 'kerb_granite';
  const p = positionWorld;
  const grain = mx_noise_float(p.mul(22));
  const blot = mx_noise_float(p.mul(vec3(0.6, 3.0, 0.6)));
  m.colorNode = materialColor.rgb.mul(float(0.92).add(grain.mul(0.08)).add(blot.mul(0.06)));
  return m;
}
