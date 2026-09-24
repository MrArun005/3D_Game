/**
 * Touch controls -- the phone's keyboard and mouse.
 *
 * Two layers, on purpose:
 *   mapTouches(state, geometry, dt, ramp)   pure; unit-tested in test/touch.test.js
 *   createTouch(onAction, opts)             the DOM overlay that fills `state`
 *
 * `createTouch(...).read()` returns the SAME shape `createInput(...).read()`
 * does (throttle, brake, steer, handbrake, hold, nos, lookBack, analogue) plus
 * `active`, so main.js merges it with `mergeDrive(keyboardAndPad, touch)` the
 * way pad and keyboard already merge -- touch wins when a finger is down.
 *
 * Layout (landscape):
 *   DRIVING  left half     steering strip: drag left/right from the touch-down
 *                          point, +-STEER_LOCK px is full lock, springs to 0
 *                          on release (what GTA mobile does).
 *            right side    GAS and BRAKE pedals (0/1 with a software ramp),
 *                          HANDBRAKE, FIRE when a weapon is held.
 *            top row       camera, horn, lights, exit (use), phone, map, radio.
 *   ON FOOT  left          virtual stick, radius STICK_R, deadzone STICK_DEAD
 *            right half    drag = look (fed to onfoot/chase via opts.onLook)
 *            buttons       RUN (toggle), JUMP, CROUCH, USE, FIRE (hold),
 *                          AIM (toggle), RELOAD, weapon cycle, phone, map.
 *
 * Every finger is tracked by pointerId, so pressing a pedal never steals the
 * steering finger, and `touch-action: none` + passive:false keeps the browser
 * from scrolling, zooming or long-press-selecting the overlay.
 *
 * Sign conventions mirror input.js: keyboard A is steer +1, so a drag to the
 * RIGHT is steer -1; onfoot.js reads strafe = -steer, so the stick's +x maps
 * to steer -1 as well and the figure walks the way the thumb points.
 */

export const GEOMETRY = {
  steerLock: 90,    // px of drag for full lock (120 was most of a phone's half-width)
  steerDead: 6,     // px before the wheel moves
  stickR: 60,       // px, full deflection
  stickDead: 12,    // px, no movement
  rampUp: 4,        // pedal 0 -> 1 in 0.25 s
  rampDown: 9,      // pedal 1 -> 0 in 0.11 s
  lookGain: 2.2,    // touch px -> mouse px; a thumb travels less than a mouse
};

export function emptyState() {
  return {
    mode: 'drive',                              // 'drive' | 'foot'
    steer: { active: false, dx: 0 },            // drag from touch-down, px
    stick: { active: false, dx: 0, dy: 0 },     // drag from touch-down, px
    gas: false, brake: false, handbrake: false, // pedals held
    run: false,                                 // RUN toggle (hold gear when driving)
    lookBack: false,
  };
}

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/** Move `v` toward `target` at `rate` per second; ramps are what a 0/1 pedal lacks. */
export function ramp(v, target, dt, up, down) {
  const rate = target > v ? up : down;
  const step = rate * Math.max(0, dt);
  if (Math.abs(target - v) <= step) return target;
  return v + Math.sign(target - v) * step;
}

/** Drag offset in px -> steer in [-1, 1] with a deadzone; right is negative. */
export function steerFromDrag(dx, g = GEOMETRY) {
  if (!Number.isFinite(dx)) return 0;
  const a = Math.abs(dx);
  if (a <= g.steerDead) return 0;
  const s = Math.min(1, (a - g.steerDead) / (g.steerLock - g.steerDead));
  return -Math.sign(dx) * s;
}

/** Stick drag in px -> unit-disc vector {x, y, mag} with a circular deadzone. */
export function stickVector(dx, dy, g = GEOMETRY) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0, mag: 0 };
  const d = Math.hypot(dx, dy);
  if (d <= g.stickDead) return { x: 0, y: 0, mag: 0 };
  const mag = Math.min(1, (d - g.stickDead) / (g.stickR - g.stickDead));
  return { x: dx / d * mag, y: dy / d * mag, mag };
}

/**
 * The whole mapping, pure. `prev` carries the pedal ramps between frames and
 * the returned `ramp` is what the caller keeps for the next call.
 */
export function mapTouches(state, g = GEOMETRY, dt = 1 / 60, prev = { throttle: 0, brake: 0 }) {
  let throttle = 0, brake = 0, steer = 0, analogue = false;
  const rampOut = { throttle: prev.throttle, brake: prev.brake };

  if (state.mode === 'foot') {
    const v = state.stick.active ? stickVector(state.stick.dx, state.stick.dy, g) : { x: 0, y: 0, mag: 0 };
    // screen y grows downward: thumb up is forward
    throttle = Math.max(0, -v.y);
    brake = Math.max(0, v.y);
    steer = clamp1(-v.x);
    analogue = v.mag > 0;
    rampOut.throttle = 0; rampOut.brake = 0;
  } else {
    steer = state.steer.active ? steerFromDrag(state.steer.dx, g) : 0;
    rampOut.throttle = ramp(prev.throttle, state.gas ? 1 : 0, dt, g.rampUp, g.rampDown);
    rampOut.brake = ramp(prev.brake, state.brake ? 1 : 0, dt, g.rampUp, g.rampDown);
    throttle = rampOut.throttle;
    brake = rampOut.brake;
    analogue = throttle > 0.02 || brake > 0.02 || Math.abs(steer) > 0.02;
  }

  const handbrake = state.handbrake ? 1 : 0;
  const active = analogue || state.handbrake || state.run || state.lookBack
    || state.steer.active || state.stick.active || state.gas || state.brake;
  return {
    controls: {
      throttle, brake, steer, handbrake,
      hold: !!state.run,        // RUN on foot; hold gear in the car (the pad's LB does the same)
      nos: false,
      lookBack: !!state.lookBack,
      analogue,
      active: !!active,
    },
    ramp: rampOut,
  };
}

/* ------------------------------------------------------------------------ */
/* DOM overlay                                                                */
/* ------------------------------------------------------------------------ */

const BTN = (id, label, cls = '') => `<button class="tb ${cls}" data-id="${id}" type="button">${label}</button>`;

/* Layout v2 (2026-09-24, Arun on an iPhone 15: "very difficult to navigate").
   The old overlay had a 110 px steering strip floating mid-screen, nine small
   buttons in one top row and the pedals stacked in a column. Now, as on GTA /
   Asphalt mobile: the WHOLE lower-left is the wheel (touch anywhere, drag),
   the pedals sit side by side under the right thumb, the top keeps four
   buttons (EXIT/USE, CAM, MAP, MORE) and MORE opens a drawer with the rest. */
const MARKUP = `
  <div class="t-top t-top-l">
    ${BTN('map', 'MAP')}${BTN('more', '&#9776;', 'more')}
  </div>
  <div class="t-top t-top-r">
    ${BTN('camera', 'CAM', 'drive')}${BTN('use', 'EXIT', 'drive exit')}${BTN('use', 'ENTER', 'foot exit')}
  </div>
  <div class="t-drawer" hidden>
    ${BTN('phone', 'PHONE')}${BTN('horn', 'HORN', 'drive')}${BTN('lights', 'LIGHTS', 'drive')}${BTN('radio', 'RADIO', 'drive')}
    ${BTN('weaponNext', 'WEAPON', 'foot')}${BTN('reload', 'RELOAD', 'foot')}${BTN('crouch', 'CROUCH', 'foot')}
  </div>
  <div class="t-steer drive" data-zone="steer"><div class="t-steer-track"><div class="t-steer-knob"></div></div><span>DRAG TO STEER</span></div>
  <div class="t-stick foot" data-zone="stick"><div class="t-stick-base"><div class="t-stick-knob"></div></div></div>
  <div class="t-look foot" data-zone="look"></div>
  <div class="t-pads drive">
    ${BTN('handbrake', 'DRIFT', 'hand hold')}
    ${BTN('fire', 'FIRE', 'big fire hold')}
    ${BTN('brake', 'BRAKE<small>REV</small>', 'pedal brake hold')}
    ${BTN('gas', 'GAS', 'pedal gas hold')}
  </div>
  <div class="t-pads foot">
    ${BTN('aim', 'AIM', 'toggle')}
    ${BTN('run', 'RUN', 'toggle')}
    ${BTN('jump', 'JUMP', 'hold')}
    ${BTN('fire', 'FIRE', 'big fire hold')}
  </div>
`;

/**
 * @param {(action: string) => void} onAction   same action names input.js sends
 * @param {object} opts
 *   onLook(dx, dy)      look delta in mouse px (already multiplied by lookGain)
 *   onFire(down)        FIRE button held / released (auto-fire while held)
 *   onAim(on)           AIM toggle
 *   root                element to append #touch to (document.body)
 */
export function createTouch(onAction, opts = {}) {
  const state = emptyState();
  let rampState = { throttle: 0, brake: 0 };
  let lastT = typeof performance !== 'undefined' ? performance.now() : 0;
  let weaponIdx = 0;                     // WEAPON button cycles 0..6 (0 fists, 5 grenades, 6 sniper)
  const g = { ...GEOMETRY, ...(opts.geometry || {}) };

  const el = document.createElement('div');
  el.id = 'touch';
  el.className = 'mode-drive';
  el.innerHTML = MARKUP;
  (opts.root || document.body).appendChild(el);

  const steerZone = el.querySelector('[data-zone=steer]');
  const steerKnob = el.querySelector('.t-steer-knob');
  const stickZone = el.querySelector('[data-zone=stick]');
  const stickBase = el.querySelector('.t-stick-base');
  const stickKnob = el.querySelector('.t-stick-knob');
  const lookZone = el.querySelector('[data-zone=look]');

  // pointerId -> { kind: 'steer'|'stick'|'look'|'button', x0, y0, lx, ly, btn }
  const fingers = new Map();
  const prevent = (e) => { if (e.cancelable) e.preventDefault(); };

  const setPressed = (btn, on) => btn.classList.toggle('on', on);

  function buttonDown(btn) {
    const id = btn.dataset.id;
    setPressed(btn, true);
    switch (id) {
      case 'gas': state.gas = true; return;
      case 'brake': state.brake = true; return;
      case 'handbrake': state.handbrake = true; return;
      case 'jump': state.handbrake = true; return;       // onfoot.js jumps on c.handbrake
      case 'run': state.run = !state.run; setPressed(btn, state.run); return;
      case 'aim': {
        const on = !btn.classList.contains('on-toggle');
        btn.classList.toggle('on-toggle', on); setPressed(btn, on);
        opts.onAim?.(on); return;
      }
      case 'fire': opts.onFire?.(true); onAction('fire'); return;
      case 'crouch': onAction('camera'); return;          // main.js: 'camera' on foot is the crouch toggle
      case 'more': { const d = el.querySelector('.t-drawer'); d.hidden = !d.hidden; setPressed(btn, !d.hidden); return; }
      case 'weaponNext': weaponIdx = (weaponIdx + 1) % 7; onAction(`weapon${weaponIdx}`); return;
      default: onAction(id);
    }
  }
  function buttonUp(btn) {
    const id = btn.dataset.id;
    if (id === 'run' || id === 'aim' || id === 'more') return;   // toggles keep their own light
    if (btn.closest('.t-drawer')) { el.querySelector('.t-drawer').hidden = true; el.querySelector('.tb.more')?.classList.remove('on'); }   // a drawer button closes the drawer
    setPressed(btn, false);
    switch (id) {
      case 'gas': state.gas = false; break;
      case 'brake': state.brake = false; break;
      case 'handbrake': case 'jump': state.handbrake = false; break;
      case 'fire': opts.onFire?.(false); break;
    }
  }

  function zoneOf(target) {
    const btn = target.closest?.('.tb');
    if (btn) return { kind: 'button', btn };
    if (steerZone.contains(target)) return { kind: 'steer' };
    if (stickZone.contains(target)) return { kind: 'stick' };
    if (lookZone.contains(target)) return { kind: 'look' };
    return null;
  }

  function place(base, knob, x, y) {
    if (!base || !knob) return;
    knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  el.addEventListener('pointerdown', (e) => {
    const z = zoneOf(e.target);
    if (!z) return;
    prevent(e);
    if (z.kind === 'steer' && state.steer.active) return;   // one finger steers
    if (z.kind === 'stick' && state.stick.active) return;
    const f = { ...z, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY };
    fingers.set(e.pointerId, f);
    try { el.setPointerCapture(e.pointerId); } catch { /* not all browsers */ }
    if (z.kind === 'button') buttonDown(z.btn);
    else if (z.kind === 'steer') { state.steer.active = true; state.steer.dx = 0; steerZone.classList.add('on'); }
    else if (z.kind === 'stick') {
      state.stick.active = true; state.stick.dx = 0; state.stick.dy = 0;
      // the stick base jumps under the thumb: the whole zone is the stick
      const r = stickZone.getBoundingClientRect();
      stickBase.style.left = `${e.clientX - r.left}px`; stickBase.style.top = `${e.clientY - r.top}px`;
      stickZone.classList.add('on');
    }
    opts.onInput?.();
  }, { passive: false });

  el.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    prevent(e);
    if (f.kind === 'steer') {
      state.steer.dx = e.clientX - f.x0;
      place(null, steerKnob, Math.max(-g.steerLock, Math.min(g.steerLock, state.steer.dx)), 0);
    } else if (f.kind === 'stick') {
      state.stick.dx = e.clientX - f.x0; state.stick.dy = e.clientY - f.y0;
      const v = stickVector(state.stick.dx, state.stick.dy, g);
      place(stickBase, stickKnob, v.x * g.stickR, v.y * g.stickR);
    } else if (f.kind === 'look') {
      opts.onLook?.((e.clientX - f.lx) * g.lookGain, (e.clientY - f.ly) * g.lookGain);
    } else if (f.kind === 'button') {
      // sliding off a held pedal releases it; sliding onto GAS from BRAKE swaps (heel-and-toe by thumb)
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tb.hold');
      if (over && over !== f.btn) { buttonUp(f.btn); f.btn = over; buttonDown(over); }
    }
    f.lx = e.clientX; f.ly = e.clientY;
    opts.onInput?.();
  }, { passive: false });

  const release = (e) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    prevent(e);
    fingers.delete(e.pointerId);
    if (f.kind === 'steer') { state.steer.active = false; state.steer.dx = 0; place(null, steerKnob, 0, 0); steerZone.classList.remove('on'); }
    else if (f.kind === 'stick') { state.stick.active = false; state.stick.dx = 0; state.stick.dy = 0; place(stickBase, stickKnob, 0, 0); stickZone.classList.remove('on'); }
    else if (f.kind === 'button') buttonUp(f.btn);
  };
  el.addEventListener('pointerup', release, { passive: false });
  el.addEventListener('pointercancel', release, { passive: false });
  el.addEventListener('lostpointercapture', release);
  el.addEventListener('contextmenu', prevent);

  function setMode(mode) {
    if (mode === state.mode) return;
    // drop everything held: a pedal must not stay down when you step out
    for (const [id, f] of fingers) { if (f.kind === 'button') buttonUp(f.btn); fingers.delete(id); }
    state.gas = state.brake = state.handbrake = false;
    state.steer.active = false; state.steer.dx = 0;
    state.stick.active = false; state.stick.dx = state.stick.dy = 0;
    rampState = { throttle: 0, brake: 0 };
    opts.onFire?.(false);
    state.mode = mode;
    el.classList.toggle('mode-drive', mode === 'drive');
    el.classList.toggle('mode-foot', mode === 'foot');
  }

  return {
    el, state,
    setMode,
    /** show the FIRE pedal while driving only when a gun is held */
    setWeapon(has) { el.classList.toggle('armed', !!has); },
    setVisible(v) { el.hidden = !v; },
    read() {
      const now = typeof performance !== 'undefined' ? performance.now() : lastT + 16;
      const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
      lastT = now;
      const r = mapTouches(state, g, dt, rampState);
      rampState = r.ramp;
      return r.controls;
    },
  };
}
