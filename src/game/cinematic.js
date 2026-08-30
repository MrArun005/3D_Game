import * as THREE from 'three';

/**
 * A scripted camera pass for capture. Each shot gets the car, the camera and a
 * normalised time within the shot; `enter` runs once so a shot can pin a world
 * position and hold it while the car drives past.
 */
const v = new THREE.Vector3();

function forward(car) {
  return [Math.cos(car.yaw), -Math.sin(car.yaw)];
}
function rightward(car) {
  return [Math.sin(car.yaw), Math.cos(car.yaw)];
}

export const SHOTS = [
  {
    name: 'roll-in', duration: 6.0, fov: 52,
    update(t, car, cam) {
      const f = forward(car), r = rightward(car);
      const back = 8.4 - t * 2.0;
      const up = 1.55 + t * 0.55;
      cam.position.set(car.x - f[0] * back + r[0] * 0.8, up, car.z - f[1] * back + r[1] * 0.8);
      cam.lookAt(car.x + f[0] * 9, 0.9, car.z + f[1] * 9);
    },
  },
  {
    name: 'flyby', duration: 5.5, fov: 40,
    enter(car, cam, ctx) {
      const f = forward(car), r = rightward(car);
      // stand off to one side, well down the road, and simply watch
      ctx.anchor = [car.x + f[0] * 62 + r[0] * 11.5, 1.9, car.z + f[1] * 62 + r[1] * 11.5];
    },
    update(t, car, cam, ctx) {
      cam.position.set(ctx.anchor[0], ctx.anchor[1] + t * 0.5, ctx.anchor[2]);
      cam.lookAt(car.x, 0.85, car.z);
    },
  },
  {
    name: 'bonnet', duration: 4.5, fov: 62,
    update(t, car, cam) {
      const f = forward(car), r = rightward(car);
      cam.position.set(car.x + f[0] * 0.7 + r[0] * 0.02, 1.16 + car.heave, car.z + f[1] * 0.7);
      cam.lookAt(car.x + f[0] * 26, 1.0, car.z + f[1] * 26);
      cam.rotation.z += car.roll * 0.5;
    },
  },
  {
    name: 'crane', duration: 5.5, fov: 46,
    update(t, car, cam) {
      const f = forward(car), r = rightward(car);
      const h = 6 + t * 12;
      const back = 13 + t * 9;
      cam.position.set(car.x - f[0] * back - r[0] * 5, h, car.z - f[1] * back - r[1] * 5);
      cam.lookAt(car.x + f[0] * 6, 0.6, car.z + f[1] * 6);
    },
  },
  {
    name: 'chase-low', duration: 5.0, fov: 58,
    update(t, car, cam) {
      const f = forward(car), r = rightward(car);
      const side = Math.sin(t * Math.PI) * 2.6;
      cam.position.set(car.x - f[0] * 5.6 + r[0] * side, 0.95, car.z - f[1] * 5.6 + r[1] * side);
      cam.lookAt(car.x + f[0] * 12, 0.85, car.z + f[1] * 12);
    },
  },
  {
    name: 'orbit', duration: 6.5, fov: 44,
    update(t, car, cam) {
      const a = car.yaw + Math.PI * 0.55 + t * 2.1;
      const rad = 8.5 - t * 1.8;
      cam.position.set(car.x + Math.cos(a) * rad, 1.5 + t * 0.7, car.z + Math.sin(a) * rad);
      cam.lookAt(car.x, 0.80, car.z);
    },
  },
];

export class Cinematic {
  constructor(shots = SHOTS) {
    this.shots = shots;
    this.total = shots.reduce((a, s) => a + s.duration, 0);
    this.reset();
  }

  reset() {
    this.time = 0;
    this.shot = 0;
    this.ctx = {};
    this.entered = -1;
    this.finished = false;
  }

  update(car, camera, dt) {
    if (this.finished) return;
    this.time += dt;

    let acc = 0, index = 0;
    for (let i = 0; i < this.shots.length; i++) {
      if (this.time < acc + this.shots[i].duration) { index = i; break; }
      acc += this.shots[i].duration;
      index = i + 1;
    }
    if (index >= this.shots.length) { this.finished = true; return; }

    const shot = this.shots[index];
    if (this.entered !== index) {
      this.ctx = {};
      this.entered = index;
      if (shot.enter) shot.enter(car, camera, this.ctx);
      if (shot.fov) { camera.fov = shot.fov; camera.updateProjectionMatrix(); }
    }
    const t = Math.max(0, Math.min(1, (this.time - acc) / shot.duration));
    shot.update(t, car, camera, this.ctx);
  }
}
