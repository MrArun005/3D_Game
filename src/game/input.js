/** Keyboard + standard-layout gamepad. Stick and triggers stay analogue.
 *
 * The pad is laid out for a DualSense read through the browser's standard
 * mapping (Chrome, Edge, Safari; an Xbox pad lands on the same positions:
 * A = Cross, B = Circle, X = Square, Y = Triangle). GTA V's PS5 layout
 * wherever this game has the verb:
 *
 *              in the car                   on foot
 *   L stick    steer                        walk / run, analogue
 *   R stick    look                         look
 *   R2 / L2    throttle / brake-reverse     fire / aim
 *   Cross      handbrake                    sprint (hold)
 *   Square     headlights                   jump
 *   Triangle   get out                      get in
 *   Circle     camera                       reload
 *   L1 / R1    hold gear + NOS / fire       -
 *   L3 / R3    horn / look back             crouch / -
 *   D-pad      up phone, left-right radio   up phone, left-right weapon
 *   touchpad   map                          map
 *   Options    take / abandon a job         take / abandon a job
 *   Create     respawn                      respawn
 *
 * While a menu has the pad (ui/padnav.js) its face buttons and D-pad belong
 * to the menu; on a modal one (title card, map) the sticks and triggers too.
 */

const STICK_DZ = 0.12;
const TRIG_DZ = 0.04;
/* Right stick at full throw, in mouse pixels per second: ~3.0 rad/s of yaw
   and ~1.7 rad/s of pitch at look()'s 0.0032 / 0.0026 rad per pixel.
   ponytail: fixed rates; a sensitivity setting when someone asks for one. */
const LOOK_X = 950;
const LOOK_Y = 650;

/* Button index -> the action its press raises. Held buttons (the triggers,
   Cross, L1, R1, R3, Square on foot) are read by padControls instead. */
export const PAD_CAR = { 1: 'camera', 2: 'lights', 3: 'use', 8: 'reset', 9: 'run', 10: 'horn', 12: 'phone', 14: 'radio', 15: 'radio', 17: 'map' };
export const PAD_FOOT = { 1: 'reload', 3: 'use', 8: 'reset', 9: 'run', 10: 'camera', 12: 'phone', 14: 'prevgun', 15: 'nextgun', 17: 'map' };
const PAD_BUTTONS = 18;   // 0-15 standard, 16 PS, 17 touchpad click

export function deadzone(v, dz = STICK_DZ) {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** Keyboard A is steerTarget +1. Stick left is axis -1, so we flip. */
export function axisToSteer(x, dz = STICK_DZ) {
  const s = deadzone(x, dz);
  return s === 0 ? 0 : -s;
}

/* Keyboard steering ramp, in steerTarget units per second: 6/s out when
   parking, falling to 2.5/s by 137 km/h (vHi, m/s -- dynamics.js's own
   speedNorm), and 8/s back to centre at any speed. */
export const KEY_STEER = { outLo: 6.0, outHi: 2.5, back: 8.0, vHi: 38 };

/**
 * One frame of the keyboard's steerTarget: move `cur` toward the key (-1, 0,
 * +1, or a scripted fraction) at a CONSTANT rate. Pure, tested.
 *
 * It replaced an exponential ease in main.js (`cur += (key - cur) * dt*rate`),
 * which had two faults:
 *   - it never reached 0, and dynamics.js's 2x return rate is gated on
 *     `steerTarget === 0`, so on a key release the wheel went on chasing a
 *     decaying target at the OUTWARD rate: a 0.1 s tap at 120 km/h kept
 *     steering after the key was up and turned the car 8.0 deg (62% of a
 *     1 s hold);
 *   - its "returning" test was a sign compare, which counts a centred wheel
 *     as returning, so the first frame of every press ran at 2.2x.
 * Constant-rate steps land on the key exactly and are frame-rate independent:
 * a reversal (A straight to D) returns to 0 at the back rate and spends what
 * is left of the frame going out the other side, so 60 Hz and 144 Hz agree.
 */
export function keyboardSteer(cur, key, speed, dt, k = KEY_STEER) {
  if (!(dt > 0)) return cur;
  if (key * cur < 0) {   // the other key: back through centre first, then out with the rest of the frame
    const toZero = Math.abs(cur) / k.back;
    if (toZero >= dt) return cur - Math.sign(cur) * k.back * dt;
    return keyboardSteer(0, key, speed, dt - toZero, k);
  }
  const back = key === 0 || Math.abs(key) < Math.abs(cur);
  const rate = back ? k.back : k.outLo + (k.outHi - k.outLo) * Math.min(1, Math.abs(speed) / k.vHi);
  const step = rate * dt, d = key - cur;
  return Math.abs(d) <= step ? key : cur + Math.sign(d) * step;
}

export function mergeDrive(kb, pad) {
  const padLive = pad.throttle > 0.02 || pad.brake > 0.02
    || Math.abs(pad.steer) > 0.02 || pad.handbrake > 0.1 || pad.hold;
  const padSteers = Math.abs(pad.steer) >= Math.abs(kb.steer);
  return {
    throttle: Math.max(kb.throttle, pad.throttle),
    brake: Math.max(kb.brake, pad.brake),
    steer: padSteers ? pad.steer : kb.steer,
    handbrake: Math.max(kb.handbrake, pad.handbrake),
    hold: !!(kb.hold || pad.hold),
    nos: !!(kb.nos || pad.nos),
    lookBack: !!(kb.lookBack || pad.lookBack),
    analogue: !!(padLive && (pad.throttle > 0.02 || pad.brake > 0.02 || Math.abs(pad.steer) > 0.02)),
    /* Whether the STEER value came off a stick or a touch strip (pass it
       straight through) or off a key (ramp it: keyboardSteer). `analogue`
       was used for both, so holding R2 while steering with A/D handed the
       binary +-1 straight to steerTarget -- instant full lock. `analogue`
       stays for the pedal lags. `kb` can itself be a merge (touch merges over
       keys+pad), so a steer it already owned keeps its flag. */
    steerAnalogue: padSteers ? Math.abs(pad.steer) > 0.02 : !!kb.steerAnalogue,
    fire: !!(kb.fire || pad.fire),        // the pad's; the mouse buttons are main.js's. Either side:
    aim: !!(kb.aim || pad.aim),           // touch merges as mergeDrive(c, t) over the pad's result
    lookX: (kb.lookX || 0) + (pad.lookX || 0),   // right stick, mouse pixels per second
    lookY: (kb.lookY || 0) + (pad.lookY || 0),
  };
}

function buttonValue(button) {
  if (!button) return 0;
  const v = button.value;
  return v > TRIG_DZ ? Math.min(1, v) : 0;
}

function pressed(button) {
  return !!(button && (button.pressed || button.value > 0.5));
}

/** Some browsers expose analogue triggers as axes resting at 0 or -1. */
function trigger(button, ...axes) {
  let v = buttonValue(button);
  for (const a of axes) {
    if (!Number.isFinite(a)) continue;
    const n = a < 0 ? (a + 1) * 0.5 : a;
    if (n > TRIG_DZ) v = Math.max(v, Math.min(1, n));
  }
  return v;
}

/** One pad's held controls. `p` is a Gamepad, or anything with axes and buttons. */
export function padControls(p, foot) {
  const b = p.buttons, ax = p.axes;
  /* squared: fine aim near the centre. Standard mapping only -- a raw layout
     can rest a trigger at -1 on axis 2 or 3, which would pitch the view forever. */
  const look = (v) => { const s = p.mapping === 'standard' ? deadzone(v ?? 0) : 0; return s * Math.abs(s); };
  const r2 = trigger(b[7], ax[5], ax[7]);
  const l2 = trigger(b[6], ax[4], ax[6]);
  const out = {
    throttle: r2, brake: l2, steer: axisToSteer(ax[0] ?? 0),
    handbrake: buttonValue(b[0]), hold: pressed(b[4]), nos: pressed(b[4]),
    lookBack: pressed(b[11]), fire: pressed(b[5]), aim: false,
    lookX: look(ax[2]) * LOOK_X, lookY: look(ax[3]) * LOOK_Y,
  };
  if (foot) {
    /* onfoot.js reads the drive fields: throttle - brake is forward, steer
       strafes, handbrake jumps, hold sprints. The stick feeds them here so
       the triggers are free to shoot. Stick up is axis -1. */
    const ly = deadzone(ax[1] ?? 0);
    out.throttle = Math.max(0, -ly);
    out.brake = Math.max(0, ly);
    out.handbrake = pressed(b[2]) ? 1 : 0;
    out.hold = pressed(b[0]);
    out.nos = out.lookBack = false;
    out.fire = r2 > 0.3;
    out.aim = l2 > 0.3;
  }
  return out;
}

function readPad(foot) {
  const acc = { throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: false, nos: false,
                lookBack: false, fire: false, aim: false, lookX: 0, lookY: 0, buttons: [] };
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return acc;
  for (const p of navigator.getGamepads()) {
    if (!p) continue;
    const s = padControls(p, foot);
    // two pads must not sum: the larger deflection wins (a resting second pad adds nothing either way)
    if (Math.abs(s.steer) > Math.abs(acc.steer)) acc.steer = s.steer;
    if (Math.abs(s.lookX) > Math.abs(acc.lookX)) acc.lookX = s.lookX;
    if (Math.abs(s.lookY) > Math.abs(acc.lookY)) acc.lookY = s.lookY;
    acc.throttle = Math.max(acc.throttle, s.throttle);
    acc.brake = Math.max(acc.brake, s.brake);
    acc.handbrake = Math.max(acc.handbrake, s.handbrake);
    acc.hold ||= s.hold; acc.nos ||= s.nos; acc.lookBack ||= s.lookBack;
    acc.fire ||= s.fire; acc.aim ||= s.aim;
    for (let i = 0; i < PAD_BUTTONS; i++) if (pressed(p.buttons[i])) acc.buttons[i] = true;
  }
  return acc;
}

export function rumble(mag, ms = 90) {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const g = Math.max(0, Math.min(1, mag));
  if (g < 0.04) return;
  for (const p of navigator.getGamepads()) {
    const act = p?.vibrationActuator;
    const play = act?.playEffect?.('dual-rumble', {
      duration: ms,
      strongMagnitude: g,
      weakMagnitude: g * 0.55,
    });
    if (play && typeof play.catch === 'function') play.catch(() => {});
  }
}

export function padConnected() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
  return [...navigator.getGamepads()].some(Boolean);
}

export function createInput(onAction, { chatAllowed = () => true } = {}) {
  const keys = Object.create(null);
  const blocked = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  const prevDown = [];   // pad buttons last frame, by index

  addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (isTyping) {
      if (e.code === 'Escape') onAction('chatClose');
      return;
    }

    if (e.code === 'Enter' && chatAllowed()) {   // KeyY dropped (it collided with nothing useful and typed into chat); Enter in photo mode is photo.shot()
      e.preventDefault();
      // Clear held keys so car doesn't roll forward while typing
      for (const k of Object.keys(keys)) keys[k] = false;
      onAction('chat');
      return;
    }

    keys[e.code] = true;
    if (blocked.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyC') onAction('camera');
    if (e.code === 'KeyH') onAction('lights');
    /* Shift+R starts the scenic route; plain R stays RESPAWN. R is how you get
       unstuck, so it does not get taken away -- pressing it by reflex after a
       crash must never launch a 5.7 km drive. */
    if (e.code === 'KeyR') onAction(e.shiftKey ? 'mile' : 'reset');
    if (e.code === 'KeyV') onAction(e.shiftKey ? 'film' : 'video');   // V: video angles while YOU drive; Shift+V: the autopilot film
    if (e.code === 'KeyM') onAction('phone'); // iFruit GTA phone
    if (e.code === 'KeyU') onAction('mute');
    if (e.code === 'KeyB') onAction('garage'); // browse bodies
    if (e.code === 'KeyL') onAction('radio');  // cycle radio stations
    if (e.code === 'KeyN') onAction('buy');    // buy / fit / repair
    if (e.code === 'Tab') { e.preventDefault(); onAction('map'); }
    if (e.code === 'KeyF') onAction('use');    // in or out of a vehicle
    if (e.code === 'KeyG') onAction('run');    // start / abandon a checkpoint run
    if (e.code === 'KeyJ') onAction('room');   // create / join a multiplayer room
    if (e.code === 'KeyE') onAction('fire');   // fire; left mouse does the same
    if (e.code === 'KeyK') onAction('avatar'); // cycle which character you are
    if (e.code === 'KeyP') onAction('photo');  // photo mode: free camera + the plan's acceptance presets
    if (e.code === 'KeyO') onAction('tour');   // automated feature tour and demo video recording
    if (e.code === 'KeyT') onAction(e.shiftKey ? 'track' : 'time');   // Shift+T: Halstead Raceway; T: advance clock 3 hours
    if (e.code === 'KeyI') onAction('horn');   // the horn: pedestrians ahead scatter, the car in front gets a move on
    // weapons: 1-4 select, X reloads. Digits are the only keys left that a
    // driving game has not already spent, and they are what shooters use.
    if (e.code === 'Digit1') onAction('weapon1');
    if (e.code === 'Digit2') onAction('weapon2');
    if (e.code === 'Digit3') onAction('weapon3');
    if (e.code === 'Digit4') onAction('weapon4');
    if (e.code === 'Digit5') onAction('weapon5');   // grenades
    if (e.code === 'Digit6') onAction('weapon6');   // the sniper rifle (fifth gun; 5 stays grenades)
    if (e.code === 'Digit0' || e.code === 'Backquote') onAction('weapon0');   // fists
    if (e.code === 'KeyX') onAction('reload');
    if (e.code === 'Backslash') onAction('cinematic');   // clean frame: speed + objective only
    if (e.code === 'KeyZ') onAction('intel');   // Astra tactical AI scanner toggle
  });
  addEventListener('keyup', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }
    keys[e.code] = false;
  });

  return {
    keys,
    /** `foot`: on-foot layout. `ui`: the menu that has the pad this frame (padnav.update). */
    read(foot = false, ui = null) {
      const kb = {
        throttle: keys.KeyW || keys.ArrowUp ? 1 : 0,
        brake: keys.KeyS || keys.ArrowDown ? 1 : 0,
        steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0),
        handbrake: keys.Space ? 1 : 0,
        hold: !!(keys.ShiftLeft || keys.ShiftRight),
        nos: !!(keys.ShiftLeft || keys.ShiftRight),
        lookBack: !!keys.KeyQ,
      };
      const pad = readPad(foot);
      const table = foot ? PAD_FOOT : PAD_CAR;
      for (let i = 0; i < PAD_BUTTONS; i++) {
        const down = !!pad.buttons[i];
        if (down && !prevDown[i] && !ui && table[i]) onAction(table[i]);
        prevDown[i] = down;   // tracked under a menu too, so closing it with a held button raises nothing
      }
      if (ui) {
        pad.handbrake = 0;
        pad.hold = pad.nos = pad.lookBack = pad.fire = pad.aim = false;
        if (ui.modal) pad.throttle = pad.brake = pad.steer = pad.lookX = pad.lookY = 0;
      }
      return mergeDrive(kb, pad);
    },
  };
}
