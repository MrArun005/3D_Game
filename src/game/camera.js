import * as THREE from 'three';
import { roadDepth, WALK_W } from '../world/metrics.js';

const RIGS = [
  { back: 7.6, up: 2.85, aim: 8.0, fov: 60, lag: 3.4, tilt: 1 },
  { back: 5.4, up: 2.05, aim: 9.0, fov: 66, lag: 6.0, tilt: 1 },
  { back: -1.3, up: 1.28, aim: 14.0, fov: 62, lag: 22.0, tilt: 0 },
  { back: -0.55, up: 1.3, aim: 16.0, fov: 55, lag: 26.0, tilt: 0 },
];

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 4, -10);
    this.aim = new THREE.Vector3();
    this.shake = 0;
    /* Free look. Without it the camera is welded behind the car, which is why
       a helicopter orbiting 60m overhead was invisible: there was no way to
       point the view at anything the car was not driving towards. */
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.looking = false;
  }

  /** Mouse delta, in pixels. */
  look(dx, dy) {
    this.lookYaw -= dx * 0.0032;
    this.lookPitch = Math.max(-0.5, Math.min(1.15, this.lookPitch - dy * 0.0026));
    this.looking = true;
  }

  recentre() { this.lookYaw = 0; this.lookPitch = 0; this.looking = false; }

  cycle() { this.mode = (this.mode + 1) % RIGS.length; }

  update(car, dt) {
    const rig = RIGS[this.mode];
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const rx = sy, rz = cy;
    const speedK = Math.min(1, car.speed / 42);
    let back = rig.back * (1 + speedK * 0.18);

    // Don't let a chase camera reverse into a building. Walk it in until the
    // point it wants to occupy is over tarmac or pavement.
    if (rig.back > 0) {
      for (let i = 0; i < 6; i++) {
        const tx = car.x - cy * back, tz = car.z + sy * back;
        if (roadDepth(tx, tz) < WALK_W - 0.5) break;
        back *= 0.78;
      }
    }

    /* The look offset orbits the rig around the car rather than just turning
       the camera, so you can see the flank of your own car, the road behind,
       and the sky above it. */
    const ly = this.lookYaw;
    const lift = Math.sin(this.lookPitch);
    const flat = Math.cos(this.lookPitch);
    const ox = Math.cos(ly) * (-cy) - Math.sin(ly) * (sy);
    const oz = Math.sin(ly) * (-cy) + Math.cos(ly) * (sy);
    const tx = car.x + ox * back * flat;
    const tz = car.z + oz * back * flat;
    const ty = rig.up + car.heave + lift * back * 1.15;
    const k = 1 - Math.pow(0.0016, dt * (rig.lag / 3.4));
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.y += (ty - this.pos.y) * k;
    this.pos.z += (tz - this.pos.z) * k;

    this.shake = this.shake * Math.exp(-dt * 6) + (car.impact || 0) * 0.022;
    const rumble = speedK * (car.kerb ? 0.028 : 0.008);
    const j = this.shake + rumble;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * j,
      this.pos.y + (Math.random() - 0.5) * j * 0.55,
      this.pos.z + (Math.random() - 0.5) * j,
    );

    /* Look-ahead has to be earned by speed. A fixed 2.4m of swing at a
       standstill turns the whole screen when the car itself cannot move,
       which reads as the camera steering instead of the car. */
    const look = car.steer * speedK * 6.0;
    // when free-looking, aim through the car rather than down the road
    const aimD = this.looking ? 2.0 : rig.aim;
    this.aim.set(
      car.x - ox * aimD * flat + rx * look,
      0.95 + car.heave - lift * aimD * 0.4,
      car.z - oz * aimD * flat + rz * look,
    );
    this.camera.lookAt(this.aim);
    if (rig.tilt) this.camera.rotation.z += car.roll * 0.35 - car.yawRate * 0.018;

    const fov = rig.fov + speedK * 9;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }
}
