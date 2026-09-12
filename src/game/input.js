/** Keyboard + standard-layout gamepad. Stick and triggers stay analogue. */

const STICK_DZ = 0.12;
const TRIG_DZ = 0.04;

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

export function mergeDrive(kb, pad) {
  const padLive = pad.throttle > 0.02 || pad.brake > 0.02
    || Math.abs(pad.steer) > 0.02 || pad.handbrake > 0.1 || pad.hold;
  return {
    throttle: Math.max(kb.throttle, pad.throttle),
    brake: Math.max(kb.brake, pad.brake),
    steer: Math.abs(pad.steer) >= Math.abs(kb.steer) ? pad.steer : kb.steer,
    handbrake: Math.max(kb.handbrake, pad.handbrake),
    hold: !!(kb.hold || pad.hold),
    nos: !!(kb.nos || pad.nos),
    lookBack: !!(kb.lookBack || pad.lookBack),
    analogue: !!(padLive && (pad.throttle > 0.02 || pad.brake > 0.02 || Math.abs(pad.steer) > 0.02)),
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

function readPad() {
  const empty = { throttle: 0, brake: 0, steer: 0, handbrake: 0, hold: false, downs: {} };
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return empty;
  const pads = navigator.getGamepads();
  let throttle = 0, brake = 0, steer = 0, handbrake = 0, hold = false, lookBack = false;
  const downs = { camera: false, lights: false, reset: false, film: false,
                  use: false, fire: false, run: false };
  for (const p of pads) {
    if (!p) continue;
    steer += axisToSteer(p.axes[0] ?? 0);
    const rt = trigger(p.buttons[7], p.axes[5], p.axes[7]);
    const lt = trigger(p.buttons[6], p.axes[4], p.axes[6]);
    throttle = Math.max(throttle, rt);
    brake = Math.max(brake, lt);
    handbrake = Math.max(handbrake, buttonValue(p.buttons[0]));
    hold = hold || pressed(p.buttons[4]);
    lookBack = lookBack || pressed(p.buttons[11]) || pressed(p.buttons[10]); // stick clicks
    if (pressed(p.buttons[3])) downs.camera = true;   // Y
    if (pressed(p.buttons[2])) downs.lights = true;   // X
    if (pressed(p.buttons[8])) downs.reset = true;    // View / Back
    if (pressed(p.buttons[1])) downs.use = true;      // B  -- in and out of cars
    if (pressed(p.buttons[5])) downs.fire = true;     // RB -- fire
    if (pressed(p.buttons[9])) downs.run = true;      // Start -- checkpoint run
  }
  return {
    throttle, brake,
    steer: Math.max(-1, Math.min(1, steer)),
    handbrake, hold, lookBack, downs,
  };
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

export function createInput(onAction) {
  const keys = Object.create(null);
  const blocked = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  // must list every action the pad can raise, or its edge is never detected
  const prevDown = { camera: false, lights: false, reset: false, film: false,
                     use: false, fire: false, run: false, avatar: false };

  addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (isTyping) {
      if (e.code === 'Escape') onAction('chatClose');
      return;
    }

    if (e.code === 'Enter' || e.code === 'KeyY') {
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
    if (e.code === 'KeyR') onAction('reset');
    if (e.code === 'KeyV') onAction('film');
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
    if (e.code === 'KeyT') onAction('time');   // advance day-night clock by 3 hours
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
    read() {
      const kb = {
        throttle: keys.KeyW || keys.ArrowUp ? 1 : 0,
        brake: keys.KeyS || keys.ArrowDown ? 1 : 0,
        steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0),
        handbrake: keys.Space ? 1 : 0,
        hold: !!(keys.ShiftLeft || keys.ShiftRight),
        nos: !!(keys.ShiftLeft || keys.ShiftRight),
        lookBack: !!keys.KeyQ,
      };
      const pad = readPad();
      for (const name of Object.keys(prevDown)) {
        if (pad.downs[name] && !prevDown[name]) onAction(name);
        prevDown[name] = pad.downs[name];
      }
      return mergeDrive(kb, pad);
    },
  };
}
