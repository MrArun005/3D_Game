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
  function gunshot() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = makeNoise(ctx, 0.16);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    n.connect(hp); hp.connect(g); g.connect(master);
    n.start(t); n.stop(t + 0.18);
    const body = ctx.createOscillator();
    body.type = 'square';
    body.frequency.setValueAtTime(180, t);
    body.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const bg2 = ctx.createGain();
    bg2.gain.setValueAtTime(0.16, t);
    bg2.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
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
    update(car) {
      if (!ready || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const rpm = car.rpm;
      const load = car.gear === 1 ? car.throttle * 0.35 : car.throttle;
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

      const speed = car.speed;
      const tyre = Math.max(0, car.slip - 0.08) * 0.55 + (car.kerb ? 0.04 * Math.min(1, speed / 12) : 0);
      tyreGain.gain.setTargetAtTime(tyre, now, 0.04);
      tyreFilter.frequency.setTargetAtTime(700 + car.slip * 1400, now, 0.08);
      windGain.gain.setTargetAtTime(Math.min(0.07, (speed / 70) ** 2 * 0.09), now, 0.12);

      if (car.gear !== lastGear) { lastGear = car.gear; shiftClick(); }
      if (car.impact > 2.4 && car.impact > lastImpact + 0.5) thud(car.impact);
      lastImpact = car.impact;
    },
    /** 0..1 -- how much rain there is to hear. */
    setRain(amount) {
      if (!ready || !ctx || !rainGain) return;
      rainGain.gain.setTargetAtTime(Math.max(0, Math.min(1, amount)) * 0.028,
        ctx.currentTime, 0.5);
    },
    gunshot,
    mute(on) {
      if (!master) return;
      master.gain.setTargetAtTime(on ? 0 : 0.24, ctx.currentTime, 0.08);
    },
  };
}
