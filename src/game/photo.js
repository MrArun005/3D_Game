import * as THREE from 'three';

/**
 * Photo mode: the acceptance camera for the "Light the City" plan.
 *
 * Every phase of that plan commits with a frame AND a stats line taken from a
 * named preset, so before-and-after shots are the same pixels. P toggles the
 * mode; while it is on the chase camera is frozen and this owns the camera:
 * WASD moves, Q/Z down/up, Shift is fast, the mouse looks (pointer lock),
 * the wheel zooms, [ and ] step through PRESETS, Enter takes a shot -- prints
 * the stats line on screen and to the console. The harness does the same
 * without a keyboard: window.photo.goto('kingsway-corner') then
 * window.photo.line().
 *
 * Presets are world metres, Y up. 'kingsway-corner' IS the spawn driver
 * camera every budget figure in the plan was measured from.
 */
export const PRESETS = {
  'kingsway-corner': { pos: [2350, 3, 1348],    look: [2430, 1.5, 1348] },
  'little-tokyo':    { pos: [2330, 2.4, 1357],  look: [2430, 5, 1357] },     // on the spawn road inside the district, looking down the kanban (2300,1412 was inside a building)
  'kingsway-down':   { pos: [2352, 1.7, 1345],  look: [2552, 12, 1345] },
  // the Kingsway tower at (2425, 1404); the noon sun sits at (-190, 250, 120)
  // so its shadow falls towards +X/-Z, across this camera's foreground
  'tower-shadow':    { pos: [2482, 4, 1298],    look: [2440, 24, 1384] },
  'bridge-west':     { pos: [1480, 10, 1010],   look: [1640, 8, 1200] },
  'harbour':         { pos: [2100, 14, 2300],   look: [1950, 8, 2500] },
  'aerial':          { pos: [2200, 160, 1150],  look: [2420, 0, 1400] },

  /* One per district, docs/VISUAL-BRIEF.md. Every position is a point ON a
     road centreline inside that district's own boundary (picked out of
     public/halstead-bay.district.json in node, then checked: each is <0.5 m
     from the centreline, inside exactly one district polygon, and clear of
     every bridge approach), looking 100-270 m down a straight run with the
     look point at y 7 so the roofline is in frame. `hour` is the light the
     brief asks that district to be judged in -- goto() sets the clock when
     one is wired (main.js: photo.useClock(clock)). The brief's own test light
     is overcast noon, which is why the hero block sits at 12.0. */
  'ashmoor':         { pos: [766, 2.4, 539],   look: [868, 7, 529],   hour: 16.5 },  // NORTHGATE; cream render + red tile want a low warm sun
  'greenfell-park':  { pos: [1150, 2.4, 876],  look: [1420, 7, 887],  hour: 9.0 },   // street along the south park block: long morning shadows over grass
  'northline':       { pos: [3414, 2.4, 546],  look: [3525, 7, 552],  hour: 6.8 },   // NORTHGATE at the rail land; soot brick and ballast read at dawn
  'marrow-hill':     { pos: [543, 2.4, 1647],  look: [666, 7, 1609],  hour: 18.4 },  // MARROW ROAD; dusk on brick terraces and slate
  'old-quarter':     { pos: [1161, 2.4, 1430], look: [1251, 7, 1378], hour: 12.0 },  // THE HERO BLOCK, in the brief's own test light
  'kingsway-ave':    { pos: [2200, 2.4, 1340], look: [2209, 7, 1456], hour: 17.8 },  // HALSTEAD AVENUE north; late sun rakes the tower setbacks
  'the-flats':       { pos: [584, 2.4, 2591],  look: [686, 7, 2506],  hour: 11.0 },  // BROADWAY; sun-bleached signage wants flat bright midday
  'vellery-row':     { pos: [1428, 2.4, 2378], look: [1553, 7, 2384], hour: 22.5 },  // DOCK ROAD through the nightlife blocks: the district IS its signs
  'harbour-point':   { pos: [2371, 2.4, 2463], look: [2498, 7, 2480], hour: 21.4 },  // DOCK ROAD east; floodlights and puddles
  'steelgate':       { pos: [3705, 2.4, 1219], look: [3792, 7, 1214], hour: 20.8 },  // STEEL MILE; sodium on rust
};

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Photo {
  constructor(camera, stats, grade = null) {
    this.camera = camera;
    this.stats = stats;
    this.grade = grade;
    this.on = false;
    this.preset = null;
    this.yaw = 0; this.pitch = 0;
    this.fov = camera.fov;
    this.keys = {};
    this.el = null;
    this.timer = 0;
    addEventListener('keydown', (e) => {
      if (!this.on) return;
      this.keys[e.code] = true;
      if (e.code === 'BracketRight') this.cycle(1);
      if (e.code === 'BracketLeft') this.cycle(-1);
      if (e.code === 'KeyG' && this.grade) {
        const next = this.grade.cyclePreset(1);
        const name = this.grade.presetDetails?.name || next;
        this.#say(`grade filter: ${name}`);
      }
      if (e.code === 'Enter') this.shot();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('wheel', (e) => {
      if (!this.on) return;
      this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + e.deltaY * 0.02, 12, 90);
      this.camera.updateProjectionMatrix();
    }, { passive: true });
  }

  /** The game clock, so a district preset can bring its own light with it. */
  useClock(clock) { this.clock = clock; }

  toggle() { this.on ? this.exit() : this.enter(); }

  enter() {
    this.on = true;
    this.#fromCamera();
    document.body.classList.add('photo');
    this.#say('photo mode  ·  WASD QZ move  ·  [ ] presets  ·  G grade filter  ·  Enter shot  ·  P exit');
  }

  exit() {
    this.on = false;
    this.preset = null;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('photo');
    this.#say('');
  }

  /** Read yaw/pitch back out of wherever the camera is, so free look continues from there. */
  #fromCamera() {
    this.camera.getWorldDirection(_fwd);
    this.yaw = Math.atan2(_fwd.x, _fwd.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
  }

  goto(name) {
    const p = PRESETS[name];
    if (!p) return false;
    if (!this.on) this.enter();
    this.preset = name;
    /* The presets that carry a mood carry its light. A preset with NO hour
       puts the clock back where it was before any preset touched it -- without
       that, `[`/`]` off vellery-row (22.5) left kingsway-corner at night and
       every budget figure measured from it was a night figure. Order-
       independent now. Override either with window.__time(h) (main.js). */
    if (this.clock) {
      this.baseHour ??= this.clock.hour;
      this.clock.hour = p.hour ?? this.baseHour;
    }
    this.camera.position.set(...p.pos);
    this.camera.lookAt(...p.look);
    this.camera.updateMatrixWorld();
    this.#fromCamera();
    this.#say(name);
    return true;
  }

  cycle(step) {
    const names = Object.keys(PRESETS);
    const i = names.indexOf(this.preset);
    this.goto(names[(i + step + names.length) % names.length]);
  }

  /** Mouse delta in pixels, from the pointer-lock handler in main.js. */
  look(dx, dy) {
    if (!this.on || (!dx && !dy)) return;   // a click's zero-delta mousemove must not clear the preset
    this.yaw -= dx * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0025, -1.5, 1.5);
    this.preset = null;
  }

  update(dt) {
    const k = this.keys, c = this.camera;
    _fwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    _right.crossVectors(_fwd, _up).normalize();
    const speed = (k.ShiftLeft || k.ShiftRight ? 60 : 14) * dt;
    let moved = false;
    if (k.KeyW) { c.position.addScaledVector(_fwd, speed); moved = true; }
    if (k.KeyS) { c.position.addScaledVector(_fwd, -speed); moved = true; }
    if (k.KeyD) { c.position.addScaledVector(_right, speed); moved = true; }
    if (k.KeyA) { c.position.addScaledVector(_right, -speed); moved = true; }
    if (k.KeyQ) { c.position.y -= speed; moved = true; }
    if (k.KeyZ) { c.position.y += speed; moved = true; }
    if (moved) this.preset = null;
    c.lookAt(c.position.x + _fwd.x, c.position.y + _fwd.y, c.position.z + _fwd.z);
    c.updateMatrixWorld();
  }

  /** The stats line: one string a human can paste into a commit message. */
  line() {
    const s = this.stats;
    const raw = [...s.samples];
    const arr = raw.map((x) => (typeof x === 'number' ? x : x.ms)).sort((a, b) => a - b);
    const med = arr[arr.length >> 1] || 0;
    const p95 = arr[Math.max(0, Math.floor(arr.length * 0.95) - 1)] || 0;
    const low = arr[Math.max(0, Math.floor(arr.length * 0.99) - 1)] || 0;
    const worst = arr[arr.length - 1] || 0;
    const worstCause = s.worstCause ? ` (${s.worstCause})` : '';
    const p = this.camera.position;
    const chunk = s.chunkTotals.length
      ? `chunk ${Math.max(...s.chunkTotals).toFixed(1)}ms worst total, ${s.worstChunkMs.toFixed(1)}ms worst slice (last ${s.chunkTotals.length})`
      : 'chunk: none built since load';
    const draws = s.snapshot.draws + (s.snapshot.bundledDraws || 0), tris = s.snapshot.tris + (s.snapshot.bundledTris || 0);
    return `${this.preset || 'free'} @ ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)}`
      + ` · ${draws} draws (${s.snapshot.bundledDraws || 0} bundled) · ${(tris / 1e6).toFixed(2)}M tris`
      + ` · frame ${med.toFixed(1)}ms med, ${p95.toFixed(1)}ms 95%, ${low.toFixed(1)}ms 1% low, ${worst.toFixed(1)}ms worst${worstCause} · ${chunk}`;
  }

  shot() {
    const line = this.line();
    this.#say(line, 6000);
    console.log('[photo] ' + line);
    return { preset: this.preset, line, ...this.stats.snapshot,
             chunkTotals: [...this.stats.chunkTotals], worstSliceMs: this.stats.worstChunkMs };
  }

  #say(text, ms = 3000) {
    if (!this.el) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;'
        + 'font:12px/1.4 ui-monospace,Menlo,monospace;color:#e8eef7;background:rgba(8,11,16,.78);'
        + 'padding:6px 12px;border-radius:6px;pointer-events:none;white-space:nowrap;display:none';
      document.body.appendChild(el);
      this.el = el;
    }
    clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.style.display = text ? 'block' : 'none';
    if (text) this.timer = setTimeout(() => { this.el.style.display = 'none'; }, ms);
  }
}
