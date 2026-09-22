import * as THREE from 'three';
import { attribute, vec3, float } from 'three/tsl';

/**
 * Rubber left on the road.
 *
 * The car has always known when it is sliding -- `car.slip` drives the tyre
 * noise and the smoke -- but nothing was written to the tarmac, so a handbrake
 * turn left no evidence a second later. Marks are what make a corner feel like
 * it happened.
 *
 * One geometry, one draw call, written as a ring buffer: the oldest quad is
 * overwritten rather than allocated, so a long session costs exactly as much
 * as a short one. Each pair of consecutive samples becomes a quad, which is
 * why a mark is a continuous ribbon rather than a line of dashes.
 */

export const MAX = 900;            // quads in the ring, per wheel pair
const MIN_STEP = 0.35;             // metres between samples
const WIDTH = 0.24;

export class SkidMarks {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 6 * 3);
    for (let i = 0; i < MAX * 6; i++) this.pos[i * 3 + 1] = -999;
    this.alpha = new Float32Array(MAX * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    /* A plain transparent black would be a wet-look smear. Rubber reads as a
       dark stain that fades along its own length, so the strength travels in
       a vertex attribute rather than a uniform.

       TSL (Tier 0.3): `attribute('aAlpha')` is the whole of what the old
       vertex shader did -- the position transform it also wrote out by hand is
       the default path, so it simply goes away. */
    const a = attribute('aAlpha', 'float');
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    mat.colorNode = vec3(0.04, 0.04, 0.045);
    mat.opacityNode = a.mul(0.62);
    /* The GLSL discarded below 0.004 rather than trusting the blend. Keep it:
       the buffer is a ring of MAX quads and the unused tail is all zeros, so
       without this every retired skid still costs a blended fragment. */
    mat.alphaTestNode = float(0.0025);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    this.mesh = mesh;
    this.geo = geo;
    this.head = 0;
    this.last = null;               // previous sample, per side
  }

  /**
   * `car` needs x, z, yaw, slip and the rear track. Called once a frame; it
   * decides for itself whether anything is worth laying down.
   */
  update(car, groundY = 0) {
    const strength = Math.max(0, Math.min(1, (car.slip - 0.12) / 0.55))
      * Math.min(1, Math.abs(car.fwdSpeed) / 6);
    if (strength <= 0.02) { this.last = null; return; }

    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const rx = sy, rz = cy;                    // right of travel
    const back = -1.45, half = 0.78;
    const pts = [-1, 1].map((side) => [
      car.x + cy * back + rx * half * side,
      car.z - sy * back + rz * half * side,
    ]);

    if (!this.last) { this.last = pts; return; }
    const moved = Math.hypot(pts[0][0] - this.last[0][0], pts[0][1] - this.last[0][1]);
    if (moved < MIN_STEP) return;

    const P = this.geo.attributes.position, A = this.geo.attributes.aAlpha;
    for (let s = 0; s < 2; s++) layQuad(P, A, this.head++ % MAX, this.last[s], pts[s], strength, groundY);
    this.last = pts;
    /* Upload cost per laying frame: the whole ring was 64,800 + 21,600 =
       86,400 B (needsUpdate alone re-sends the full array). With the two
       quads' own ranges it is 2 x (72 + 24) = 192 B -- 450x less. The
       version bump is still what makes the backend look at the ranges, and
       the backend clears them after the write (WebGPUAttributeUtils and the
       WebGL fallback both do). If the mesh has not been drawn for a while
       the ranges pile up; past 64 a full upload is cheaper than 64 writes. */
    if (P.updateRanges.length > 64) { P.clearUpdateRanges(); A.clearUpdateRanges(); }
    P.needsUpdate = true;
    A.needsUpdate = true;
  }
}

/**
 * Write one quad into ring slot `slot` of the position (18 floats) and alpha
 * (6 floats) attributes and mark exactly those floats for upload. Pure over
 * its arguments so the test can drive it with plain BufferAttributes.
 */
export function layQuad(posAttr, alphaAttr, slot, a, b, strength, y) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * (WIDTH / 2), nz = (dx / L) * (WIDTH / 2);
  const i = slot * 18;
  const p = posAttr.array;
  const yy = y + 0.012;
  p[i]      = a[0] + nx; p[i + 1]  = yy; p[i + 2]  = a[1] + nz;
  p[i + 3]  = b[0] + nx; p[i + 4]  = yy; p[i + 5]  = b[1] + nz;
  p[i + 6]  = b[0] - nx; p[i + 7]  = yy; p[i + 8]  = b[1] - nz;
  p[i + 9]  = a[0] + nx; p[i + 10] = yy; p[i + 11] = a[1] + nz;
  p[i + 12] = b[0] - nx; p[i + 13] = yy; p[i + 14] = b[1] - nz;
  p[i + 15] = a[0] - nx; p[i + 16] = yy; p[i + 17] = a[1] - nz;
  const j = slot * 6, al = alphaAttr.array;
  for (let k = 0; k < 6; k++) al[j + k] = strength;
  posAttr.addUpdateRange(i, 18);       // each write is its own range: slot MAX-1 and slot 0 are not contiguous
  alphaAttr.addUpdateRange(j, 6);
}
