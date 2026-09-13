/**
 * Wagers: two players, one challenge, money on it.
 *
 * PURE. No THREE, no DOM, no network, no timers, no localStorage. The caller
 * owns the socket, the clock and the cash; this file owns the agreement. Both
 * peers run this same reducer over the same packets, so both land in the same
 * place -- that is the whole point, because there is no server of ours and
 * there never will be.
 *
 * The life of a bet:
 *
 *   (nothing) --offer--> OFFER --accept--> LOCKED --progress--> RUNNING
 *                          |                       |                |
 *                          |                       |                +--all finished--> SETTLED
 *                          +--decline/expire/broke-+--peer goes quiet--> VOID (refund)
 *
 * MONEY NEVER MOVES IN HERE. Every reduction returns INTENTS -- a flat list of
 * {kind:'debit'|'credit', player, amount, reason}. The caller applies only the
 * intents whose `player` is itself and ignores the rest; both machines compute
 * the identical full list. The caller applies a debit UNCONDITIONALLY
 * (`garage.cash -= n`, not `spendCash`, which can refuse): a machine that skips
 * one because the wallet moved since the offer has a different ledger from its
 * peer, which is the same hole as minting. Stakes are
 * debited exactly once, at LOCK, and the pot is credited exactly once, at
 * SETTLE or at a refund. Across a whole cycle the debits and credits sum to
 * zero (test: 'no money is created or destroyed'), so a crash mid-race cannot
 * mint cash: the worst case is a stake sitting in escrow that the void path
 * refunds, and a reducer that has already settled ignores every later packet.
 *
 * WHAT AN ADVERSARIAL PEER CAN STILL DO. This is a friendly wager, not an
 * escrow contract. Each side reports its OWN progress, so a peer can simply
 * lie about its own times -- claim checkpoint 4 at 31.2 s while parked. It can
 * also overstate its bank balance at accept time (we only ever see the number
 * it sends), and it can walk out of the browser to force the void-and-refund
 * instead of paying a loss it can see coming. Nothing short of a trusted
 * authority fixes those, and we are not building one.
 *
 * WHAT IS MITIGATED. Reports are validated ABSOLUTELY, never against arrival
 * order: the checkpoint index must be a whole number inside the course, and
 * the claimed elapsed time must clear `minLeg` seconds per checkpoint (you
 * cannot teleport to the finish in 2 s). A report that fails is REJECTED, not
 * clamped -- clamping would invent a time neither player drove and could hand
 * a cheat the win, whereas ignoring it leaves their last honest progress
 * standing and the bet ends through the void path instead. Per player we keep the
 * highest index, and for the same index the LARGEST elapsed, so re-sending a
 * checkpoint can never improve your time and duplicate packets are harmless.
 * Every rule above is order-independent -- max is max whichever arrived first
 * -- which is what makes both machines agree, PROVIDED each player only ever
 * reports one time per checkpoint. See the heartbeat contract further down:
 * that proviso is the whole guarantee, and it is the caller's to keep.
 *
 * WHAT IS DELIBERATELY NOT. No signatures, no commit-reveal on the seed, no
 * cross-checking a peer's claimed position against the state packets it is
 * already sending at 15 Hz (that one is worth doing the day someone actually
 * cheats -- the data is right there in multiplayer.js).
 *
 * WHY A DROPOUT ONLY EVER REFUNDS. There is exactly ONE path that pays the
 * pot: every player has reported the final checkpoint, and the pot goes to the
 * lowest elapsed time. That verdict is a pure function of the finish-time
 * ledger, so it cannot depend on which packet landed first -- feed the same
 * reports in any of their orders and both machines settle identically (test:
 * 'every order of the same packets settles the same'). Every other ending --
 * declined, expired, broke, and the peer that stops sending -- is a VOID that
 * refunds both stakes.
 *
 * You therefore cannot WIN by your opponent quitting; you get your money back.
 * That is deliberate. The alternative, paying the survivor, duplicates the pot
 * the moment the network partitions instead of dying: each side sees the other
 * vanish, each side pays itself, and between them they have minted a stake out
 * of nothing. A refund is the only settlement two machines with no authority
 * between them can always agree on, and it can neither create nor destroy
 * money. The residual window is narrow and known: if one side's dropout timer
 * fires in the same breath as the other side's finish packet, one machine
 * refunds while the other pays. `quiet` is 45 s to keep that window somewhere
 * nobody is still racing.
 *
 * CLOCKS. Every `at` is the RECEIVING machine's own clock, stamped as the
 * packet lands -- never a timestamp off the wire, which would be wrong by
 * however far the two peers' clocks have drifted. That is why an offer carries
 * a `ttl` in milliseconds rather than an expiry instant.
 *
 * Only the void path reads a clock, and only through the caller's
 * `tick` event: an offer past `expiresAt`, `quiet` seconds with nothing heard
 * from the other side, or `maxRace` seconds since the stakes went in with
 * nobody finishing. Because that path is symmetric and idempotent, two machines
 * reaching it a second apart still agree. The paying path never looks at a
 * clock at all.
 *
 * TWO THINGS THE CALLER OWES THIS FILE, or the dropout timer is wrong:
 *
 *   1. `opts.self` -- our own peer id. Only the OTHER side's packets count as
 *      signs of life, because we replay our own through this reducer too.
 *   2. A HEARTBEAT every couple of seconds for as long as the bet is locked or
 *      running, whether or not we have reached a checkpoint yet and whether or
 *      not we have already finished. `{k:'progress', idx:0}` is fine: it is
 *      rejected as progress and still counts as a sign of life. Without it the
 *      45 s of quiet between the start line and the first checkpoint -- or
 *      between our finish and a slower opponent's -- reads as a dead peer.
 *
 * Repeat reports are free, see the max rule above -- but ONLY if they are the
 * SAME report. This is the one contract that keeps the two machines in step, so
 * it is worth spelling out: a player reports each checkpoint ONCE, with the
 * time it crossed it, and every later beat repeats that packet unchanged. Send
 * two different times for one checkpoint -- a heartbeat that re-stamps "time
 * now" every two seconds does exactly that -- and the max rule resolves them
 * differently on each machine depending on which arrived before the other
 * player's finish packet triggered the settle. Measured on a two-machine
 * simulation: verbatim repeats, 0 disagreements in 20,000 randomised races;
 * re-stamped repeats, 287, and each one pays BOTH players out of a pot that
 * only holds one stake each. No rule can fix it from in here -- there is no
 * order on two different numbers that both machines can agree is "the" one --
 * so the caller must not re-time a checkpoint it has already reported.
 *
 * WHAT IS STILL NOT HANDLED, and cannot be here: nothing persists a bet. Close
 * the tab mid-race and that machine's stake is simply gone from its own
 * localStorage wallet -- destroyed, not given to anyone. The other side times
 * out and gets its own stake back. Persisting the wager (and re-offering it on
 * load) is the fix the day anyone minds.
 */

export const DEFAULTS = {
  quiet: 45,          // s of local wall time with no packet FROM THE OTHER SIDE before the bet voids
  maxRace: 900,       // s: a bet nobody ever finishes still has to end, or the stakes never come home
  minLeg: 3,          // s: the fastest anyone can plausibly cover one checkpoint leg
  historyLimit: 12,
};

/** The menu a player picks from. `cps` is the final checkpoint index. */
export const CHALLENGES = [
  { id: 'sprint',  name: 'SPRINT',       cps: 3 },
  { id: 'circuit', name: 'CIRCUIT',      cps: 5 },
  { id: 'crosstown', name: 'CROSSTOWN',  cps: 8 },
];

const round2 = (n) => Math.round(n * 100) / 100;
const num = (n) => typeof n === 'number' && Number.isFinite(n);
const clone = (w) => ({ ...w, players: w.players.slice(), banks: { ...w.banks }, progress: { ...w.progress } });
const none = (w) => ({ w, intents: [] });

/* Only the OTHER side's packets are signs of life. The caller replays its OWN
   packets through this same reducer (that is how both machines stay in step),
   so counting them would keep the dropout timer fed by our own heartbeat and a
   peer that closed its browser would never time out at all -- the stakes would
   sit in escrow until the tab did. `opts.self` is who we are; without it every
   packet counts, which is the old, broken behaviour. */
const heard = (ev, o) => (num(ev.at) && ev.from !== o.self ? ev.at : 0);

/**
 * The one entry point. Feed it every packet, in whatever order it arrives.
 * `w` is the serialisable wager (null before an offer), `ev` the packet.
 *
 *   { k:'offer',    from, to, challenge, stake, seed, cps, bank, at, ttl }
 *   { k:'accept',   from, id, bank, at }
 *   { k:'decline',  from, id, at }
 *   { k:'progress', from, id, idx, e, at }  // e = the reporter's OWN elapsed seconds
 *   { k:'tick',     at }                    // local clock, for expiry and dropout only
 *
 * `to` is the one peer the offer is for; `id` is the wager it belongs to
 * (`w.id`, which both machines derive identically from the offer itself).
 * Everything but the offer and the tick is ignored unless the id matches.
 * `opts.self` is our own peer id -- see the heartbeat note in the header.
 *
 * Returns { w, intents }. Never mutates its arguments.
 */
export function reduce(w, ev, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!ev || typeof ev !== 'object' || typeof ev.k !== 'string') return none(w);
  if (w && (w.phase === 'settled' || w.phase === 'void')) return none(w);   // a settled bet is deaf
  /* WHICH bet is this packet about? A room holds as many people as the link is
     sent to, and two offers can be in the air at once. Without this line a
     stray accept meant for somebody else's offer locks -- and debits -- a bet
     its supposed opponent never joined, and the two machines then disagree
     about who is even racing, which is how a pot gets paid twice. */
  if (w && ev.k !== 'offer' && ev.k !== 'tick' && ev.id !== w.id) return none(w);
  switch (ev.k) {
    case 'offer': return offer(w, ev);
    case 'accept': return accept(w, ev, o);
    case 'decline': return decline(w, ev);
    case 'progress': return progress(w, ev, o);
    case 'tick': return tick(w, ev, o);
    default: return none(w);
  }
}

function offer(w, ev) {
  if (w) return none(w);                                   // one bet at a time
  if (typeof ev.from !== 'string' || !ev.from) return none(w);
  if (!num(ev.stake) || ev.stake <= 0) return none(w);
  if (!Number.isInteger(ev.cps) || ev.cps < 1) return none(w);
  // an offer names ONE opponent: an open "anyone?" offer two people accept at
  // once locks two different bets on three machines
  if (typeof ev.to !== 'string' || !ev.to || ev.to === ev.from) return none(w);
  return none({
    id: `${ev.from}:${ev.seed ?? 0}`,
    phase: 'offer',
    to: ev.to,
    challenge: typeof ev.challenge === 'string' ? ev.challenge : 'sprint',
    stake: Math.round(ev.stake),
    seed: ev.seed ?? 0,
    cps: ev.cps,
    proposer: ev.from,
    players: [ev.from],
    banks: { [ev.from]: num(ev.bank) ? ev.bank : 0 },
    progress: {},
    // an offer's life is a DURATION, not a wire timestamp -- see CLOCKS
    expiresAt: (num(ev.at) ? ev.at : 0) + (num(ev.ttl) ? ev.ttl : 30000),
    seenAt: num(ev.at) ? ev.at : 0,
    result: null,
  });
}

function accept(w, ev, o) {
  if (!w || w.phase !== 'offer') return none(w);
  if (typeof ev.from !== 'string' || ev.from !== w.to) return none(w);   // only the peer it was offered to
  if (num(ev.at) && ev.at > w.expiresAt) return ended(w, 'void', 'OFFER EXPIRED', []);
  const n = clone(w);
  n.players = [...w.players, ev.from].sort();
  n.banks[ev.from] = num(ev.bank) ? ev.bank : 0;
  n.seenAt = Math.max(n.seenAt, heard(ev, o));
  n.lockedAt = num(ev.at) ? ev.at : 0;
  const broke = n.players.filter((p) => (n.banks[p] ?? 0) < n.stake).sort();
  if (broke.length) return ended(n, 'void', `NOT ENOUGH CASH · ${broke.join(', ')}`, []);
  n.phase = 'locked';
  n.pot = n.stake * n.players.length;
  n.escrowed = true;                 // the one flag that says money actually left wallets
  // escrow: the stake leaves both wallets HERE, once, and comes back only as a
  // settle credit or a refund
  return { w: n, intents: n.players.map((p) => ({ kind: 'debit', player: p, amount: n.stake, reason: 'WAGER STAKE' })) };
}

function decline(w, ev) {
  if (!w || w.phase !== 'offer') return none(w);
  // either of the two named parties can kill it; a bystander in the room cannot
  if (ev.from !== w.to && ev.from !== w.proposer) return none(w);
  return ended(w, 'void', 'DECLINED', []);
}

function progress(w, ev, o) {
  if (!w || (w.phase !== 'locked' && w.phase !== 'running')) return none(w);
  if (!w.players.includes(ev.from)) return none(w);
  const n = clone(w);
  n.seenAt = Math.max(n.seenAt, heard(ev, o));
  if (plausible(ev, w, o)) {
    const e = round2(ev.e);
    const had = n.progress[ev.from];
    // highest checkpoint wins; the same checkpoint keeps the LARGEST time, so
    // re-reporting can never buy you a better one and order cannot matter
    if (!had || ev.idx > had.idx || (ev.idx === had.idx && e > had.e)) n.progress[ev.from] = { idx: ev.idx, e };
    n.phase = 'running';
  }
  return settleIfDone(n);
}

function plausible(ev, w, o) {
  if (!Number.isInteger(ev.idx) || ev.idx < 1 || ev.idx > w.cps) return false;
  if (!num(ev.e) || ev.e <= 0) return false;
  return ev.e >= ev.idx * o.minLeg;      // no teleporting to the finish
}

function tick(w, ev, o) {
  if (!w || !num(ev.at)) return none(w);
  if (w.phase === 'offer') return ev.at > w.expiresAt ? ended(w, 'void', 'OFFER EXPIRED', []) : none(w);
  if (ev.at - w.seenAt > o.quiet * 1000) return refund(w, 'PEER WENT QUIET · STAKES RETURNED');
  /* Nobody finishing is an ending too. Two players who both give up but leave
     the tab open heartbeat at each other forever, and the stakes stay in
     escrow -- money out of both wallets that no path ever puts back. */
  if (w.lockedAt > 0 && ev.at - w.lockedAt > o.maxRace * 1000) return refund(w, 'BET RAN OUT OF TIME · STAKES RETURNED');
  return none(w);
}

/* Can we call it? Only when EVERY player has crossed the final checkpoint --
   see the header: that is the one condition both machines are guaranteed to
   agree on, whatever order the reports arrived in. Lowest elapsed takes the
   pot; identical times (both are rounded to 1/100 s) split it. A player who
   never finishes ends the bet through the void path instead, not here. */
function settleIfDone(w) {
  const done = (p) => (w.progress[p]?.idx ?? 0) >= w.cps;
  if (!w.players.every(done)) return none(w);
  const best = Math.min(...w.players.map((p) => w.progress[p].e));
  const winners = w.players.filter((p) => w.progress[p].e === best).sort();
  const reason = winners.length > 1 ? 'DEAD HEAT · POT SPLIT' : 'WON ON TIME';
  return ended(w, 'settled', reason, payout(w, winners), winners);
}

/** Whole pounds only: the remainder goes to the lowest id, so both ends agree. */
function payout(w, winners) {
  const pot = w.stake * w.players.length;
  const share = Math.floor(pot / winners.length);
  const left = pot - share * winners.length;
  return winners.map((p, i) => ({
    kind: 'credit', player: p, amount: share + (i < left ? 1 : 0), reason: 'WAGER WON',
  }));
}

function refund(w, reason) {
  return ended(w, 'void', reason,
    w.players.map((p) => ({ kind: 'credit', player: p, amount: w.stake, reason: 'WAGER REFUND' })));
}

function ended(w, phase, reason, intents, winners = []) {
  const n = clone(w);
  n.phase = phase;
  n.pot = n.stake * n.players.length;
  n.result = {
    reason,
    winners,
    pot: phase === 'settled' ? n.pot : 0,
    paid: Object.fromEntries(intents.map((i) => [i.player, i.amount])),
    elapsed: Object.fromEntries(n.players.map((p) => [p, n.progress[p]?.e ?? null])),
  };
  return { w: n, intents };
}

/* ------------------------------------------------------------------ record */

/** Was money ever taken? (an offer that died before LOCK cost nobody anything) */
const staked = (w) => !!w.escrowed;

/** One line for the history book. Returns a NEW array; persisting it is yours. */
export function record(history, w, self, limit = DEFAULTS.historyLimit) {
  if (!w || (w.phase !== 'settled' && w.phase !== 'void')) return history ?? [];
  const back = w.result?.paid?.[self] ?? 0;
  const put = staked(w) ? w.stake : 0;
  const outcome = w.phase === 'void' ? 'void'
    : w.result.winners.length > 1 ? 'split'
      : w.result.winners[0] === self ? 'won' : 'lost';
  const entry = {
    challenge: w.challenge,
    stake: w.stake,
    opponent: w.players.filter((p) => p !== self).join(', ') || (self === w.proposer ? w.to : w.proposer),
    outcome,
    net: back - put,
    reason: w.result.reason,
  };
  return [entry, ...(history ?? [])].slice(0, limit);
}

/** Your record, for the phone / pause screen. */
export function summary(history = []) {
  const s = { played: history.length, wins: 0, losses: 0, splits: 0, voids: 0, net: 0 };
  for (const h of history) {
    s.net += h.net || 0;
    if (h.outcome === 'won') s.wins++;
    else if (h.outcome === 'lost') s.losses++;
    else if (h.outcome === 'split') s.splits++;
    else s.voids++;
  }
  return s;
}

/** One HUD line describing where the bet is. */
export function line(w, self) {
  if (!w) return null;
  // while an offer is open the other side is not a player yet, but it is named
  const other = w.players.filter((p) => p !== self)[0] ?? (self === w.proposer ? w.to : w.proposer);
  const tag = other ? String(other).slice(0, 4).toUpperCase() : 'PEER';
  const name = (CHALLENGES.find((c) => c.id === w.challenge)?.name) ?? String(w.challenge).toUpperCase();
  if (w.phase === 'offer') {
    return w.proposer === self
      ? `BET OFFERED · ${name} · $${w.stake} · WAITING ON [${tag}]`
      : `[${tag}] BETS $${w.stake} ON A ${name} · . TAKE IT · , WALK AWAY`;
  }
  if (w.phase === 'locked') return `BET ON · ${name} · $${w.stake} EACH · GO`;
  if (w.phase === 'running') {
    const me = w.progress[self]?.idx ?? 0, them = w.progress[other]?.idx ?? 0;
    return `BET · ${name} · YOU ${me}/${w.cps} · [${tag}] ${them}/${w.cps} · POT $${w.stake * w.players.length}`;
  }
  const back = w.result?.paid?.[self] ?? 0;
  const put = staked(w) ? w.stake : 0;
  const net = back - put;
  return `${w.result?.reason ?? 'BET OVER'} · ${net >= 0 ? '+' : '-'}$${Math.abs(net)}`;
}
