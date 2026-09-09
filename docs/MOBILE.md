# Mobile / touch build — 2026-09-09

Built without a phone or a browser in the session (Arun's no-Playwright rule),
so every layout claim below is unverified until someone holds it. The maths
is tested in node; the DOM is not.

## What it is

- **Detection**: `src/core/device.js`. `isTouchDevice()` = any touch point or a
  coarse primary pointer; `isMobile()` = touch AND the shorter screen side
  under 900 CSS px, or a phone user agent. `?mobile` / `?desktop` override.
  `main.js` adds `body.touch` and forces the lite tier on mobile.
- **Tier (mobile = lite)**: GTAO off, crowd 160, 4 pooled lights, 8 near
  pedestrians, pixel ratio 1.0 (already the desktop value). Bloom, SMAA and
  the CSM sun stay. Nothing about a phone GPU has been measured: this is the
  first knob. If it is still slow, the next knobs in order are `?nobloom`,
  the chunk ring radius, and the parked-car LOD distance.
- **Controls**: `src/game/touch.js`. Pure `mapTouches(state, geometry, dt,
  ramp)` (tested: `test/touch.test.js`) plus a Pointer Events overlay
  `#touch` that fills the state. `read()` returns the same shape as
  `createInput().read()`; `main.js` merges it with `mergeDrive()` after the
  keyboard/pad read, so a finger down wins the way a live pad does.
- **Look**: dragging the right half of the screen on foot feeds the same
  `onFoot.look()` / `chase.look()` / `photo.look()` the pointer-lock mouse
  does, times `GEOMETRY.lookGain` (2.2). Pointer lock is never requested on
  a touch device.
- **Start**: TAP TO START; the title card dismisses on `pointerdown`, which
  also resumes the AudioContext. The `<kbd>` list is replaced by a
  three-line touch legend.
- **Layout**: viewport `user-scalable=no`, `touch-action: none`, safe-area
  insets on the overlay and the instruments, minimap scaled to 0.62, the
  tachometer dial hidden (speed and gear stay as text), a ROTATE YOUR PHONE
  card in portrait. `resize`, `orientationchange` (60 ms late, iOS reports the
  old size on the event) and `visualViewport.resize` all resize the renderer.

## Layout (landscape)

```
 [CAM] [HORN] [LIGHTS] [EXIT] [PHONE] [MAP] [RADIO]          <- top row, driving
 [USE] [PHONE] [MAP] [WEAPON] [RELOAD]                        <- top row, on foot

 +---------------------------+          drive:  [HANDBRAKE]
 |   ---------o---------     |                  [BRAKE / REVERSE]  [FIRE] (armed)
 |         STEER             |                  [    GAS    ]
 +---------------------------+
 [minimap]  120 KM/H GEAR 3        foot:   (stick, jumps under thumb)   drag right half = look
                                          [RUN] [CROUCH] [JUMP] [AIM] [FIRE]
```

Sign conventions follow `input.js`: keyboard A is steer +1, so a drag to the
right is steer −1; on foot `onfoot.js` reads strafe = −steer, so the stick's
+x is also steer −1 and the figure walks where the thumb points.

Buttons reuse existing action names: `camera` (crouch on foot), `horn`,
`lights`, `use`, `phone`, `map`, `radio`, `reload`, `fire`, `weaponN`
(WEAPON cycles 0..6). JUMP holds `handbrake` (that is what `onfoot.js` jumps
on). FIRE sets `firing` while held; AIM toggles `aiming`.

## Known limits

- WebGPU: iOS Safari 26+ and Android Chrome. three falls back to WebGL2
  where it is absent; the post stack is the same TSL graph on both.
- No haptics, no gyro steering, no gamepad-on-phone testing.
- Performance on a phone is unmeasured. The 60 fps floor is a desktop rule;
  expect 30 on a mid-range phone until the tier is tuned against a device.
- The big map and the phone open on tap but close only via their own close
  affordance or the same button; no tap-outside yet.
- Multi-touch chording beyond two fingers (steer + gas + horn) depends on the
  device's touch point count.

## Phone play-test checklist

1. Load on a phone in landscape: title card shows the touch legend and TAP
   TO START; a tap starts the game with sound.
2. In portrait: ROTATE YOUR PHONE covers the screen; rotating back removes it
   and the canvas fills the viewport (no letterbox, no scrolled URL bar).
3. Drive: drag the steering strip; the knob follows the finger and springs
   back on release. GAS ramps up over a quarter second; BRAKE stops, then
   reverses. Pressing GAS never drops the steering finger.
4. HANDBRAKE slides the tail. CAM cycles the chase camera. HORN, LIGHTS work.
   RADIO cycles stations. PHONE and MAP open their panels.
5. EXIT gets out of the car; the overlay switches to the on-foot layout. The
   stick base jumps under the thumb; dragging the right half turns the view.
   RUN toggles, JUMP jumps, CROUCH crouches, USE gets back in.
6. WEAPON cycles fists → pistol → … → sniper; FIRE fires while held (auto),
   AIM toggles the ADS zoom.
7. Nothing in the HUD is hidden behind the overlay: minimap bottom-left at
   0.62 scale, speed/gear text beside it, stars and health above.
8. F3 (no key on a phone: add `?debug` and use the on-screen stats) frame
   time: if it is not holding 30, try `?nobloom` and report both numbers.
