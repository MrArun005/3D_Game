/**
 * Sampled engine: RPM-banded loops (on-load / off-load) plus a limiter layer
 * and a turbo bed. Tyre / wind / rain stay procedural noise.
 */
import {
  ENGINE_BANDS, engineLayerGains, renderEngineLoop, renderLimiterLoop, toAudioBuffer,
} from './engine-samples.js';
import { rumble } from './input.js';

function makeNoise(ctx, seconds = 1.5) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function startLoop(ctx, buffer, dest, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(gain);
  gain.connect(dest);
  src.start();
  return { src, gain };
}

export function createAudio() {
  let sirenNode = null, alarmNode = null, tokyoNode = null;
  let ctx = null;
  let master, engineBus;
  let layers = [];
  let limiter, turboGain, turboFilter;
  let tyreGain, tyreFilter, windGain, rainGain;
  let ready = false;
  let lastGear = 2;
  let lastImpact = 0;

  function boot() {
    if (ready) return ctx.state === 'running';
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.24;
    master.connect(ctx.destination);

    engineBus = ctx.createGain();
    engineBus.gain.value = 0.72;
    const engineLp = ctx.createBiquadFilter();
    engineLp.type = 'lowpass';
    engineLp.frequency.value = 4200;
    engineLp.Q.value = 0.7;
    engineBus.connect(engineLp);
    engineLp.connect(master);

    const sr = ctx.sampleRate;
    layers = ENGINE_BANDS.map((rpm) => ({
      rpm,
      off: startLoop(ctx, toAudioBuffer(ctx, renderEngineLoop(sr, rpm, 0)), engineBus),
      on: startLoop(ctx, toAudioBuffer(ctx, renderEngineLoop(sr, rpm, 1)), engineBus),
    }));
    limiter = startLoop(ctx, toAudioBuffer(ctx, renderLimiterLoop(sr)), engineBus);

    turboFilter = ctx.createBiquadFilter();
    turboFilter.type = 'bandpass';
    turboFilter.frequency.value = 2800;
    turboFilter.Q.value = 2.4;
    turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    const turboSrc = ctx.createBufferSource();
    turboSrc.buffer = makeNoise(ctx, 1.2);
    turboSrc.loop = true;
    turboSrc.connect(turboFilter);
    turboFilter.connect(turboGain);
    turboGain.connect(master);
    turboSrc.start();

    const split = ctx.createGain();
    split.gain.value = 1;
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoise(ctx);
    noise.loop = true;
    noise.connect(split);

    tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 900;
    tyreFilter.Q.value = 0.7;
    tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    split.connect(tyreFilter);
    tyreFilter.connect(tyreGain);
    tyreGain.connect(master);

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 380;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    split.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);

    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1800;
    rainGain = ctx.createGain();
    /* Starts silent. This bus used to boot at 0.028 and was never written to
       again -- a filtered noise loop running from page load to page close,
       which is the hiss you could hear before the engine even started. */
    rainGain.gain.value = 0;
    split.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);

    // City ambience bed (Task 6.1): low rumble of distant traffic & urban air
    const cityFilter = ctx.createBiquadFilter();
    cityFilter.type = 'lowpass';
    cityFilter.frequency.value = 180;
    const cityGain = ctx.createGain();
    cityGain.gain.value = 0.024;
    split.connect(cityFilter);
    cityFilter.connect(cityGain);
    cityGain.connect(master);

    noise.start();
    ready = true;
    return ctx.state === 'running';
  }

  /**
   * A car hitting something.
   *
   * The old one was a 48Hz sine with a 220Hz noise puff -- a soft boom, which
   * is what a drum sounds like, not what sheet metal sounds like. A crash is a
   * bright broadband crunch with a very fast attack, a low thump under it, and
   * almost no tail.
   */
  function thud(mag) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.min(0.5, 0.06 + mag * 0.03);
    const hard = Math.min(1, mag / 9);          // how metallic it gets

    // the crunch: broadband, bright, gone in 90ms
    const crack = ctx.createBufferSource();
    crack.buffer = makeNoise(ctx, 0.18);
    const cf = ctx.createBiquadFilter();
    cf.type = 'highpass';
    cf.frequency.value = 900 + hard * 1800;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(v * (0.55 + hard * 0.5), t);
    cg.gain.exponentialRampToValueAtTime(0.0008, t + 0.075 + hard * 0.05);
    crack.connect(cf); cf.connect(cg); cg.connect(master);
    crack.start(t); crack.stop(t + 0.2);

    // the body panel: a mid band that rings very briefly
    const mid = ctx.createBufferSource();
    mid.buffer = makeNoise(ctx, 0.2);
    const mf = ctx.createBiquadFilter();
    mf.type = 'bandpass';
    mf.frequency.value = 320 + hard * 260;
    mf.Q.value = 1.6;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(v * 0.8, t);
    mg.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    mid.connect(mf); mf.connect(mg); mg.connect(master);
    mid.start(t); mid.stop(t + 0.2);

    // the thump you feel, pitched down as it decays
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120 + Math.random() * 30, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.15);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.17);

    rumble(Math.min(1, mag * 0.08), 90);
  }

  /** A shot. Short, loud, and unmistakably not a crash. */
  /**
   * gain 0..1 is distance: your own gun is 1, an officer 60 m away ~0.15. Far
   * shots also lose their crack -- the highpass drops and a lowpass comes in --
   * which is how a street tells you where the shooting is without a map.
   */
  /* Per-weapon voice: body pitch start/end, body length, noise length. A
     shotgun is a low, long boom; an SMG a short snap; a rifle a hard crack. */
  const VOICE = {
    pistol:  { f0: 180, f1: 60, body: 0.08, noise: 0.16 },
    smg:     { f0: 210, f1: 80, body: 0.05, noise: 0.10 },
    rifle:   { f0: 240, f1: 70, body: 0.10, noise: 0.18 },
    shotgun: { f0: 120, f1: 40, body: 0.16, noise: 0.26 },
  };
  function gunshot(gain = 1, kind = 'pistol') {
    if (!ctx) return;
    const v = VOICE[kind] ?? VOICE.pistol;
    const k = Math.max(0.05, Math.min(1, gain));
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = makeNoise(ctx, v.noise);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 600 + 800 * k;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200 + 14000 * k;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.30 * k, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
    n.start(t); n.stop(t + v.noise + 0.02);
    const body = ctx.createOscillator();
    body.type = 'square';
    body.frequency.setValueAtTime(v.f0, t);
    body.frequency.exponentialRampToValueAtTime(v.f1, t + v.body * 0.75);
    const bg2 = ctx.createGain();
    bg2.gain.setValueAtTime(0.16 * (0.5 + 0.5 * k), t);   // the low body carries further than the crack
    bg2.gain.exponentialRampToValueAtTime(0.0008, t + v.body);
    body.connect(bg2); bg2.connect(master);
    body.start(t); body.stop(t + 0.1);
  }

  function shiftClick() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.07);
  }

  return {
    resume() {
      boot();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    /* A car horn: two detuned tones through a fast envelope. `pan` is -1..1
       across the stereo field, `far` 0..1 fades it with distance. Traffic
       sounds it at near misses (main.js); the city stops being silent. */
    context() { return ready && ctx && ctx.state === 'running' ? ctx : null; },
    bus() { return master; },
    horn(pan = 0, far = 0) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime, g = ctx.createGain(), p = ctx.createStereoPanner();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.28 * (1 - far * 0.7), now + 0.03);
      g.gain.setValueAtTime(0.28 * (1 - far * 0.7), now + 0.28);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      p.pan.value = Math.max(-1, Math.min(1, pan));
      for (const f of [415, 522]) {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        o.connect(lp); lp.connect(g); o.start(now); o.stop(now + 0.45);
      }
      g.connect(p); p.connect(master);
    },
    /* A round going past your head: a short band of noise sweeping down, panned
       to the side it passed on. The miss you hear is what makes the hit you
       take feel earned. */
    whiz(pan = 0) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime, n = ctx.createBufferSource();
      n.buffer = makeNoise(ctx, 0.14);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(3200, now); bp.frequency.exponentialRampToValueAtTime(500, now + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.22, now); g.gain.exponentialRampToValueAtTime(0.0008, now + 0.13);
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      n.connect(bp); bp.connect(g); g.connect(p); p.connect(master);
      n.start(now); n.stop(now + 0.15);
    },
    /* A parked car's alarm: a two-tone chirp cycle for `seconds`, panned and
       faded by distance. One at a time -- a second call restarts it. */
    alarm(pan = 0, far = 0, seconds = 5) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (alarmNode) { try { alarmNode.o.stop(now); } catch { /* already stopped */ } alarmNode = null; }
      const o = ctx.createOscillator(); o.type = 'square';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      o.connect(lp); lp.connect(g); g.connect(p); p.connect(master);
      const k = 0.07 * (1 - far * 0.85);
      for (let t = 0; t < seconds; t += 0.5) {
        o.frequency.setValueAtTime(t % 1 < 0.5 ? 1180 : 880, now + t);
        g.gain.setValueAtTime(k, now + t); g.gain.setValueAtTime(0.0001, now + t + 0.38);
      }
      o.start(now); o.stop(now + seconds);
      alarmNode = { o };
    },
    /* The hit marker's sound: a short tick for a body hit, a higher two-note
       ding for a headshot. Quiet -- it confirms, it does not celebrate. */
    hitmark(head = false) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      for (const [f, t0, len] of head ? [[1560, 0, 0.05], [2340, 0.05, 0.09]] : [[980, 0, 0.035]]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.setValueAtTime(head ? 0.06 : 0.04, now + t0); g.gain.exponentialRampToValueAtTime(0.0005, now + t0 + len);
        o.connect(g); g.connect(master); o.start(now + t0); o.stop(now + t0 + len + 0.01);
      }
    },
    /* Thunder, `delay` seconds after the flash (distance): a low noise rumble
       through a 140 Hz lowpass, 2.4 s, with a sharper crack up front when the
       strike is close (delay under a second). */
    thunder(delay = 1.2) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime + Math.max(0, delay);
      const n = ctx.createBufferSource(); n.buffer = makeNoise(ctx, 2.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(delay < 1 ? 900 : 140, t); lp.frequency.exponentialRampToValueAtTime(60, t + 2.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(delay < 1 ? 0.55 : 0.32, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.4);
      n.connect(lp); lp.connect(g); g.connect(master); n.start(t); n.stop(t + 2.6);
    },
    /* Little Tokyo's ambience: a crowd murmur (band-passed noise, slow
       wander) that fades in while you are in the district, and every ~9 s the
       two-note pedestrian-crossing chime Japanese junctions play. Built once,
       silent at gain 0. */
    tokyo(on, chime = false) {   // `chime`: play the crossing melody now (main syncs it to the nearest junction's green man)
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (!tokyoNode) {
        const n = ctx.createBufferSource(); n.buffer = makeNoise(ctx, 2.0); n.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
        const g = ctx.createGain(); g.gain.value = 0;
        n.connect(bp); bp.connect(g); g.connect(master); n.start(now);
        tokyoNode = { g, bp, nextChime: now + 4 };
      }
      const t = tokyoNode;
      t.g.gain.setTargetAtTime(on ? 0.05 : 0, now, 0.8);
      t.bp.frequency.setTargetAtTime(380 + 90 * Math.sin(now * 0.37), now, 0.5);   // the murmur breathes
      if (on && (chime || now >= t.nextChime)) {
        t.nextChime = now + (chime ? 1e9 : 8 + Math.random() * 3);   // once main drives the chime, the fallback timer retires
        for (const [f, at] of [[1046.5, 0], [880, 0.42]]) {   // C6 then A5: the crossing
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
          const eg = ctx.createGain(); eg.gain.setValueAtTime(0.0001, now + at); eg.gain.exponentialRampToValueAtTime(0.028, now + at + 0.03); eg.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.38);
          o.connect(eg); eg.connect(master); o.start(now + at); o.stop(now + at + 0.4);
        }
      }
    },
    /* A siren somewhere else in the city: three seconds of a faint wail with
       a slow Doppler droop, panned to one side. Ambient, like the distant
       gunfire; nothing to do with you. */
    farSiren(pan = 0) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime, o = ctx.createOscillator(); o.type = 'triangle';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.018, now + 1.0); g.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      for (let t = 0; t < 3.4; t += 1.3) { const k = 1 - t / 8; o.frequency.setValueAtTime(620 * k, now + t); o.frequency.linearRampToValueAtTime(880 * k, now + t + 0.65); o.frequency.linearRampToValueAtTime(620 * k, now + t + 1.3); }
      o.connect(lp); lp.connect(g); g.connect(p); p.connect(master); o.start(now); o.stop(now + 3.5);
    },
    cash() {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      for (const [freq, delay] of [[2200, 0], [2940, 0.07]]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        g.gain.setValueAtTime(0.001, now + delay);
        g.gain.exponentialRampToValueAtTime(0.22, now + delay + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.42);
        osc.connect(g); g.connect(master);
        osc.start(now + delay); osc.stop(now + delay + 0.45);
      }
    },
    victoryFanfare() {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const chord = [
        { f: 523.25, t: 0.00, dur: 0.25 },
        { f: 659.25, t: 0.10, dur: 0.25 },
        { f: 783.99, t: 0.20, dur: 0.32 },
        { f: 1046.50, t: 0.32, dur: 0.85 },
      ];
      for (const n of chord) {
        const osc = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.f, now + n.t);
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2800, now + n.t);
        g.gain.setValueAtTime(0.001, now + n.t);
        g.gain.exponentialRampToValueAtTime(0.22, now + n.t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.dur);
        osc.connect(lp); lp.connect(g); g.connect(master);
        osc.start(now + n.t); osc.stop(now + n.t + n.dur + 0.02);
      }
      setTimeout(() => this.cash(), 340);
      rumble(0.6, 240);
    },
    update(car) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const rpm = car.rpm ?? (car.rotorRpm !== undefined ? 1200 + car.rotorRpm * 4200 : (car.speed ? 1800 + car.speed * 70 : 800));
      const load = car.gear === 1 ? (car.throttle || 0) * 0.35 : (car.throttle || 0);
      const layersNow = engineLayerGains(rpm, load);
      for (let i = 0; i < layers.length; i++) {
        const g = layersNow.bands[i];
        const layer = layers[i];
        layer.off.gain.gain.setTargetAtTime(g.off, now, 0.045);
        layer.on.gain.gain.setTargetAtTime(g.on, now, 0.045);
        layer.off.src.playbackRate.setTargetAtTime(g.rate, now, 0.06);
        layer.on.src.playbackRate.setTargetAtTime(g.rate, now, 0.06);
      }
      limiter.gain.gain.setTargetAtTime(layersNow.limiter * 0.4, now, 0.05);
      turboFilter.frequency.setTargetAtTime(1600 + rpm * 0.35 + load * 900, now, 0.08);
      turboGain.gain.setTargetAtTime(load * Math.min(1, rpm / 4200) * 0.045, now, 0.1);

      const speed = car.speed || 0;
      const tyre = Math.max(0, (car.slip || 0) - 0.08) * 0.55 + (car.kerb ? 0.04 * Math.min(1, speed / 12) : 0);
      tyreGain.gain.setTargetAtTime(tyre, now, 0.04);
      tyreFilter.frequency.setTargetAtTime(700 + (car.slip || 0) * 1400, now, 0.08);
      windGain.gain.setTargetAtTime(Math.min(0.07, (speed / 70) ** 2 * 0.09), now, 0.12);

      if (car.gear !== undefined && car.gear !== lastGear) { lastGear = car.gear; shiftClick(); }
      if ((car.impact || 0) > 2.4 && car.impact > lastImpact + 0.5) thud(car.impact);
      lastImpact = car.impact || 0;
    },
    /* One siren for the fleet: a two-tone wail (a square through a lowpass,
       sweeping 620-880 Hz on a 1.3 s cycle) that lives as long as the context
       does and is silent at gain 0. `far` 0..1 is distance (1 = inaudible),
       `pan` -1..1. Nearest cruiser only -- five sirens are one siren louder. */
    siren(pan = 0, far = 1) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (!sirenNode) {
        const o = ctx.createOscillator(); o.type = 'square';
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900;
        const g = ctx.createGain(); g.gain.value = 0;
        const p = ctx.createStereoPanner();
        o.connect(lp); lp.connect(g); g.connect(p); p.connect(master); o.start(now);
        sirenNode = { o, g, p, phase: now };
      }
      const s = sirenNode;
      // schedule the sweep a cycle ahead of where we are, once per cycle
      while (s.phase < now + 1.3) { s.o.frequency.setValueAtTime(620, s.phase); s.o.frequency.linearRampToValueAtTime(880, s.phase + 0.65); s.o.frequency.linearRampToValueAtTime(620, s.phase + 1.3); s.phase += 1.3; }
      const k = Math.max(0, 1 - far);
      s.g.gain.setTargetAtTime(0.09 * k * k, now, 0.08);
      s.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.1);
    },
    /** 0..1 -- how much rain there is to hear. */
    setRain(amount) {
      if (!ready || !ctx || !rainGain) return;
      rainGain.gain.setTargetAtTime(Math.max(0, Math.min(1, amount)) * 0.028,
        ctx.currentTime, 0.5);
    },
    gunshot,
    thud,
    /** Magazine out, magazine in: two short clicks 0.45 s apart, scaled to the weapon's reload. */
    reload(seconds = 1.5) {
      if (!ctx) return;
      const click = (at, f) => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0.09, at); g.gain.exponentialRampToValueAtTime(0.0008, at + 0.04); o.connect(g); g.connect(master); o.start(at); o.stop(at + 0.05); };
      const t = ctx.currentTime; click(t + 0.05, 900); click(t + Math.max(0.3, seconds * 0.6), 1300);
    },
    /** A weapon coming up: one dry click. */
    click() { if (!ctx) return; const t = ctx.currentTime; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 700; const g = ctx.createGain(); g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06); },   // impact thud, magnitude in m/s-ish; punches and blasts borrow it
    mute(on) {
      if (!master) return;
      master.gain.setTargetAtTime(on ? 0 : 0.24, ctx.currentTime, 0.08);
    },
  };
}
