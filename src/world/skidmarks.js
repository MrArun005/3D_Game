import * as THREE from 'three';

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

const MAX = 900;                   // quads in the ring, per wheel pair
const MIN_STEP = 0.35;             // metres between samples
const WIDTH = 0.24;

export class SkidMarks {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 6 * 3);
    this.alpha = new Float32Array(MAX * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    /* A plain transparent black would be a wet-look smear. Rubber reads as a
       dark stain that fades along its own length, so the strength travels in
       a vertex attribute rather than a uniform. */
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: {},
      vertexShader: `
        attribute float aAlpha;
        varying float vA;
        void main() {
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          if (vA <= 0.004) discard;
          gl_FragColor = vec4(0.04, 0.04, 0.045, vA * 0.62);
        }`,
    });

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

    for (let s = 0; s < 2; s++) this.#quad(this.last[s], pts[s], strength, groundY);
    this.last = pts;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  #quad(a, b, strength, y) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * (WIDTH / 2), nz = (dx / L) * (WIDTH / 2);
    const i = (this.head % MAX) * 18;
    const p = this.pos;
    const yy = y + 0.012;
    p[i]      = a[0] + nx; p[i + 1]  = yy; p[i + 2]  = a[1] + nz;
    p[i + 3]  = b[0] + nx; p[i + 4]  = yy; p[i + 5]  = b[1] + nz;
    p[i + 6]  = b[0] - nx; p[i + 7]  = yy; p[i + 8]  = b[1] - nz;
    p[i + 9]  = a[0] + nx; p[i + 10] = yy; p[i + 11] = a[1] + nz;
    p[i + 12] = b[0] - nx; p[i + 13] = yy; p[i + 14] = b[1] - nz;
    p[i + 15] = a[0] - nx; p[i + 16] = yy; p[i + 17] = a[1] - nz;
    const j = (this.head % MAX) * 6;
    for (let k = 0; k < 6; k++) this.alpha[j + k] = strength;
    this.head++;
  }
}
