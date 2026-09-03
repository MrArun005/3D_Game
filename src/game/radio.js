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
];

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
    this.hud.flash(`RADIO · ${STATIONS[this.station].name}`);
    this.timer = setInterval(() => this.#schedule(), 90);
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
