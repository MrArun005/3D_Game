import * as THREE from 'three';

/**
 * Shared Vehicle Framework.
 * 
 * Provides a polymorphic vehicle interface across Cars, Helicopters, and Tanks.
 * All controllable vehicles implement:
 * - update(input, dt, context)
 * - camera(chase, dt)
 * - enter(player)
 * - exit()
 * - solid()
 * - onMap()
 */
export class Vehicle {
  constructor(type = 'vehicle') {
    this.type = type; // 'car' | 'helicopter' | 'tank'
    this.driver = null;
    this.mesh = null;
    this.customRig = null;
    this.health = 100;
  }

  get isAirborne() { return this.type === 'helicopter'; }

  update(input, dt, context) {}
  camera(chase, dt) {
    if (chase) chase.update(this, dt);
  }
  enter(player) {
    this.driver = player;
  }
  exit() {
    this.driver = null;
  }
  solid() {
    return null;
  }
  onMap() {
    return {
      x: this.x || 0,
      z: this.z || 0,
      yaw: this.yaw || 0,
      type: this.type,
      icon: this.type,
    };
  }
}

/**
 * CarVehicle wraps the existing simulation state (dynamics.js)
 * with the standard Vehicle interface.
 */
export class CarVehicle extends Vehicle {
  constructor(state, stepFn, mesh = null) {
    super('car');
    this.state = state;
    this.stepFn = stepFn;
    this.mesh = mesh;
  }

  get x() { return this.state.x; }
  set x(v) { this.state.x = v; }
  get y() { return this.state.y; }
  set y(v) { this.state.y = v; }
  get z() { return this.state.z; }
  set z(v) { this.state.z = v; }

  get yaw() { return this.state.yaw; }
  set yaw(v) { this.state.yaw = v; }
  get pitch() { return this.state.pitch; }
  set pitch(v) { this.state.pitch = v; }
  get roll() { return this.state.roll; }
  set roll(v) { this.state.roll = v; }
  get heave() { return this.state.heave || 0; }

  get vx() { return this.state.vx; }
  set vx(v) { this.state.vx = v; }
  get vy() { return this.state.vy || 0; }
  set vy(v) { this.state.vy = v; }
  get vz() { return this.state.vz; }
  set vz(v) { this.state.vz = v; }

  get speed() { return this.state.speed; }
  get fwdSpeed() { return this.state.fwdSpeed; }
  get steer() { return this.state.steer; }
  get yawRate() { return this.state.yawRate; }
  get impact() { return this.state.impact; }
  get kerb() { return this.state.kerb; }
  get headlights() { return this.state.headlights; }
  set headlights(v) { this.state.headlights = v; }
  get nosActive() { return this.state.nosActive; }

  update(input, dt, context) {
    if (input) {
      this.state.throttle = input.throttle ?? 0;
      this.state.brake = input.brake ?? 0;
      this.state.steerTarget = input.steer ?? 0;
      this.state.hand = input.handbrake ?? 0;
      this.state.holdGear = !!input.hold;
      this.state.nos = !!input.nos;
    }
    if (this.stepFn) {
      this.stepFn(this.state, dt);
    }
  }

  camera(chase, dt) {
    if (chase) chase.update(this.state, dt);
  }

  solid() {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      radius: 2.2,
      reach: 4.8,
      vx: this.vx,
      vz: this.vz,
      tag: 'hero_car',
    };
  }

  onMap() {
    return {
      x: this.x,
      z: this.z,
      yaw: this.yaw,
      type: 'car',
      icon: 'car',
    };
  }
}
