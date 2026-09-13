/**
 * Video mode: a set of cinematic camera angles for Arun to record against while
 * HE drives. V cycles angle -> angle -> ... -> off. Entering warps the car to
 * the one spot that is verified to frame well (Halstead Avenue looking north
 * through Little Tokyo, sun at the road's end at 17:24 -- see the golden-hour
 * commits) and hides the HUD with the same body class film mode uses. The
 * angles are plain `customRig` objects: camera.js already honours every field
 * (back, up, side, aim, aimUp, aimSide, fov, lag, tilt, rigid, near), so this
 * file owns no camera maths, only the numbers and the bookkeeping around them.
 */
import { RIGS } from './camera.js';

export const SPOT = { x: 2210, z: 1392, yaw: -Math.PI / 2, hour: 17.4, name: 'HALSTEAD AVENUE · LITTLE TOKYO' };

export const ANGLES = [
  // the shot brief: just above the spoiler, car lower-middle, asphalt below it
  { name: 'LOW CHASE',    rig: { ...RIGS[0] } },
  // lens on the tarmac: the car towers, lane stripes race underneath
  { name: 'ROAD HUGGER',  rig: { back: 8.5, up: 0.55, aim: 9.0, aimUp: 0.9, fov: 62, lag: 4.5, tilt: 1 } },
  // alongside, looking AT the car (aimSide 0), a three-quarter profile that tracks
  { name: 'SIDE TRACK',   rig: { back: 0.8, up: 1.25, side: 4.2, aimSide: 0, aim: 1.5, aimUp: 0.55, fov: 50, lag: 6.0, tilt: 0 } },
  // camera ahead of the car looking back at its nose: the pursuit hero shot
  { name: 'HERO REVERSE', rig: { back: 9.0, up: 1.2, aim: 2.0, aimUp: 0.7, fov: 45, lag: 5.0, tilt: 0, lookBack: 1 } },
  // high and behind, narrow lens: the canyon and the whole avenue
  { name: 'HIGH DRONE',   rig: { back: 14.0, up: 7.0, aim: 10.0, aimUp: 0.0, fov: 40, lag: 2.6, tilt: 0 } },
  { name: 'BONNET',       rig: { ...RIGS[2] } },
  { name: 'COCKPIT',      rig: { ...RIGS[4] }, interior: true },
];

export class VideoMode {
  #i = -1;
  constructor({ car, chase, hero, hud, clock, warpTo }) {
    Object.assign(this, { car, chase, hero, hud, clock, warpTo });
  }
  get on() { return this.#i >= 0; }
  get angle() { return this.on ? ANGLES[this.#i] : null; }

  /** V. Off -> first angle (and the warp); on -> next angle; past the last -> off. */
  cycle() {
    if (!this.on) {
      this.warpTo(SPOT.x, SPOT.z, SPOT.yaw);
      this.clock.hour = SPOT.hour;
      document.body.classList.add('filming');
    }
    this.#i += 1;
    if (this.#i >= ANGLES.length) return this.exit();
    this.#apply(ANGLES[this.#i]);
  }

  exit() {
    if (!this.on) return;
    this.#i = -1;
    this.car.customRig = null;
    this.chase.setLookBack(false);
    const d = this.hero?.userData?.driver;
    if (d) d.visible = !this.chase.interior;
    document.body.classList.remove('filming');
    this.hud.flash('VIDEO OFF');
  }

  #apply(a) {
    this.car.customRig = a.rig;
    const d = this.hero?.userData?.driver;
    if (d) d.visible = !a.interior;   // the cockpit angle puts the eye where his head is
    this.hud.flash(`VIDEO · ${a.name}  (${this.#i + 1}/${ANGLES.length}) · V next`);
  }
}
