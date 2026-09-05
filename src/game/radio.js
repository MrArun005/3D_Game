/**
 * Radio: three generative stations, no assets, no licences.
 *
 * L cycles OFF -> 1 -> 2 -> 3. Each station is a tempo, a scale and a
 * palette of synthesized parts scheduled 0.25 s ahead on the game's own
 * AudioContext: a kick, a hat, a bass line and a lead walking a pentatonic
 * scale. It is a sketch of a station, not a track, but a city with a car
 * radio stops feeling like a screensaver.
 */
const STATIONS = [
  { name: 'HALSTEAD LO-FI', bpm: 84, root: 220, scale: [0, 3, 5, 7, 10], swing: 0.12, lead: 'sine', bass: 'triangle' },
  { name: 'KINGSWAY FM',    bpm: 118, root: 261.6, scale: [0, 2, 4, 7, 9], swing: 0, lead: 'sawtooth', bass: 'square' },
  { name: 'SYNTHWAVE 84',   bpm: 124, root: 146.8, scale: [0, 3, 5, 7, 8, 10], swing: 0.05, lead: 'sawtooth', bass: 'sawtooth' },
  { name: 'WEST COAST RAP', bpm: 92, root: 164.8, scale: [0, 3, 5, 7, 10], swing: 0.16, lead: 'triangle', bass: 'sine' },
  { name: 'HARBOUR DUB',    bpm: 70, root: 196, scale: [0, 3, 5, 7, 10], swing: 0.18, lead: 'triangle', bass: 'sine' },
  // Little Tokyo's station: city-pop tempo on the yo scale (the Japanese major pentatonic), bright square lead
  { name: 'SHIBUYA CITY POP', bpm: 108, root: 293.7, scale: [0, 2, 5, 7, 9], swing: 0.04, lead: 'square', bass: 'triangle' },
];

const DJ_BUMPERS = {
  'HALSTEAD LO-FI': [
    'Chill beats for cruising Halstead Bay at dusk.',
    'No traffic, no stress, just mellow vibes.',
    'Midnight rain on the windscreen. Keep it locked.'
  ],
  'KINGSWAY FM': [
    "You're locked to 104.2 Kingsway FM — no adverts, just asphalt.",
    'Speed camera warning on Kingsway East. Mind the throttle.',
    'Banging basslines straight from Downtown.'
  ],
  'SYNTHWAVE 84': [
    'Retro neon drives and analog sunsets on 84.8.',
    'Outrun the grid. Halstead by night never sleeps.',
    'Synthesizers at maximum velocity.'
  ],
  'WEST COAST RAP': [
    'Heavy 808s rolling through the Southside flats.',
    'Street level frequencies. Representing Halstead Bay.',
    'Drop the clutch, spin the block.'
  ],
  'SHIBUYA CITY POP': [
    'Shibuya City Pop, 88.8 -- neon, rain and a two a.m. taxi home.',
    'Little Tokyo after dark. Ramen at the counter, then the last train.',
    'City pop for the scramble crossing. Mind the kanban.',
  ],
  'HARBOUR DUB': [
    'Echoes rolling off the quay. Deep sub-frequencies.',
    'Low-end heavy from Harbour Point to the docks.',
    'Heavy tape delay for the night drive.'
  ]
};

export class Radio {
  constructor(audio, hud) {
    this.audio = audio; this.hud = hud; this.station = -1; this.timer = null; this.next = 0; this.step = 0; this.leadNote = 2;
  }

  cycle() {
    this.station = (this.station + 2) % (STATIONS.length + 1) - 1;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.bus) { this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
    if (this.station < 0) { this.hud.flash('RADIO OFF'); return; }
    const ctx = this.audio.context?.(); if (!ctx) { this.hud.flash('RADIO · CLICK THE GAME FIRST'); this.station = -1; return; }
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.16; this.bus.connect(this.audio.bus());
    this.next = ctx.currentTime + 0.1; this.step = 0;
    const st = STATIONS[this.station];
    const bumpers = DJ_BUMPERS[st.name] || [];
    const b = bumpers[Math.floor(Math.random() * bumpers.length)] || '';
    this.hud.flash(`📻 ${st.name}\n"${b}"`);
    // the DJ says it too: the browser's speech synthesis, brighter and slower than dispatch (?novoice turns every voice off)
    try {
      if (b && typeof speechSynthesis !== 'undefined' && !new URLSearchParams(location.search).has('novoice')) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(`${st.name}. ${b}`.replace(/[^\x00-\x7F]/g, ' '));
        u.rate = 1.0; u.pitch = 1.12; u.volume = 0.6; u.lang = 'en-US';
        speechSynthesis.speak(u);
      }
    } catch { /* no voice, no harm */ }
    this.timer = setInterval(() => this.#schedule(), 90);
  }

  /** A newsflash on whatever station is playing: the DJ voice reads it, the music dips for a moment. Silent with the radio off. */
  news(line) {
    if (this.station < 0 || !this.bus || !line) return;
    try {
      if (typeof speechSynthesis === 'undefined' || new URLSearchParams(location.search).has('novoice')) return;
      const now = this.ctx.currentTime;
      this.bus.gain.setTargetAtTime(0.05, now, 0.2); this.bus.gain.setTargetAtTime(0.16, now + 4.5, 0.6);   // the duck
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(`Newsflash. ${line}`.replace(/[^\x00-\x7F]/g, ' '));
      u.rate = 1.02; u.pitch = 1.0; u.volume = 0.65; u.lang = 'en-US';
      speechSynthesis.speak(u);
      this.hud.flash(`📻 NEWSFLASH · ${line}`);
    } catch { /* no voice, no harm */ }
  }

  #tone(type, f, t, dur, gain, dest = this.bus) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  #schedule() {
    const st = STATIONS[this.station]; if (!st) return;
    const beat = 60 / st.bpm, sixteenth = beat / 4;
    while (this.next < this.ctx.currentTime + 0.25) {
      const s = this.step % 16, t = this.next + ((s % 2) ? st.swing * sixteenth : 0);
      // kick on 1 and 3 (and the dub's off-beat), hat on the off-eighths
      if (s % 8 === 0 || (st.bpm < 80 && s === 10)) { const k = this.#tone('sine', 120, t, 0.28, 0.9); k.frequency.exponentialRampToValueAtTime(40, t + 0.2); }
      if (s % 4 === 2) { const h = this.#tone('square', 6000 + Math.random() * 2000, t, 0.03, 0.06); }
      // bass: root and fifth on the bar
      if (s % 8 === 0 || s === 6) this.#tone(st.bass, st.root / 2 * (s === 6 ? 1.5 : 1), t, beat * 0.9, 0.35);
      // lead: a random walk on the scale, rests included
      if (s % 2 === 0 && Math.random() < 0.55) {
        this.leadNote = Math.max(0, Math.min(st.scale.length * 2 - 1, this.leadNote + (Math.random() < 0.5 ? -1 : 1)));
        const octave = Math.floor(this.leadNote / st.scale.length), deg = st.scale[this.leadNote % st.scale.length];
        this.#tone(st.lead, st.root * Math.pow(2, octave + deg / 12), t, beat * 0.6, 0.12);
      }
      this.next += sixteenth; this.step++;
    }
  }
}
