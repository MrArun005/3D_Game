/**
 * The sound bank: every one-shot and ambience bed the game did not have.
 *
 * Halstead Bay ships ZERO audio files (see docs/AUDIO-BRIEF.md) -- every sound
 * is synthesised in WebAudio. That is the project's "everything must be free"
 * rule taken seriously, and it is also the fastest way to fill a 60-sound
 * backlog: nothing to licence, nothing to download, nothing to decode at boot.
 *
 * This file owns the ONE-SHOTS and the AMBIENCE BEDS. game/audio.js keeps the
 * continuous vehicle buses (engine, tyre, wind, spray, flap) because those are
 * driven every frame from the car, while everything here fires on an event or
 * fades with where you are standing.
 *
 * Everything is built from three primitives:
 *   burst()  filtered noise with an envelope  -- impacts, footsteps, breaks
 *   tone()   an oscillator with an envelope   -- beeps, horns, UI
 *   bed()    a filtered noise loop on a gain  -- ambience, held by district
 *
 * Two rules the existing file learned the hard way and this one keeps:
 *   - a bed starts at gain 0 and is only ever written by its setter. A bus that
 *     boots at a non-zero gain and is never written again is the hiss you can
 *     hear before the game has started (audio.js:112 records that bug).
 *   - every node an event creates is stopped, so a one-shot cannot leak. The
 *     game fires these thousands of times a session.
 */

/** A short filtered-noise event: impacts, breaks, footsteps, scrapes. */
function burst(ctx, out, noise, {
  gain = 0.3, attack = 0.002, decay = 0.18, type = 'bandpass',
  freq = 900, q = 1, sweep = 0, pan = 0,
} = {}) {
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, now);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), now + decay);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(f); f.connect(g); g.connect(p); p.connect(out);
  src.start(now);
  src.stop(now + attack + decay + 0.02);     // stopped, always: these fire in thousands
}

/** A short pitched event: beeps, clicks, horns, mechanical knocks. */
function tone(ctx, out, {
  gain = 0.2, freq = 440, to = 0, type = 'sine',
  attack = 0.004, decay = 0.2, pan = 0,
} = {}) {
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, now);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  o.connect(g); g.connect(p); p.connect(out);
  o.start(now);
  o.stop(now + attack + decay + 0.02);
}

/**
 * Build the bank.
 *
 * @param ctx    the live AudioContext
 * @param out    the master gain everything connects through
 * @param noise  the shared noise AudioBuffer (audio.js:makeNoise)
 */
export function createSfx(ctx, out, noise) {
  /* ---------------------------------------------------------- ambience beds
     One looping noise source split into filtered beds, exactly as audio.js
     does for city/rain: a single source is cheaper than fifteen, and they are
     all just different filters on the same hiss. Every bed starts SILENT. */
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const split = ctx.createGain();
  src.connect(split);

  const beds = {};
  const bed = (name, { type = 'bandpass', freq = 500, q = 0.6 } = {}) => {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;                       // silent until its setter says otherwise
    split.connect(f); f.connect(g); g.connect(out);
    beds[name] = { gain: g, filter: f };
    return beds[name];
  };

  bed('surf',      { type: 'lowpass',  freq: 620 });     // beach: broad, slow
  bed('river',     { type: 'bandpass', freq: 380, q: 0.5 });
  bed('harbour',   { type: 'lowpass',  freq: 300 });     // hull groan, water slap
  bed('industry',  { type: 'bandpass', freq: 220, q: 0.8 });
  bed('park',      { type: 'highpass', freq: 3200 });    // leaves, not birds
  bed('crowd',     { type: 'bandpass', freq: 700, q: 0.4 });
  bed('deckWind',  { type: 'lowpass',  freq: 240 });     // exposed bridge deck
  bed('tunnel',    { type: 'lowpass',  freq: 180 });     // under a bridge
  src.start();

  /* Surf and wind BREATHE. A flat noise bed reads as tape hiss; the sea has a
     period. Two slow LFOs, one per bed, so they do not pulse in lockstep. */
  const swell = (target, rate, depth) => {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = depth;
    lfo.connect(amp); amp.connect(target.gain.gain);
    lfo.start();
  };
  swell(beds.surf, 0.11, 0.012);        // ~9 s period: a real swell
  swell(beds.deckWind, 0.07, 0.008);

  /* Gulls and birds are EVENTS on a timer, not a bed -- a looped gull is a
     parrot. Scheduled by the caller's district setter below. */
  let birdTimer = 0;

  /* Per-surface footstep recipes. Declared before `sfx` so step()'s fallback
     cannot land in the temporal dead zone if it is ever called during init. */
  const STEP = {
    pavement: { freq: 1500, q: 2,   decay: 0.07, g: 0.055, type: 'bandpass' },
    sand:     { freq: 2600, q: 0.6, decay: 0.12, g: 0.045, type: 'highpass' },
    grass:    { freq: 2000, q: 0.8, decay: 0.09, g: 0.038, type: 'highpass' },
    metal:    { freq: 900,  q: 6,   decay: 0.22, g: 0.05,  type: 'bandpass' },
    gravel:   { freq: 1800, q: 1.2, decay: 0.11, g: 0.06,  type: 'bandpass' },
    water:    { freq: 3000, q: 0.5, decay: 0.16, g: 0.05,  type: 'highpass' },
  };

  const sfx = {
    /* ------------------------------------------------------------ vehicle */
    skid(force = 1, pan = 0) {            // locked wheels, not cornering slip
      burst(ctx, out, noise, { gain: 0.16 * force, freq: 1500, q: 1.6, sweep: -700, decay: 0.5, pan });
    },
    brakeSqueal(force = 1, pan = 0) {     // the low-speed metallic one
      tone(ctx, out, { gain: 0.045 * force, freq: 2900, to: 2500, type: 'sawtooth', decay: 0.45, pan });
    },
    handbrake() {
      burst(ctx, out, noise, { gain: 0.1, freq: 1100, q: 2, decay: 0.22 });
      tone(ctx, out, { gain: 0.05, freq: 180, to: 90, type: 'square', decay: 0.1 });
    },
    suspension(mag = 1) {                 // a bump; bottomOut is its hard cousin
      burst(ctx, out, noise, { gain: 0.09 * mag, type: 'lowpass', freq: 220, decay: 0.12 });
    },
    bottomOut() {
      burst(ctx, out, noise, { gain: 0.24, type: 'lowpass', freq: 130, decay: 0.2 });
      tone(ctx, out, { gain: 0.12, freq: 70, to: 40, type: 'square', decay: 0.16 });
    },
    starter() {                           // ignition: crank, then catch
      tone(ctx, out, { gain: 0.09, freq: 42, to: 58, type: 'sawtooth', decay: 0.7 });
      burst(ctx, out, noise, { gain: 0.06, type: 'bandpass', freq: 320, q: 3, decay: 0.75 });
    },
    blowOff() {                           // turbo dump on a lift
      burst(ctx, out, noise, { gain: 0.12, type: 'highpass', freq: 2600, decay: 0.26, sweep: -1400 });
    },
    backfire(pan = 0) {                   // overrun pop
      burst(ctx, out, noise, { gain: 0.3, type: 'lowpass', freq: 900, decay: 0.09, pan });
      tone(ctx, out, { gain: 0.12, freq: 120, to: 55, type: 'square', decay: 0.07, pan });
    },
    engineKnock(damage = 1) {             // a hurt engine, once per revolution-ish
      tone(ctx, out, { gain: 0.05 * damage, freq: 95, to: 70, type: 'square', decay: 0.07 });
    },
    radiator() {                          // steam from a dead radiator
      burst(ctx, out, noise, { gain: 0.08, type: 'highpass', freq: 3400, decay: 1.6 });
    },
    dragMetal(mag = 1) {                  // something torn off, scraping along
      burst(ctx, out, noise, { gain: 0.1 * mag, type: 'bandpass', freq: 2200, q: 4, decay: 0.4 });
    },

    /* ---------------------------------------------------------- collision
       BANDS, not one scaled thud. A glancing scrape and a head-on are not the
       same event played louder: the scrape is long and bright, the heavy hit is
       short and low with a body behind it. audio.js's `thud` stays for the
       middle of the range; these are its ends. */
    scrape(force = 1, pan = 0) {
      burst(ctx, out, noise, { gain: 0.1 * force, type: 'bandpass', freq: 2600, q: 5, decay: 0.35, sweep: -900, pan });
    },
    crunch(force = 1, pan = 0) {
      const heavy = force > 0.6;
      burst(ctx, out, noise, {
        gain: 0.2 + 0.28 * force,
        type: 'lowpass',
        freq: heavy ? 420 : 900,
        decay: heavy ? 0.34 : 0.18,
        pan,
      });
      tone(ctx, out, { gain: 0.1 * force, freq: heavy ? 58 : 110, to: 34, type: 'square', decay: 0.2, pan });
    },
    glass(pan = 0) {
      burst(ctx, out, noise, { gain: 0.22, type: 'highpass', freq: 4200, decay: 0.42, pan });
      for (let i = 0; i < 4; i++) {       // tinkle: a few bright shards after
        setTimeout(() => tone(ctx, out, {
          gain: 0.05, freq: 3200 + Math.random() * 2600, type: 'triangle', decay: 0.1, pan,
        }), 40 + i * 55);
      }
    },
    propBreak(heavy = false, pan = 0) {
      burst(ctx, out, noise, {
        gain: heavy ? 0.26 : 0.13,
        type: 'lowpass', freq: heavy ? 500 : 1400,
        decay: heavy ? 0.3 : 0.14, pan,
      });
    },

    /* ------------------------------------------------------- on foot / NPC
       Footsteps are per SURFACE. The same click on sand, grass and a steel deck
       is the tell that a game has one footstep sound. */
    step(surface = 'pavement', pan = 0, gain = 1) {
      const S = STEP[surface] ?? STEP.pavement;
      burst(ctx, out, noise, {
        gain: S.g * gain, type: S.type, freq: S.freq, q: S.q, decay: S.decay, pan,
      });
    },
    jump() { burst(ctx, out, noise, { gain: 0.05, type: 'lowpass', freq: 600, decay: 0.09 }); },
    land(mag = 1) { burst(ctx, out, noise, { gain: 0.09 * mag, type: 'lowpass', freq: 300, decay: 0.15 }); },

    /** An oncoming car: pitch falls as it passes. Doppler, cheaply. */
    passBy(speed = 20, pan = 0) {
      const f = 180 + speed * 6;
      tone(ctx, out, { gain: 0.07, freq: f, to: f * 0.62, type: 'sawtooth', decay: 0.55, pan });
      burst(ctx, out, noise, { gain: 0.05, type: 'bandpass', freq: 900, q: 0.8, decay: 0.5, pan });
    },

    /* ------------------------------------------------------------ weapons */
    casing(pan = 0) {                     // brass on tarmac, a beat after the shot
      setTimeout(() => {
        tone(ctx, out, { gain: 0.035, freq: 4200 + Math.random() * 1200, type: 'triangle', decay: 0.12, pan });
        tone(ctx, out, { gain: 0.02, freq: 2600, type: 'triangle', decay: 0.09, pan });
      }, 170 + Math.random() * 90);
    },
    dryFire() { tone(ctx, out, { gain: 0.07, freq: 2200, to: 1400, type: 'square', decay: 0.04 }); },
    weaponSwitch() { tone(ctx, out, { gain: 0.05, freq: 900, to: 1300, type: 'square', decay: 0.07 }); },
    pin() { tone(ctx, out, { gain: 0.06, freq: 3100, type: 'triangle', decay: 0.09 }); },
    throwArc() { burst(ctx, out, noise, { gain: 0.04, type: 'bandpass', freq: 1200, q: 2, decay: 0.2 }); },
    explosion(pan = 0) {
      burst(ctx, out, noise, { gain: 0.55, type: 'lowpass', freq: 260, decay: 1.1, sweep: -180, pan });
      tone(ctx, out, { gain: 0.3, freq: 62, to: 26, type: 'square', decay: 0.9, pan });
    },

    /* --------------------------------------------------------- race and UI */
    checkpoint() { tone(ctx, out, { gain: 0.12, freq: 1320, to: 1760, type: 'sine', decay: 0.2 }); },
    countdown(n = 3) {                    // 3-2-1 low, GO high: the pitch IS the cue
      tone(ctx, out, { gain: 0.16, freq: n > 0 ? 660 : 1320, type: 'square', decay: n > 0 ? 0.18 : 0.5 });
    },
    raceStart() {
      tone(ctx, out, { gain: 0.2, freq: 1320, type: 'square', decay: 0.55 });
      tone(ctx, out, { gain: 0.1, freq: 1980, type: 'sine', decay: 0.5 });
    },
    finish() {
      [880, 1108, 1320, 1760].forEach((f, i) => setTimeout(
        () => tone(ctx, out, { gain: 0.13, freq: f, type: 'triangle', decay: 0.34 }), i * 110,
      ));
    },
    missionAccept() { tone(ctx, out, { gain: 0.11, freq: 520, to: 780, type: 'sine', decay: 0.26 }); },
    missionFail() { tone(ctx, out, { gain: 0.13, freq: 420, to: 180, type: 'sawtooth', decay: 0.6 }); },
    mapOpen() { tone(ctx, out, { gain: 0.07, freq: 700, to: 1100, type: 'sine', decay: 0.13 }); },
    mapClose() { tone(ctx, out, { gain: 0.07, freq: 1100, to: 700, type: 'sine', decay: 0.13 }); },
    hover() { tone(ctx, out, { gain: 0.03, freq: 1500, type: 'sine', decay: 0.05 }); },

    /* ------------------------------------------------------- world one-offs */
    gull(pan = 0) {
      tone(ctx, out, { gain: 0.06, freq: 1500, to: 2400, type: 'sawtooth', attack: 0.03, decay: 0.3, pan });
    },
    bird(pan = 0) {
      tone(ctx, out, { gain: 0.035, freq: 3200, to: 4400, type: 'sine', attack: 0.01, decay: 0.12, pan });
    },
    shipHorn(pan = 0) {
      tone(ctx, out, { gain: 0.16, freq: 96, type: 'sawtooth', attack: 0.15, decay: 1.9, pan });
      tone(ctx, out, { gain: 0.1, freq: 144, type: 'sine', attack: 0.15, decay: 1.9, pan });
    },
    crane() { burst(ctx, out, noise, { gain: 0.05, type: 'bandpass', freq: 160, q: 5, decay: 1.2 }); },
    railPass() { burst(ctx, out, noise, { gain: 0.09, type: 'bandpass', freq: 260, q: 1.4, decay: 2.2 }); },

    /**
     * Where you are, as a mix. Called from the district poll -- the beds are
     * cross-faded, never switched, or the bed pops as you cross a boundary.
     *
     * @param name     district name from District.districtAt
     * @param onBeach  within the beach/promenade ring
     * @param onWater  near the river
     * @param elevated on a bridge deck
     * @param dt       seconds, for the timed bird/gull events
     */
    place(name, { onBeach = false, onWater = false, elevated = false, crowd = 0, dt = 0 } = {}) {
      const now = ctx.currentTime;
      const to = (b, v) => beds[b].gain.gain.setTargetAtTime(v, now, 0.8);
      to('surf', onBeach ? 0.05 : 0);
      to('river', onWater && !onBeach ? 0.03 : 0);
      to('harbour', name === 'HARBOUR POINT' ? 0.035 : 0);
      to('industry', (name === 'STEELGATE' || name === 'NORTHLINE') ? 0.03 : 0);
      to('park', name === 'GREENFELL PARK' ? 0.022 : 0);
      to('deckWind', elevated ? 0.03 : 0);
      to('crowd', Math.min(0.04, crowd * 0.04));

      // gulls at the coast, birds in the park: events, on a slow random timer
      birdTimer -= dt;
      if (birdTimer <= 0) {
        birdTimer = 2.5 + Math.random() * 6;
        const pan = Math.random() * 2 - 1;
        if (onBeach || name === 'HARBOUR POINT') sfx.gull(pan);
        else if (name === 'GREENFELL PARK') sfx.bird(pan);
      }
    },

    /** Under a bridge: a short lowpassed bed that makes the world close in. */
    tunnel(inside) {
      beds.tunnel.gain.gain.setTargetAtTime(inside ? 0.05 : 0, ctx.currentTime, 0.35);
    },
  };

  return sfx;
}
