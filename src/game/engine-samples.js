/**
 * Sampled turbo-four: loops baked at a few RPM centres, then crossfaded
 * and pitch-shifted in the player the way a racing game does.
 * I4 four-stroke → two combustion events per crank revolution.
 */
export const ENGINE_BANDS = [900, 1800, 3000, 4200, 5500, 6800];
export const REDLINE = 6800;

export function engineLayerGains(rpm, load) {
  const r = Math.max(ENGINE_BANDS[0], Math.min(REDLINE, rpm));
  const L = Math.max(0, Math.min(1, load));
  const bands = ENGINE_BANDS.map((br) => ({ rpm: br, rate: r / br, on: 0, off: 0 }));

  let i = 0;
  while (i < ENGINE_BANDS.length - 2 && ENGINE_BANDS[i + 1] < r) i++;
  const a = ENGINE_BANDS[i], b = ENGINE_BANDS[i + 1];
  const t = (r - a) / Math.max(1e-6, b - a);
  bands[i].off = (1 - t) * (1 - L);
  bands[i].on = (1 - t) * L;
  bands[i + 1].off = t * (1 - L);
  bands[i + 1].on = t * L;

  const limiter = Math.max(0, Math.min(1, (r - 6400) / 400));
  return { bands, limiter };
}

function hash01(i) {
  i |= 0;
  i = Math.imul(i ^ (i >>> 16), 2246822519);
  i = Math.imul(i ^ (i >>> 13), 3266489917);
  return ((i ^ (i >>> 16)) >>> 0) / 4294967296;
}

/**
 * One seamless loop at a given RPM and load (0 coast … 1 wide open).
 * Integer combustion cycles so the first and last samples already agree;
 * a short wrap blend kills whatever the filter leaves behind.
 */
export function renderEngineLoop(sampleRate, rpm, load) {
  const rps = rpm / 60;
  const combHz = rps * 2;
  const want = 0.4;
  const cycles = Math.max(2, Math.round(combHz * want));
  const n = Math.round(sampleRate * cycles / combHz);
  const out = new Float32Array(n);
  const L = Math.max(0, Math.min(1, load));
  const cutoff = 0.10 + L * 0.20 + (rpm / REDLINE) * 0.12;
  let lp = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const crank = 2 * Math.PI * rps * t;
    let s = 0;
    s += 0.20 * Math.sin(crank);
    s += (0.36 + L * 0.24) * Math.sin(2 * crank);
    s += 0.11 * Math.sin(4 * crank);
    s += 0.05 * Math.sin(6 * crank);
    s += (0.04 + L * 0.09) * Math.sin(0.5 * crank + 0.2);
    const combPhase = (t * combHz) % 1;
    const pulse = Math.pow(Math.max(0, Math.sin(Math.PI * combPhase)), 9);
    s += (0.26 + L * 0.48) * pulse;
    s += (hash01(i * 17 + (rpm | 0)) * 2 - 1) * (0.028 + L * 0.07);
    lp += (s - lp) * cutoff;
    out[i] = lp;
  }

  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = (0.52 + 0.46 * L) / peak;
  for (let i = 0; i < n; i++) out[i] *= g;

  const fade = Math.min(96, n >> 3);
  const head = out[0];
  for (let i = 0; i < fade; i++) {
    const k = (i + 1) / fade;
    const idx = n - fade + i;
    out[idx] = out[idx] * (1 - k) + head * k;
  }
  return out;
}

export function renderLimiterLoop(sampleRate) {
  const base = renderEngineLoop(sampleRate, REDLINE, 1);
  const n = base.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cut = hash01(i * 3) > 0.78 ? 0.15 : 1;
    out[i] = base[i] * cut + (hash01(i * 9) * 2 - 1) * 0.04;
  }
  return out;
}

export function toAudioBuffer(ctx, samples) {
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.getChannelData(0).set(samples);
  return buf;
}
