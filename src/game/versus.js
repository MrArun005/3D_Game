/**
 * Versus: the things two players in a room agree to do to each other, for money.
 *
 * Four challenges -- RACE, PURSUIT, DELIVERY DUEL, SURVIVOR -- all generated
 * from the ROOM SEED, so neither machine ever sends a course: same room, same
 * round, same kind => byte-identical checkpoints out of the same seeded walk
 * over the same road graph. What travels is a handful of small packets
 * (offer / accept / decline / progress at 2 Hz / abort), never per frame.
 *
 * THIS FILE IS PURE. No three.js, no scene, no DOM, no clock of its own: a
 * match is a plain object, `tick(state, input)` returns a NEW state plus the
 * events the caller should draw, flash or play. Markers, HUD and packets are
 * main.js's job. That is why the whole decision half is testable in node.
 *
 * ---- How a result settles without a server ----
 *
 * There is no authority. Each side measures ONE number about ITSELF -- its own
 * finish time, its own seconds-in-range, its own seconds survived -- reports it,
 * and BOTH sides run the same comparison (`compare`) over the same two numbers.
 * Same packets in, same verdict out, on both machines. Nobody declares
 * themselves the winner; the rule does.
 *
 * What an adversarial peer can still do, plainly: they can lie about their own
 * number. Report 12.0 s for a race they never finished and they win, and this
 * file cannot tell. It never could -- there is nothing to check it against.
 * This is a friendly wager between two people who can see each other's car;
 * the guarantee on offer is CONSISTENCY (both machines always reach the same
 * verdict from the same packets), not integrity. Do not stake anything that
 * matters on it.
 *
 * ---- Money, and why nothing is escrowed ----
 *
 * Settlement is ONE delta applied at the end: winner +wager, loser -wager,
 * draw/void 0. There is no pot held anywhere, so there is nothing to refund and
 * no way for both sides to pay themselves out of it.
 *
 * A peer that vanishes is the reason for that choice. `PEER_TIMEOUT` seconds of
 * silence VOIDS the match on both sides -- not a walkover. A walkover looks
 * fairer until the network splits: each side times the other out, each awards
 * itself the pot, and the wager is MINTED on both machines. Void cannot do
 * that. The one bad case left is a final packet lost while the other side is
 * still driving: one pays and the other voids, and the stake is destroyed
 * rather than duplicated. That is the safe direction to fail in, and with no
 * server it is the best available. The progress packet keeps being sent for
 * `LINGER` seconds after a decided match precisely to make that case rare -- a
 * VOID sends nothing at all, because a void has no number to offer.
 *
 * Every state has a way out: an offer nobody answers times out, a peer that
 * drops voids, driving off the map for `STRAY_GRACE` seconds ends YOUR run
 * (metric DNF) rather than hanging, bailing out after the green light is a DNF
 * too (so two people quitting is a dead heat, not two losses), and every
 * challenge has a hard `cap`, so both sides stop measuring at the same elapsed
 * time whatever happens.
 */

export const KINDS = ['race', 'pursuit', 'delivery', 'survivor'];

const COUNTDOWN = 5;          // seconds from accept to green light
const OFFER_TIMEOUT = 25;     // an offer nobody answers
const PEER_TIMEOUT = 8;       // silence from a peer that was talking at 2 Hz
const WAIT_SLACK = 15;        // how long past my own cap I wait for their number
const STRAY_GRACE = 6;        // seconds allowed outside the district before DNF
const GATE_R = 9;             // checkpoint radius, metres
const LINGER = 6;             // keep sending the result after the match ends
export const REPORT_HZ = 2;   // progress packets per second

/* The same FNV-1a multiplayer.js hashes the room id with. Kept here so versus
   can be seeded (and tested) without importing anything that touches three. */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Room seed + kind + round -> the seed a course is built from. A rematch is a new course. */
export function courseSeed(roomSeed, kind, round = 0) {
  let h = (roomSeed >>> 0) ^ hashSeed(kind);
  h = Math.imul(h ^ (round + 1), 2654435761);
  return h >>> 0;
}

function rng(seed) {
  let st = seed >>> 0 || 1;
  return () => {
    st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0;
    return st / 4294967296;
  };
}

/* sqrt, not Math.hypot: sqrt is correctly rounded by IEEE754 in every engine,
   Math.hypot's precision is implementation-defined. The course is generated
   from this on BOTH machines, and a one-ULP difference inside chain()'s score
   comparison would hand the two players different checkpoints. */
const dist = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); };

/** Junctions that are genuinely on tarmac and not in the bay. Deterministic order. */
function roadNodes(district) {
  return district.graph.nodes
    .filter((n) => (n.kind === 'cross' || n.kind === 'tee')
      && district.tarmacDepth(n.x, n.y) < -1
      && !district.inWater(n.x, n.y))
    .map((n) => ({ x: n.x, z: n.y }));
}

/** Walk outward from a seeded anchor: each leg min..max from the last, never doubling back. */
function chain(nodes, rnd, count, min, max) {
  const pts = [];
  let from = nodes[(rnd() * nodes.length) | 0];
  pts.push(from);
  for (let i = 1; i < count; i++) {
    let best = null, bs = -Infinity;
    for (let k = 0; k < 240; k++) {
      const n = nodes[(rnd() * nodes.length) | 0];
      const d = dist(n, from);
      if (d < min || d > max) continue;
      const near = pts.reduce((m, p) => Math.min(m, dist(p, n)), 1e9);
      const s = Math.min(near, 400) - Math.abs(d - (min + max) / 2) * 0.4;
      if (s > bs) { bs = s; best = n; }
    }
    if (!best) break;
    pts.push(best); from = best;
  }
  return pts;
}

const legLength = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);

/**
 * The seeded generator. (kind, seed, district) -> course/params, identical on
 * both machines. `cap` is the hard stop every challenge shares.
 */
export function generate(kind, seed, district) {
  const rnd = rng(seed);
  const nodes = roadNodes(district);
  if (nodes.length < 8) throw new Error('versus: no road nodes');
  const b = district.bounds;
  const bounds = { w: b.w, h: b.h };

  if (kind === 'race') {
    const gates = chain(nodes, rnd, 6, 220, 460);
    const par = legLength(gates) / 15 + 10;
    return { kind, seed, gates, par, cap: par * 2.2, bounds, goal: 'low' };
  }
  if (kind === 'delivery') {
    const pair = chain(nodes, rnd, 2, 600, 1150);
    const par = legLength(pair) / 13 + 15;
    return {
      kind, seed, pickup: pair[0], drop: pair[1] ?? pair[0], par,
      cap: par * 2.4, bounds, goal: 'low',
    };
  }
  if (kind === 'pursuit') {
    const route = chain(nodes, rnd, 5, 180, 380);
    return {
      kind, seed, route, legSecs: 60, maxDist: 45,
      cap: 60 * 2 + COUNTDOWN + 10, bounds, goal: 'high',
    };
  }
  if (kind === 'survivor') {
    const stars = 3 + ((rnd() * 2) | 0);
    return { kind, seed, stars, cap: 120, bounds, goal: 'high' };
  }
  throw new Error(`versus: unknown challenge ${kind}`);
}

/**
 * A match, before anyone has agreed to anything. `mine` is true for the side
 * that sent the offer -- the one fact both machines know about each other
 * without exchanging or comparing an id, which is why PURSUIT's roles hang off
 * it: the challenger runs the first leg, the challenged chases it.
 */
export function createMatch({ kind, roomSeed, district, wager = 0, round = 0, mine = true }) {
  const params = generate(kind, courseSeed(roomSeed, kind, round), district);
  return {
    kind, params, wager, round, mine,
    phase: 'offered',          // offered -> countdown -> running -> waiting -> over
    t: 0,                      // seconds in the current phase
    elapsed: 0,                // seconds since the green light
    i: 0,                      // checkpoint / stage index
    splits: [],
    hold: 0,                   // pursuit: my seconds in range while chasing
    stray: 0,                  // seconds outside the district
    metric: null,              // my number; null = DNF
    peer: null,                // their last report
    peerAge: 0,
    result: null,              // 'win' | 'loss' | 'draw' | 'void'
    reason: '',
    delta: 0,
    /* PURSUIT: whoever offered runs leg 0 and chases leg 1. Both sides agree
       on that without a word, because each already knows which end it is. */
    firstRunner: mine ? 'self' : 'peer',
  };
}

/** Am I the chaser on this leg (0 or 1)? */
export function roleOn(state, leg) {
  const iRunFirst = state.firstRunner === 'self';
  const iRun = leg === 0 ? iRunFirst : !iRunFirst;
  return iRun ? 'runner' : 'chaser';
}

/** Lower is better for a race, higher for a hold or a survival. null is DNF. */
export function compare(goal, mine, theirs) {
  if (mine == null && theirs == null) return 'draw';
  if (mine == null) return 'loss';
  if (theirs == null) return 'win';
  if (mine === theirs) return 'draw';
  const better = goal === 'low' ? mine < theirs : mine > theirs;
  return better ? 'win' : 'loss';
}

function end(s, result, reason) {
  const next = { ...s, phase: 'over', t: 0, result, reason };
  next.delta = result === 'win' ? s.wager : result === 'loss' ? -s.wager : 0;
  return next;
}

/**
 * One step. `input` is everything the game knows this frame:
 *   { dt, x, z, speed, wanted, busted, wasted, peerDist, accepted, declined, aborted, abort }
 * `accepted` / `declined` / `aborted` are edges raised by a received packet;
 * `abort` is the local player pressing the abort key.
 * Returns { state, events }. Events: countdown, go, checkpoint, leg, done, end.
 */
export function tick(state, input = {}) {
  const dt = input.dt || 0;
  const ev = [];
  let s = { ...state, t: state.t + dt, peerAge: state.peerAge + dt };

  if (s.phase === 'over') {
    return { state: s, events: ev };
  }

  /* Bailing out. Before the green light nothing is at stake, so a withdrawal
     is a void; after it, the one who bails posts a DNF and loses to any number. */
  if (input.abort || input.aborted) {
    const pre = s.phase === 'offered' || s.phase === 'countdown';
    if (pre) {
      return { state: end(s, 'void', 'CALLED OFF'), events: [{ k: 'end', result: 'void', reason: 'CALLED OFF' }] };
    }
    /* After the green light a bail is a DNF, not an instant loss, and hearing
       one is not an instant win. The instant version is what this did first,
       and it is wrong: with any latency at all, two players who quit within a
       packet's flight of each other BOTH resolve locally as the loser before
       either hears the other, and the stake is paid twice into nowhere. As a
       DNF it costs the bailer exactly the same match -- a finish beats a DNF --
       and two bails are a dead heat, which is the only answer that balances. */
    if (input.aborted) s = { ...s, peerAge: 0, peer: { done: true, metric: null, i: s.peer?.i ?? 0 } };
    if (input.abort) {
      // already finished and just waiting for their number? Keep the number.
      if (s.phase !== 'waiting') ev.push({ k: 'done', metric: null, reason: 'YOU BAILED' });
      const mine = s.phase === 'waiting' ? s : { ...s, metric: null };
      return { state: settleOrWait(mine, ev), events: ev };
    }
    /* They quit; their number is a DNF. Say so, because it changes what you
       should do: any number at all beats a DNF, so finish -- park up and you
       post a DNF too, and two DNFs are a dead heat that pays nobody. */
    ev.push({ k: 'quit' });
    if (s.phase === 'waiting') return { state: settleOrWait(s, ev), events: ev };
  }

  if (s.phase === 'offered') {
    if (input.declined) return { state: end(s, 'void', 'DECLINED'), events: [{ k: 'end', result: 'void', reason: 'DECLINED' }] };
    if (input.accepted) {
      s = { ...s, phase: 'countdown', t: 0, peerAge: 0 };
      ev.push({ k: 'countdown', n: COUNTDOWN });
      return { state: s, events: ev };
    }
    if (s.t >= OFFER_TIMEOUT) return { state: end(s, 'void', 'NO ANSWER'), events: [{ k: 'end', result: 'void', reason: 'NO ANSWER' }] };
    return { state: s, events: ev };
  }

  /* From here on a silent peer is a dead peer, and a dead peer voids the bet --
     UNLESS I am already holding their final number, in which case the match is
     decided and their silence is just them having stopped sending. Voiding
     there would pay one side and void the other: cash minted. */
  if (s.peerAge > PEER_TIMEOUT && !(s.phase === 'waiting' && s.peer?.done)) {
    return { state: end(s, 'void', 'PEER DROPPED'), events: [{ k: 'end', result: 'void', reason: 'PEER DROPPED' }] };
  }

  if (s.phase === 'countdown') {
    const was = Math.ceil(COUNTDOWN - state.t);
    const now = Math.ceil(COUNTDOWN - s.t);
    if (now !== was && now > 0) ev.push({ k: 'countdown', n: now });
    if (s.t >= COUNTDOWN) { s = { ...s, phase: 'running', t: 0, elapsed: 0 }; ev.push({ k: 'go' }); }
    return { state: s, events: ev };
  }

  if (s.phase === 'running') {
    s.elapsed = state.elapsed + dt;

    // off the map: a grace, then your run is a DNF. Never a hang.
    const b = s.params.bounds;
    const out = input.x < -40 || input.z < -40 || input.x > b.w + 40 || input.z > b.h + 40;
    s.stray = out ? s.stray + dt : 0;
    if (s.stray > STRAY_GRACE) {
      ev.push({ k: 'done', metric: null, reason: 'LEFT THE DISTRICT' });
      return { state: settleOrWait({ ...s, metric: null }, ev), events: ev };
    }

    s = step(s, input, ev);
    if (s.elapsed >= s.params.cap && s.phase === 'running') {
      // the cap is the same on both machines, so both stop measuring together
      const capped = s.params.goal === 'high' ? capMetric(s) : null;
      ev.push({ k: 'done', metric: capped, reason: 'TIME' });
      return { state: settleOrWait({ ...s, metric: capped }, ev), events: ev };
    }
    if (s.phase === 'waiting') return { state: settleOrWait(s, ev), events: ev };
    return { state: s, events: ev };
  }

  if (s.phase === 'waiting') {
    s.elapsed = state.elapsed + dt;
    /* Settle FIRST, then time out. The other way round, a number that arrived
       on the last frame before the slack ran out was thrown away here while
       the other machine settled on mine -- one side paid, one side voided. */
    const settled = settleOrWait(s, ev);
    if (settled.phase === 'over') return { state: settled, events: ev };
    if (s.elapsed > s.params.cap + WAIT_SLACK) {
      return { state: end(s, 'void', 'NO RESULT'), events: [{ k: 'end', result: 'void', reason: 'NO RESULT' }] };
    }
    return { state: settled, events: ev };
  }

  return { state: s, events: ev };
}

/** Where a 'high is better' challenge lands when the clock runs out. */
function capMetric(s) {
  if (s.kind === 'pursuit') return s.hold;
  if (s.kind === 'survivor') return s.params.cap;
  return null;
}

/** I have a number; do I have theirs too? */
function settleOrWait(s, ev) {
  const out = { ...s, phase: 'waiting' };
  const theirs = s.peer && s.peer.done ? (s.peer.metric ?? null) : undefined;
  if (theirs === undefined) return out;
  const result = compare(s.params.goal, out.metric, theirs);
  const done = end(out, result, result === 'draw' ? 'DEAD HEAT' : '');
  ev.push({ k: 'end', result, reason: done.reason });
  return done;
}

/** The per-challenge half: my own progress, measured about myself. */
function step(s, input, ev) {
  const me = { x: input.x ?? 0, z: input.z ?? 0 };
  const p = s.params;

  if (s.kind === 'race') {
    const gate = p.gates[s.i];
    if (gate && dist(me, gate) <= GATE_R) {
      const i = s.i + 1;
      const splits = [...s.splits, +s.elapsed.toFixed(2)];
      ev.push({ k: 'checkpoint', i, of: p.gates.length, split: s.elapsed });
      if (i >= p.gates.length) {
        ev.push({ k: 'done', metric: s.elapsed, reason: 'FINISH' });
        return { ...s, i, splits, metric: s.elapsed, phase: 'waiting' };
      }
      return { ...s, i, splits };
    }
    return s;
  }

  if (s.kind === 'delivery') {
    if (s.i === 0) {
      if (dist(me, p.pickup) <= GATE_R) {
        ev.push({ k: 'checkpoint', i: 1, of: 2, split: s.elapsed });
        return { ...s, i: 1, splits: [+s.elapsed.toFixed(2)] };
      }
      return s;
    }
    // the drop wants a stop, or a delivery is just a two-gate race
    if (dist(me, p.drop) <= GATE_R && (input.speed ?? 0) < 4) {
      ev.push({ k: 'done', metric: s.elapsed, reason: 'DELIVERED' });
      return { ...s, i: 2, splits: [...s.splits, +s.elapsed.toFixed(2)], metric: s.elapsed, phase: 'waiting' };
    }
    return s;
  }

  if (s.kind === 'pursuit') {
    const leg = s.i;
    const legEnd = (leg + 1) * p.legSecs;
    let hold = s.hold;
    if (roleOn(s, leg) === 'chaser') {
      const d = input.peerDist;
      if (d != null && d <= p.maxDist) hold += input.dt || 0;
    }
    if (s.elapsed >= legEnd) {
      if (leg === 0) {
        ev.push({ k: 'leg', n: 1, role: roleOn(s, 1), hold });
        return { ...s, i: 1, hold };
      }
      ev.push({ k: 'done', metric: hold, reason: 'LEGS DONE' });
      return { ...s, hold, metric: hold, phase: 'waiting' };
    }
    return { ...s, hold };
  }

  if (s.kind === 'survivor') {
    if (input.busted || input.wasted) {
      ev.push({ k: 'done', metric: s.elapsed, reason: input.wasted ? 'WASTED' : 'BUSTED' });
      return { ...s, metric: s.elapsed, phase: 'waiting' };
    }
    return s;
  }
  return s;
}

/**
 * What to put on the wire, at REPORT_HZ. The only thing said about me is my own
 * number; `done` flips once, and the packet keeps going out for LINGER seconds
 * after the end so a dropped final packet does not void a finished match.
 */
export function report(state) {
  if (state.phase === 'offered') return null;
  /* A VOID says nothing. The linger exists so a finished match's number reaches
     the other side; a void has no number, and `done: 1, metric: null` from a
     side that has already walked away reads as a DNF -- the peer would beat it
     and pay itself while I paid nobody. Silence makes them void too. */
  if (state.phase === 'over' && (state.t > LINGER || state.result === 'void')) return null;
  return {
    k: 'p',
    round: state.round,
    kind: state.kind,
    done: state.phase === 'waiting' || state.phase === 'over' ? 1 : 0,
    metric: state.metric,
    i: state.i,
  };
}

/** Fold a received progress packet in. Anything from another round is not ours. */
export function receive(state, msg) {
  if (!msg || msg.k !== 'p' || msg.round !== state.round || msg.kind !== state.kind) return state;
  return {
    ...state,
    peerAge: 0,
    peer: { done: !!msg.done, metric: typeof msg.metric === 'number' ? msg.metric : null, i: msg.i | 0 },
  };
}

/** One line for the HUD. */
export function line(state) {
  const s = state;
  if (s.phase === 'offered') return `${s.kind.toUpperCase()} · $${s.wager} · WAITING FOR ANSWER`;
  if (s.phase === 'countdown') return `${s.kind.toUpperCase()} · ${Math.ceil(COUNTDOWN - s.t)}`;
  if (s.phase === 'over') return `${s.result.toUpperCase()}${s.reason ? ` · ${s.reason}` : ''} · ${s.delta >= 0 ? '+' : '-'}$${Math.abs(s.delta)}`;
  if (s.phase === 'waiting') return `${s.kind.toUpperCase()} · WAITING FOR THEM`;
  const left = Math.max(0, Math.round(s.params.cap - s.elapsed));
  if (s.kind === 'race') return `RACE · GATE ${s.i + 1}/${s.params.gates.length} · ${s.elapsed.toFixed(1)}s`;
  if (s.kind === 'delivery') return `DELIVERY · ${s.i === 0 ? 'PICK UP' : 'DROP'} · ${s.elapsed.toFixed(1)}s`;
  if (s.kind === 'pursuit') return `PURSUIT · LEG ${s.i + 1} · ${roleOn(s, s.i).toUpperCase()} · ${s.hold.toFixed(1)}s HELD`;
  return `SURVIVOR · ${s.params.stars}★ · ${left}s LEFT`;
}

export const TUNING = { COUNTDOWN, OFFER_TIMEOUT, PEER_TIMEOUT, STRAY_GRACE, GATE_R, WAIT_SLACK, LINGER };

/* ---------------------------------------------------------------------------
 * The glue. Still no three.js, no DOM: everything it drives is injected, so it
 * can be exercised from node with plain objects. It owns exactly three things
 * the pure half must not -- the wire, the cash, and the marker the player
 * follows -- and nothing else.
 * ------------------------------------------------------------------------- */

const LABEL = {
  race: 'VERSUS RACE', pursuit: 'PURSUIT', delivery: 'DELIVERY DUEL', survivor: 'SURVIVOR',
};

export class VersusRoom {
  /**
   * @param {object} d  { net, mission, hud, district, garage, jobs, setWanted }
   *   net      multiplayer.js -- needs .versus(msg), .others(), .seed, .selfId
   *   garage   addCash(n, why) / spendCash(n) -> boolean  (jobs is the fallback)
   *   setWanted(n)  survivor only: puts the same stars on both players at GO
   */
  constructor(d) {
    Object.assign(this, d);
    this.kind = 'race';                 // what G will offer
    this.wager = 500;
    this.match = null;
    this.incoming = false;              // they asked, I have not answered
    this.round = 0;
    this.edge = {};                     // one-shot inputs from received packets
    this.send = 0;
  }

  get live() { return !!this.match && this.match.phase !== 'over'; }

  /** The district may still be loading when the room is joined from the URL. */
  #plan() { return typeof this.district === 'function' ? this.district() : this.district; }

  #cash() { return this.#purse()?.cash ?? 0; }
  /** garage keeps the balance on jobs; alone, jobs IS the purse. */
  #purse() { const g = this.garage ?? this.jobs; return g?.jobs ?? g ?? null; }
  #pay(delta) {
    const g = this.garage ?? this.jobs;
    if (!g || !delta) return;
    if (delta > 0) { g.addCash ? g.addCash(delta, 'VERSUS') : (g.cash += delta, g.persist?.()); return; }
    /* A loser who spent the stake mid-match must still pay it. garage.spendCash
       deducts NOTHING when you are short and returns false -- taking that as
       "paid" would pay the winner out of thin air, minting the wager. Go into
       debt instead: destroying cash is the safe direction to fail, minting is not. */
    if (g.spendCash?.(-delta)) return;
    const purse = this.#purse();
    if (!purse) return;
    purse.cash = (purse.cash || 0) + delta;
    purse.persist?.();
    this.hud?.flash?.(`VERSUS · PAID $${-delta} · YOU ARE IN THE RED`);
  }

  /** Digit7: pick what G will offer. */
  cycle() {
    if (this.live) return;
    this.kind = KINDS[(KINDS.indexOf(this.kind) + 1) % KINDS.length];
    this.hud?.flash(`VERSUS · ${LABEL[this.kind]} · $${this.wager} · G TO OFFER`);
  }

  /** G: offer the selected challenge, accept the one on the table, or rematch. */
  offerOrAccept() {
    if (!this.net || !this.net.connected) { this.hud?.flash('VERSUS · NOBODY IN THE ROOM'); return; }
    if (this.live && this.match.phase !== 'offered') { this.hud?.flash('VERSUS · ALREADY ON'); return; }
    if (this.#cash() < this.wager) { this.hud?.flash(`VERSUS · $${this.wager} STAKE · NOT ENOUGH CASH`); return; }

    if (this.match?.phase === 'offered' && this.incoming) {
      this.incoming = false;
      this.net.versus({ k: 'accept', round: this.match.round });
      this.edge.accepted = true;
      return;
    }
    if (this.match?.phase === 'offered') { this.hud?.flash('VERSUS · WAITING FOR THEM'); return; }

    /* Rounds only ever go up, even when the last match has already been cleared
       off the HUD. Re-using a round number lets the LINGER packets of a dead
       match bind to the new one -- I would settle against a stale number while
       they waited for a real one, and the two machines would disagree. */
    const round = Math.max(this.round | 0, this.match ? this.match.round : -1) + 1;
    if (!this.#begin(this.kind, this.wager, round, true)) return;
    this.round = round;
    this.net.versus({ k: 'offer', kind: this.kind, wager: this.wager, round });
    this.hud?.flash(`OFFERED ${LABEL[this.kind]} · $${this.wager}`);
  }

  /** Digit9: decline what is on the table, or bail out of a live one (and pay). */
  bail() {
    if (!this.match || this.match.phase === 'over') return;   // nothing to bail out of; a stray packet only confuses the round
    if (this.incoming && this.match.phase === 'offered') {
      this.net?.versus({ k: 'decline', round: this.match.round });
      this.edge.declined = true;
      return;
    }
    this.net?.versus({ k: 'bail', round: this.match.round });
    this.edge.abort = true;
  }

  /** @returns true if a match was laid. Never throws at a caller: no plan, no match. */
  #begin(kind, wager, round, mine) {
    const plan = this.#plan();
    if (!plan?.graph) { this.hud?.flash('VERSUS · THE CITY IS STILL LOADING'); return false; }
    try {
      this.match = createMatch({ kind, roomSeed: this.net?.seed ?? 0, district: plan, wager, round, mine });
    } catch (e) {
      this.hud?.flash(`VERSUS · NO COURSE · ${e.message}`);
      this.match = null;
      return false;
    }
    this.edge = {};
    this.incoming = false;         // an offer I laid is not an offer on my table
    return true;
  }

  /** Everything that arrives on the room's 'v' action. */
  onPacket(msg, peerId) {
    if (!msg || typeof msg !== 'object') return;
    if (peerId) this.peerId = peerId;
    if (msg.k === 'offer') {
      if (this.live) { this.net?.versus({ k: 'decline', round: msg.round }); return; }
      if (!KINDS.includes(msg.kind)) return;
      const wager = Math.max(0, Math.min(25000, msg.wager | 0));
      const round = msg.round | 0;
      // a stale round must not resurrect: theirs only counts if it is ahead of mine
      if (this.match && round <= this.match.round) return;
      if (!this.#begin(msg.kind, wager, round, false)) { this.net?.versus({ k: 'decline', round }); return; }
      this.round = round;
      this.incoming = true;
      this.hud?.flash(`CHALLENGED · ${LABEL[msg.kind]} · $${wager} · G ACCEPTS, 9 DECLINES`);
      return;
    }
    if (!this.match || (msg.round | 0) !== this.match.round) return;
    if (msg.k === 'accept') this.edge.accepted = true;
    else if (msg.k === 'decline') this.edge.declined = true;
    else if (msg.k === 'bail') this.edge.aborted = true;
    else if (msg.k === 'p') this.match = receive(this.match, msg);
  }

  /** Per frame. `status` is { wanted, busted, wasted } from main. */
  update(car, dt, status = {}) {
    const m = this.match;
    if (!m) return;
    const peers = this.net?.others?.() ?? [];
    let peerDist = null;
    for (const p of peers) {
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      if (peerDist == null || d < peerDist) peerDist = d;
    }
    const r = tick(m, {
      dt, x: car.x, z: car.z, speed: Math.abs(car.fwdSpeed ?? car.speed ?? 0),
      wanted: status.wanted | 0, busted: !!status.busted, wasted: !!status.wasted,
      peerDist, ...this.edge,
    });
    this.edge = {};
    this.match = r.state;
    for (const e of r.events) this.#event(e);

    // the wire, at REPORT_HZ -- a few packets a second, never per frame
    this.send += dt;
    if (this.send >= 1 / REPORT_HZ) {
      this.send = 0;
      const p = report(this.match);
      if (p) this.net?.versus(p);
    }
    /* Its own HUD line, not the job line: jobs.js rewrites that one every
       frame, and sharing a slot made the two flicker against each other. */
    const text = this.match.phase === 'over' && this.match.t > LINGER ? null : line(this.match);
    if (this.hud?.setVersus) this.hud.setVersus(text); else this.hud?.setJob?.(text);
    if (this.match.phase === 'over' && this.match.t > LINGER) { this.match = null; this.incoming = false; }
  }

  #event(e) {
    const m = this.match, p = m.params;
    if (e.k === 'countdown') { this.hud?.flash(`${LABEL[m.kind]} · ${e.n}`); return; }
    if (e.k === 'go') {
      this.hud?.flash('GO');
      if (m.kind === 'race') this.#mark(p.gates, LABEL.race);
      if (m.kind === 'delivery') this.#mark([p.pickup], 'DELIVERY DUEL · PICK UP');
      if (m.kind === 'pursuit') this.#mark(p.route, `PURSUIT · ${roleOn(m, 0).toUpperCase()}`);
      if (m.kind === 'survivor') this.setWanted?.(p.stars);
      return;
    }
    if (e.k === 'checkpoint') {
      this.hud?.flash(`CP ${e.i}/${e.of} · ${e.split.toFixed(1)}s`);
      if (m.kind === 'race') this.#mark(p.gates.slice(m.i), LABEL.race);
      if (m.kind === 'delivery') this.#mark([p.drop], 'DELIVERY DUEL · DROP · STOP IN THE RING');
      return;
    }
    if (e.k === 'leg') {
      this.hud?.flash(`LEG 2 · YOU ${e.role.toUpperCase()} · ${e.hold.toFixed(0)}s HELD`);
      this.#mark(p.route, `PURSUIT · ${e.role.toUpperCase()}`);
      return;
    }
    if (e.k === 'quit') { this.hud?.flash('THEY BAILED · FINISH AND IT IS YOURS'); return; }
    if (e.k === 'done') { this.hud?.flash(`${e.reason} · ${e.metric == null ? 'DNF' : e.metric.toFixed(1)}`); return; }
    if (e.k === 'end') {
      this.mission?.stop?.('');
      this.#pay(m.delta);
      const title = e.result === 'win' ? 'YOU WIN' : e.result === 'loss' ? 'YOU LOSE' : 'NO BET';
      if (this.hud?.showVictoryBanner) this.hud.showVictoryBanner(title, `${LABEL[m.kind]}${e.reason ? ` · ${e.reason}` : ''}`, Math.abs(m.delta));
      else this.hud?.flash(`${title} · ${m.delta >= 0 ? '+' : '-'}$${Math.abs(m.delta)}`);
    }
  }

  #mark(points, label) {
    if (!points?.length) return;
    this.mission?.route?.(points, label);
  }
}
