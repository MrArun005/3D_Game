import * as THREE from 'three';
import { roadDepth, WALK_W } from '../world/metrics.js';

/**
 * How much rain the LENS carries, 0..1.
 *
 * It used to be `DAY ? 0 : mode >= 2 ? 1.2 : 0.68` in main.js -- every night,
 * rain or not, and just as heavy sitting dry inside a hard-top. Drops belong
 * on glass you are looking through or on a lens out in the weather:
 *   - nothing when it is not raining,
 *   - the interior rigs (2, 3) look through the windscreen, so they keep the
 *     heavier sheet, unless the vehicle says it is open-topped. (ponytail: no
 *     vehicle sets `roof` yet, so today this branch is always the roofed one;
 *     it is the one-word hook for when a convertible lands.)
 *   - the chase rigs are a camera out in it: lighter.
 * Pure, so it is checkable without a browser.
 */
export function lensDrops({ wet = 0, mode = 0, onFoot = false, roof = true } = {}) {
  const w = Math.max(0, Math.min(1, wet));
  if (w < 0.05) return 0;
  if (onFoot) return 0.55 * w;
  const inside = mode >= 2 && roof;
  return (inside ? 1.15 : 0.62) * w;
}

/* Chase distances. The default sat at 7.6 m with a 60 deg lens, which framed
   a lot of road and a small car; 6.5 m at 58 deg fills more of the frame with
   the car without losing the corner you are turning into, and the aim point
   comes in with it so the horizon does not ride up. The close rig follows by
   the same proportion. */
const RIGS = [
  { back: 6.5, up: 2.62, aim: 7.2, fov: 58, lag: 3.4, tilt: 1 },
  { back: 4.7, up: 1.92, aim: 8.2, fov: 63, lag: 6.0, tilt: 1 },
  { back: -1.3, up: 1.28, aim: 14.0, fov: 62, lag: 22.0, tilt: 0 },
  { back: -0.55, up: 1.3, aim: 16.0, fov: 55, lag: 26.0, tilt: 0 },
  /* COCKPIT. Every number here was found by putting the camera there and
     LOOKING, not by reading model.js -- the interior's local coordinates
     (dash at x 1.88, headrest 2.70) do not sit in the frame this rig works in,
     and reasoning from them put the eye on the bonnet. Swept: back 0.4 is on
     the nose, 1.2 straddles the windscreen, 2.0 sits on the roof; at back 1.9,
     up 0.40 climbs back onto the bodywork and 0.30 is inside the cabin. Side
     0.72 buries the eye in the door, -0.36 throws the wheel to the far left.
     Three things this rig needs that no chase rig does:
       rigid  the camera is BOLTED to the shell. Any follow lag and the dash and
              wheel, which are children of that shell, swim against their own
              car -- the one place the follower is wrong rather than soft.
       near   the default near plane is 0.5 m (main.js) and the dash is closer
              than that, so it would be sliced open. 0.15 costs some far-field
              depth precision, and only while you sit here.
       fov    70: an interior camera has to hold the dash, the mirrors and the
              road. 55 through a windscreen is a letterbox.
     `side` is the first lateral offset any rig has asked for. */
  { back: 1.9, up: 0.30, side: 0.36, aim: 18.0, fov: 70, lag: 26.0, tilt: 1, rigid: 1, near: 0.15 },
];

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 4, -10);
    this.aim = new THREE.Vector3();
    this.shake = 0;
    this.lastImpact = 0;   // impact seen last frame: shake is kicked by the RISE, not the standing value
    /* Suspension follower. car.heave is the body's displacement from nominal
       ride height (dynamics.js), integrated from the springs -- the camera
       rides a critically-damped copy of it, so a kerb pushes the camera and
       lets it settle instead of welding it to the axles. */
    this.heaveSm = 0;
    this.heaveV = 0;
    this.vibT = 0;         // vibration phase in seconds: sines of TIME, so the shake is the same at 60 and 120 Hz
    this.drops = 0;        // 0..1 rain on the lens, read by main.js -> grade.setDrops
    /* Free look. Without it the camera is welded behind the car, which is why
       a helicopter orbiting 60m overhead was invisible: there was no way to
       point the view at anything the car was not driving towards. */
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.looking = false;
    this.lookBehind = false;
    this.mouseIdle = 0;
  }

  /** Mouse delta, in pixels. */
  look(dx, dy) {
    this.lookYaw -= dx * 0.0032;
    this.lookPitch = Math.max(-0.5, Math.min(1.15, this.lookPitch - dy * 0.0026));
    this.looking = true;
    this.mouseIdle = 0;
  }

  setLookBack(active) {
    this.lookBehind = !!active;
  }

  recentre() { this.lookYaw = 0; this.lookPitch = 0; this.looking = false; this.mouseIdle = 0; }

  cycle() { this.mode = (this.mode + 1) % RIGS.length; }
  /** True while the eye is inside the cabin: main.js hides the modelled driver,
      whose head is otherwise exactly where the camera now is. */
  get interior() { return !!RIGS[this.mode].side; }   // car.customRig is a cinematic override; those keep the driver
  /** Put the camera where it would settle, now. For spawns and respawns: the
      follow lag is what sends it flying across the city after a 2 km jump. */
  snap(car) { this.update(car, 60); }

  update(car, dt) {
    const rig = car.customRig ?? RIGS[this.mode];
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const rx = sy, rz = cy;
    const speedK = Math.min(1, (car.speed || 0) / 42);
    let back = rig.back * (1 + speedK * 0.18);

    /* Suspension. The follow lag below smooths car.y, but it smooths the BODY
       and the springs equally: over a kerb the camera copied the axles. Take
       the spring travel out of the target and add back a damped copy of it --
       the part the follower has not caught up with is the bob, capped at
       0.45 m so a ramp jump still tracks the car. w=9 rad/s, zeta=1. */
    const heave = car.heave || 0;
    if (dt > 0.25) { this.heaveSm = heave; this.heaveV = 0; }   // snap(): a 2 km teleport must not spring
    else {
      const h = Math.min(dt, 1 / 30), w = 9;
      this.heaveV += (-(this.heaveSm - heave) * w * w - this.heaveV * 2 * w) * h;
      this.heaveSm += this.heaveV * h;
    }
    const bob = Math.max(-0.45, Math.min(0.45, heave - this.heaveSm));
    const targetY = (car.y ?? 0) - bob;

    // Don't let a chase camera reverse into a building. Walk it in until the
    // point it wants to occupy is over tarmac or pavement. Only apply near ground (< 5m).
    if (rig.back > 0 && targetY < 5) {
      for (let i = 0; i < 6; i++) {
        const tx = car.x - cy * back, tz = car.z + sy * back;
        if (roadDepth(tx, tz) < WALK_W - 0.5) break;
        back *= 0.78;
      }
    }

    // Auto-recenter after 2 seconds of no mouse look input
    if (this.looking) {
      this.mouseIdle += dt;
      if (this.mouseIdle > 2.0) this.recentre();
    }

    /* The look offset orbits the rig around the car rather than just turning
       the camera, so you can see the flank of your own car, the road behind,
       and the sky above it. */
    let ly = this.lookYaw;
    if (this.lookBehind) ly += Math.PI; // Instant look-back snap
    const lift = Math.sin(this.lookPitch);
    const flat = Math.cos(this.lookPitch);
    const ox = Math.cos(ly) * (-cy) - Math.sin(ly) * (sy);
    const oz = Math.sin(ly) * (-cy) + Math.cos(ly) * (sy);
    const side = rig.side ?? 0;
    const tx = car.x + ox * back * flat + rx * side;
    const tz = car.z + oz * back * flat + rz * side;
    const ty = targetY + rig.up + lift * back * 1.15;
    const k = rig.rigid ? 1 : 1 - Math.pow(0.0016, dt * (rig.lag / 3.4));
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.y += (ty - this.pos.y) * k;
    this.pos.z += (tz - this.pos.z) * k;

    /* Shake is kicked once per impact EVENT and capped. It used to add
       impact * 0.022 every FRAME while main.js let impact decay over half a
       second: ~3.5x the kick, frame-rate dependent (twice as hard at 120 Hz),
       and a 20 m/s wall threw the camera 2 m a frame. 0.07 per m/s of rise
       lands a real crash about where it was at 60 fps; 1.6 m is the ceiling
       whatever hits you. */
    const impact = car.impact || 0;
    const rise = Math.max(0, impact - this.lastImpact);
    this.lastImpact = impact;
    this.shake = Math.min(1.6, this.shake * Math.exp(-dt * 6) + rise * 0.07);
    /* Speed vibration. The old `(Math.random()-0.5) * speedK * 0.008` per
       FRAME buzzed twice as often at 120 Hz as at 60 -- same amplitude, a
       different texture. Two incommensurate sines of accumulated TIME give
       the same motion at any frame rate. Quadratic in speed so town driving
       is still. 6 mm at 150 km/h, 22 mm over a kerb. */
    this.vibT = (this.vibT + dt) % 3600;
    const vib = speedK * speedK * (car.kerb ? 0.022 : 0.006);
    const t = this.vibT;
    const vx = (Math.sin(t * 61.3) + Math.sin(t * 43.1) * 0.6) * vib;
    const vy = (Math.sin(t * 52.7 + 1.7) + Math.sin(t * 37.9) * 0.6) * vib * 0.7;
    const vz = (Math.sin(t * 47.3 + 3.1) + Math.sin(t * 68.2) * 0.6) * vib;
    const j = this.shake;   // the impact kick stays a random jolt: it is an impulse, not a tone
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * j + vx,
      this.pos.y + (Math.random() - 0.5) * j * 0.55 + vy,
      this.pos.z + (Math.random() - 0.5) * j + vz,
    );

    // rain on the lens, for main.js -> grade.setDrops (see lensDrops above)
    this.drops = lensDrops({ wet: car.wet || 0, mode: this.mode, roof: car.roof !== false });

    /* Look-ahead has to be earned by speed. A fixed 2.4m of swing at a
       standstill turns the whole screen when the car itself cannot move,
       which reads as the camera steering instead of the car. */
    const look = (car.steer || 0) * speedK * 6.0;
    /* Look FURTHER ahead the faster you go. At a standstill you are looking at
       your own car; at speed you need the corner. Same principle every racing
       camera uses, and the reason GTA players complain they cannot see through
       a turn. */
    const aimAhead = 1 + speedK * 0.55;
    // when free-looking or looking behind, aim through the car rather than down the road
    const aimD = (this.looking || this.lookBehind) ? 2.0 : rig.aim * aimAhead;
    /* Sliding: the car POINTS one way and TRAVELS another, and a camera locked
       to the heading leaves you staring at your own flank through a drift --
       the single loudest complaint about GTA IV's chase view. Lean the aim a
       third of the way toward the travel direction, capped, so a drift shows
       the corner you are sliding into. Heading, never velocity, stays the
       anchor: following velocity outright makes the camera jump the moment
       you leave the ground. */
    let slipX = 0, slipZ = 0;
    if (!this.looking && !this.lookBehind) {
      const vx2 = car.vx || 0, vz2 = car.vz || 0, sp = Math.hypot(vx2, vz2);
      if (sp > 4) {
        const fx = cy, fz = -sy;                       // the car's own forward
        const cross = fx * (vz2 / sp) - fz * (vx2 / sp);
        const slip = Math.max(-0.45, Math.min(0.45, cross)) * speedK;
        slipX = rx * slip * 5.5; slipZ = rz * slip * 5.5;
      }
    }
    this.aim.set(
      car.x - ox * aimD * flat + rx * (look + side) + slipX,
      targetY + 0.95 - lift * aimD * 0.4,
      car.z - oz * aimD * flat + rz * (look + side) + slipZ,
    );
    this.camera.lookAt(this.aim);
    if (rig.tilt) this.camera.rotation.z += (car.roll || 0) * 0.35 - (car.yawRate || 0) * 0.018;

    const nosBoost = car.nosActive ? 11 : 0;
    /* The rig's OWN lens. This read a hard-coded 62 and threw away every value
       in RIGS -- the bonnet rig asks for 55 and got 62, which is why the
       cockpit views felt wide and far. Widening with speed is the one thing
       every driving game agrees on (art of rally: "we expand the FOV when
       you're going faster"): +12 deg by ~150 km/h, and the nitrous kick on top. */
    const fov = (rig.fov ?? 62) + speedK * 12 + nosBoost;
    const near = rig.near ?? 0.5;
    let reproject = false;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 5.5); reproject = true; }
    // stepped, not eased: the near plane is not a look, and easing it would crawl the whole far field
    if (this.camera.near !== near) { this.camera.near = near; reproject = true; }
    if (reproject) this.camera.updateProjectionMatrix();
  }
}
