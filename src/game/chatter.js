/**
 * Police Scanner Dispatch & Ambient Street Chatter Engine.
 *
 * Generates dynamic 10-code police radio chatter on pursuit events, with a
 * synthesized dual-tone radio squelch burst [CHRRK-BEEP] routed strictly
 * through the game's audio.bus() to respect the master mute on KeyU.
 */

const DISPATCH_LINES = {
  1: [
    'Dispatch to 1-Adam-12, report of reckless driving on Kingsway Avenue.',
    'All units in Sector 2, monitor for a speeding sports vehicle.',
    'Notice to patrol: citizen reports erratic driving near the downtown grid.'
  ],
  2: [
    '10-41 suspect vehicle refusing to stop. Units initiate pursuit.',
    'Suspect is evading. Authorizing secondary units to assist.',
    'Dispatch to all cars, suspect fleeing at high velocity. Mind cross-traffic.'
  ],
  3: [
    'Air Support has visual on suspect vehicle. Code 3 authorized!',
    'Suspect is blowing through intersections. Roadblocks authorized on Kingsway.',
    'Air-1 to dispatch: suspect moving rapidly towards the bridge approach.'
  ],
  4: [
    'All units, suspect is extremely dangerous. Tactical intervention authorized!',
    'Air-1 tracking: suspect weaving through traffic. Spike strips ready.',
    'Full district alert! All available cruisers converge on suspect coordinates.'
  ],
  5: [
    'Code Red! Lethal force authorized. Stop that vehicle by any means!',
    'State Tactical units entering Halstead Bay jurisdiction.'
  ],
  0: [
    '10-99 visual lost on suspect. All units stand down and resume patrol.',
    'Search area clear. Suspect has gone to ground. Return to normal patrol.',
    'Dispatch confirming pursuit terminated. Patrol units resume sector watch.'
  ]
};

const PED_SHOUTS = [
  'Watch the road, lunatic!',
  'Hey! I’m walking here!',
  'Who taught you how to drive?!',
  'Did you see that drift?!',
  'Call the cops on that maniac!'
];

export class ChatterEngine {
  constructor(audio, chat) {
    this.audio = audio;
    this.chat = chat;
    this.lastWanted = 0;
    this.lastDispatchTime = 0;
    this.lastNearMissTime = 0;
  }

  /**
   * Produce a realistic 2-stage radio squelch burst [NOISE -> BEEP].
   * Connected directly to audio.bus() to respect mute, guarded against null context.
   */
  #playSquelch() {
    const ctx = this.audio?.context?.();
    if (!ctx) return; // User has not interacted yet, skip audio gracefully

    const bus = this.audio.bus?.();
    if (!bus) return;

    const t = ctx.currentTime;

    try {
      // 1. White noise burst (radio click / static)
      const bufferSize = ctx.sampleRate * 0.06; // 60ms
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1400, t);
      noiseFilter.Q.setValueAtTime(3.0, t);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.08, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(bus);
      whiteNoise.start(t);
      whiteNoise.stop(t + 0.06);

      // 2. High-pitch radio beep (MDC / repeater roger beep)
      const beepOsc = ctx.createOscillator();
      beepOsc.type = 'sine';
      beepOsc.frequency.setValueAtTime(1240, t + 0.04);
      beepOsc.frequency.setValueAtTime(1860, t + 0.08);

      const beepGain = ctx.createGain();
      beepGain.gain.setValueAtTime(0.0001, t);
      beepGain.gain.setValueAtTime(0.05, t + 0.04);
      beepGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

      beepOsc.connect(beepGain);
      beepGain.connect(bus);
      beepOsc.start(t + 0.04);
      beepOsc.stop(t + 0.12);
    } catch {
      // Ignore audio scheduling exceptions
    }
  }

  /**
   * Monitor wanted level changes and trigger voice dispatch.
   */
  /** A line from a rotating pool for an event, so the same call is not heard twice running. */
  radioPool(key) {
    const POOLS = {
      deploy: ['Unit on scene, suspect stopped. Stepping out.', 'Contact. Going on foot.', 'Suspect vehicle stationary, moving in.'],
      deployHot: ['Shots fired, officers on foot, requesting backup.', 'Taking fire! Send everything you have.', 'Officer needs assistance, shots fired!'],
      down: ['Officer down! Officer down!', 'Man down, we need a medic!', 'We have an officer hit, repeat, officer hit!'],
      advance: ['Suspect has gone quiet. Moving up.', 'Closing in, cover me.', 'Advancing on the last known position.'],
      arrest: ['On the ground! Hands where I can see them!', 'Do not move! Stay down!', 'You are done. Hands behind your back.'],
      pinned: ['Taking fire, returning fire.', 'Pinned down behind the unit, engaging.', 'Suspect is armed and firing, engaging.'],
      rooftops: ['Marksmen in position on the rooftops.', 'Overwatch is up, we have the high ground.', 'Snipers set, awaiting the shot.'],
      blast: ['Explosion downtown! Suspect has explosives!', 'Detonation reported, escalate to code red.', 'That was a grenade. All units, extreme caution.'],
      lost: ['Lost visual on the suspect.', 'No eyes on the target, widening the search.', 'Suspect has evaded, last seen heading downtown.'],
      reload: ['Reloading! Cover me!', 'Changing mags!', 'I am out, cover!'],
      search: ['Sweeping the block, no visual yet.', 'Check the alleys, suspect went to ground.', 'Units hold the perimeter, we are searching.', 'Last seen on foot, could be anywhere in here.'],
      regained: ['Visual regained! Suspect sighted!', 'There! All units, we have the suspect!', 'Eyes on, eyes on, moving in!'],
      frag: ['Frag out!', 'Grenade! Flushing him out.', 'Tactical, frag going in behind the vehicle.'],
      swat: ['Tactical is on scene. Heavy weapons authorised.', 'SWAT deploying, all units hold the perimeter.', 'Tactical team out, suspect is to be considered armed and dangerous.'],
      npcChase: ['In pursuit of a vehicle failing to stop, requesting a unit.', 'Traffic stop refused, suspect vehicle fleeing, in pursuit.', 'Unit 12 in pursuit, northbound, lights and siren.'],
    };
    const pool = POOLS[key]; if (!pool) return;
    this._poolIdx ??= {};
    const i = (this._poolIdx[key] = ((this._poolIdx[key] ?? -1) + 1) % pool.length);
    this.radio(pool[i]);
  }

  /** One dispatch line from the firefight AI, with the squelch, at most one a second. */
  radio(line) {
    const now = performance.now();
    if (now - (this._lastRadio || 0) < 1000) return;
    this._lastRadio = now;
    this.#playSquelch();
    this.chat?.post?.('DISPATCH', line);
  }

  updateWanted(wantedLevel) {
    const lvl = Math.floor(Math.max(0, Math.min(5, wantedLevel || 0)));
    const now = performance.now();

    if (lvl !== this.lastWanted) {
      const lines = DISPATCH_LINES[lvl] || DISPATCH_LINES[0];
      const line = lines[Math.floor(Math.random() * lines.length)];

      this.#playSquelch();
      this.chat.post('DISPATCH', line);

      this.lastWanted = lvl;
      this.lastDispatchTime = now;
    } else if (lvl > 0 && now - this.lastDispatchTime > 16000) {
      // Repeat situational updates during sustained pursuits
      const lines = DISPATCH_LINES[lvl] || [];
      if (lines.length) {
        const line = lines[Math.floor(Math.random() * lines.length)];
        this.#playSquelch();
        this.chat.post('DISPATCH', line);
        this.lastDispatchTime = now;
      }
    }
  }

  /**
   * Near miss with pedestrians or aggressive drifting.
   */
  triggerPedReaction() {
    const now = performance.now();
    if (now - this.lastNearMissTime < 8000) return; // rate limit banter
    this.lastNearMissTime = now;

    const line = PED_SHOUTS[Math.floor(Math.random() * PED_SHOUTS.length)];
    this.chat.post('STREET', line);
  }
}
