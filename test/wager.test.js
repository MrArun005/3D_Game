import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, record, summary, line, DEFAULTS, CHALLENGES } from '../src/game/wager.js';

/* The money and the agreement (src/game/wager.js). Everything here is pure:
   feed packets in, read the wager and the intents out. The tests that matter
   most are the two that keep two machines honest with each other -- 'every
   order of the same packets settles the same' and 'no money is created or
   destroyed'. */

const T0 = 1_000_000;
const ID = 'alice:7';                       // how wager.js names this bet, on both machines
const OFFER = { k: 'offer', from: 'alice', to: 'bob', challenge: 'sprint', stake: 500, seed: 7, cps: 3, bank: 1200, at: T0, ttl: 30000 };
const ACCEPT = { k: 'accept', from: 'bob', id: ID, bank: 900, at: T0 + 4000 };

/** Play a packet list through the reducer the way a peer would. */
function run(events, opts, start = null) {
  let w = start; const intents = [];
  for (const ev of events) { const r = reduce(w, ev, opts); w = r.w; intents.push(...r.intents); }
  return { w, intents };
}

const cp = (from, idx, e, at = T0 + 5000 + e * 1000) => ({ k: 'progress', from, id: ID, idx, e, at });

/* alice drives it in 30.0, bob in 33.0 */
const RACE = [cp('alice', 1, 10), cp('bob', 1, 11), cp('alice', 2, 20), cp('bob', 2, 22), cp('alice', 3, 30), cp('bob', 3, 33)];

const net = (intents, who) => intents.reduce((s, i) => i.player === who ? s + (i.kind === 'credit' ? i.amount : -i.amount) : s, 0);

test('happy path: offer, accept, race, the faster one takes the pot', () => {
  const { w, intents } = run([OFFER, ACCEPT, ...RACE]);
  assert.equal(w.phase, 'settled');
  assert.deepEqual(w.result.winners, ['alice']);
  assert.equal(w.result.pot, 1000);
  assert.equal(w.result.reason, 'WON ON TIME');
  assert.equal(net(intents, 'alice'), 500, 'alice staked 500 and took 1000');
  assert.equal(net(intents, 'bob'), -500);
});

test('happy path the other way round: the proposer can lose its own bet', () => {
  const slower = RACE.map((e) => e.from === 'alice' ? { ...e, e: e.e + 10 } : e);
  const { w, intents } = run([OFFER, ACCEPT, ...slower]);
  assert.deepEqual(w.result.winners, ['bob']);
  assert.equal(net(intents, 'bob'), 500);
  assert.equal(net(intents, 'alice'), -500);
});

test('every order of the same packets settles the same (both machines agree)', () => {
  const ref = run([OFFER, ACCEPT, ...RACE]);
  let orders = 0;
  for (const perm of permutations(RACE)) {
    orders++;
    const got = run([OFFER, ACCEPT, ...perm]);
    assert.deepEqual(got.w.result, ref.w.result, `order ${perm.map((e) => e.from[0] + e.idx).join(' ')} disagreed`);
    assert.deepEqual(got.w.progress, ref.w.progress);
    assert.deepEqual(sorted(got.intents), sorted(ref.intents));
  }
  assert.equal(orders, 720, 'all six reports permuted');
});

test('a dead heat splits the pot to the penny, by a stable key not arrival order', () => {
  const tied = [cp('alice', 3, 30), cp('bob', 3, 30)];
  const a = run([OFFER, ACCEPT, ...tied]);
  const b = run([OFFER, ACCEPT, ...tied.slice().reverse()]);
  assert.equal(a.w.result.reason, 'DEAD HEAT · POT SPLIT');
  assert.deepEqual(a.w.result.winners, ['alice', 'bob']);
  assert.deepEqual(sorted(a.intents), sorted(b.intents));
  assert.equal(net(a.intents, 'alice'), 0);
  assert.equal(net(a.intents, 'bob'), 0);

  // an odd pot still hands out every penny, deterministically to the lowest id
  const odd = run([{ ...OFFER, stake: 501 }, ACCEPT, ...tied]);
  assert.equal(odd.intents.filter((i) => i.kind === 'credit').reduce((s, i) => s + i.amount, 0), 1002);
});

test('neither side can stake cash it has not got', () => {
  const poor = run([OFFER, { ...ACCEPT, bank: 100 }]);
  assert.equal(poor.w.phase, 'void');
  assert.match(poor.w.result.reason, /NOT ENOUGH CASH · bob/);
  assert.deepEqual(poor.intents, [], 'a void offer debits nobody');

  const brokeProposer = run([{ ...OFFER, bank: 10 }, ACCEPT]);
  assert.equal(brokeProposer.w.phase, 'void');
  assert.match(brokeProposer.w.result.reason, /alice/);
  assert.deepEqual(brokeProposer.intents, []);
});

test('an offer expires, and a late acceptance is not a bet', () => {
  const late = run([OFFER, { k: 'tick', at: T0 + 31000 }]);
  assert.equal(late.w.phase, 'void');
  assert.equal(late.w.result.reason, 'OFFER EXPIRED');
  assert.deepEqual(late.intents, []);

  const lateYes = run([OFFER, { ...ACCEPT, at: T0 + 31000 }]);
  assert.equal(lateYes.w.phase, 'void');
  assert.deepEqual(lateYes.intents, []);

  const declined = run([OFFER, { k: 'decline', from: 'bob', id: ID, at: T0 + 1000 }]);
  assert.equal(declined.w.result.reason, 'DECLINED');
  assert.deepEqual(declined.intents, []);
});

test('a peer that vanishes mid-race ends the bet and both stakes come back', () => {
  const half = [OFFER, ACCEPT, cp('alice', 1, 10), cp('bob', 1, 11), cp('alice', 2, 20)];
  const live = run([...half, { k: 'tick', at: T0 + 25000 + DEFAULTS.quiet * 1000 - 1 }]);
  assert.equal(live.w.phase, 'running', 'still inside the quiet window');

  const dead = run([...half, { k: 'tick', at: T0 + 25000 + DEFAULTS.quiet * 1000 + 1 }]);
  assert.equal(dead.w.phase, 'void');
  assert.match(dead.w.result.reason, /QUIET/);
  assert.equal(net(dead.intents, 'alice'), 0, 'refunded, not fined');
  assert.equal(net(dead.intents, 'bob'), 0);
});

test('a settled bet is deaf: late packets cannot pay twice', () => {
  const done = run([OFFER, ACCEPT, ...RACE]);
  const after = run([
    cp('bob', 3, 12, T0 + 90000),                       // "actually I won"
    { k: 'tick', at: T0 + 900000 },                     // "and everyone left"
    { k: 'progress', from: 'alice', id: ID, idx: 3, e: 1, at: T0 + 91000 },
  ], undefined, done.w);
  assert.deepEqual(after.intents, [], 'no second payout, no refund on top of a payout');
  assert.deepEqual(after.w.result, done.w.result);
});

test('an impossible progress jump is rejected, not clamped, and cannot buy a better time', () => {
  const cheat = run([OFFER, ACCEPT,
    cp('bob', 3, 2),                                    // finished a 3-leg sprint in 2 s
    cp('alice', 3, 30),
    cp('bob', 4, 40),                                   // a checkpoint that is not on the course
    cp('bob', 3, 33),                                   // his real finish
    cp('bob', 3, 12),                                   // and a retry at a better time
  ]);
  assert.deepEqual(cheat.w.progress.bob, { idx: 3, e: 33 }, 'the honest report stands, nothing invented');
  assert.deepEqual(cheat.w.result.winners, ['alice']);

  // a rejected report does not even start the race, so the bet stays where it was
  const only = run([OFFER, ACCEPT, cp('bob', 9, 99)]);
  assert.equal(only.w.phase, 'locked');
  assert.deepEqual(only.w.progress, {});

  // and nobody can report on somebody else's behalf
  const spoof = run([OFFER, ACCEPT, { k: 'progress', from: 'mallory', id: ID, idx: 3, e: 9, at: T0 }]);
  assert.deepEqual(spoof.w.progress, {});
});

test('no money is created or destroyed, on any ending', () => {
  const endings = [
    [OFFER, ACCEPT, ...RACE],                                                   // paid out
    [OFFER, ACCEPT, ...RACE.slice(0, 3), { k: 'tick', at: T0 + 200000 }],       // dropout refund
    [OFFER, ACCEPT, cp('alice', 3, 30), cp('bob', 3, 30)],                      // split
    [OFFER, { ...ACCEPT, bank: 1 }],                                            // never locked
    [OFFER, { k: 'decline', from: 'bob', id: ID, at: T0 }],
  ];
  for (const evs of endings) {
    const { w, intents } = run(evs);
    const sum = intents.reduce((s, i) => s + (i.kind === 'credit' ? i.amount : -i.amount), 0);
    assert.equal(sum, 0, `${w.result.reason} moved ${sum} into existence`);
    assert.ok(['settled', 'void'].includes(w.phase));
    // and every player is debited at most once
    for (const p of w.players) {
      assert.ok(intents.filter((i) => i.player === p && i.kind === 'debit').length <= 1);
    }
  }
});

test('the history book keeps the last N and adds up', () => {
  const won = run([OFFER, ACCEPT, ...RACE]).w;
  const lost = run([OFFER, ACCEPT, ...RACE.map((e) => e.from === 'alice' ? { ...e, e: e.e + 10 } : e)]).w;
  const voided = run([OFFER, ACCEPT, ...RACE.slice(0, 2), { k: 'tick', at: T0 + 200000 }]).w;

  let h = [];
  for (const w of [won, lost, voided]) h = record(h, w, 'alice');
  assert.deepEqual(h.map((e) => e.outcome), ['void', 'lost', 'won'], 'newest first');
  assert.deepEqual(h.map((e) => e.net), [0, -500, 500]);
  assert.equal(h[0].opponent, 'bob');
  assert.deepEqual(summary(h), { played: 3, wins: 1, losses: 1, splits: 0, voids: 1, net: 0 });

  let big = [];
  for (let i = 0; i < 40; i++) big = record(big, won, 'alice', 5);
  assert.equal(big.length, 5);
  assert.deepEqual(record([], run([OFFER]).w, 'alice'), [], 'a live bet is not history yet');
});

test('the HUD line says whose move it is', () => {
  const offered = run([OFFER]).w;
  assert.match(line(offered, 'alice'), /WAITING ON \[BOB\]/, 'an offer names the peer it was sent to');
  assert.match(line(offered, 'bob'), /BETS \$500 ON A SPRINT · \. TAKE IT/, 'and the keys it says are the keys main.js binds');
  const mid = run([OFFER, ACCEPT, cp('alice', 1, 10)]).w;
  assert.match(line(mid, 'alice'), /YOU 1\/3 · \[BOB\] 0\/3 · POT \$1000/);
  assert.match(line(run([OFFER, ACCEPT, ...RACE]).w, 'bob'), /-\$500/);
  assert.equal(line(null, 'alice'), null);
  assert.ok(CHALLENGES.every((c) => c.cps >= 1 && c.id && c.name));
});

test('junk packets change nothing', () => {
  const base = run([OFFER, ACCEPT]).w;
  for (const junk of [null, 'nonsense', {}, { k: 'shrug' }, { k: 'offer', from: 'mallory', to: 'bob', stake: -5, cps: 3 }, { k: 'progress' }]) {
    const r = reduce(base, junk);
    assert.equal(r.w, base);
    assert.deepEqual(r.intents, []);
  }
  assert.equal(reduce(null, { k: 'offer', from: 'a', to: 'b', stake: 0, cps: 3 }).w, null, 'a bet for nothing is not a bet');
  assert.equal(reduce(null, { k: 'progress', from: 'a', id: ID, idx: 1, e: 9 }).w, null);
});

/* ---- The two tests below are the review's, and they are the ones that caught
   real money bugs: the dropout timer used to be fed by our OWN heartbeat (so a
   peer that closed its browser was never spotted and the stakes never came
   home), and a bet nobody finished never ended at all. ---- */

/** One machine: it hears every broadcast packet, stamps its own clock, and
    applies only the intents addressed to it -- exactly what main.js does. */
function machine(self, opts = {}) {
  let w = null; let ledger = 0;
  return {
    get w() { return w; },
    get ledger() { return ledger; },
    feed(ev) {
      const r = reduce(w, ev, { self, ...opts });
      w = r.w;
      for (const i of r.intents) {
        if (i.player !== self) continue;
        ledger += i.kind === 'credit' ? i.amount : -i.amount;
      }
      return r.intents;
    },
  };
}

test('our own heartbeat does not hide a dead peer', () => {
  /* alice keeps reporting (the caller replays its own packets through the
     reducer), bob's browser is gone. Counting alice's own packets as signs of
     life left the bet running for ever with both stakes in escrow. */
  const a = machine('alice');
  a.feed(OFFER); a.feed(ACCEPT);
  for (let t = 2000; t <= 44000; t += 2000) {
    a.feed({ k: 'progress', from: 'alice', id: ID, idx: 0, e: 0, at: T0 + 4000 + t });  // keep-alive, not progress
    a.feed({ k: 'tick', at: T0 + 4000 + t });
  }
  assert.equal(a.w.phase, 'locked', 'still inside the quiet window');
  a.feed({ k: 'tick', at: T0 + 4000 + DEFAULTS.quiet * 1000 + 1 });
  assert.equal(a.w.phase, 'void');
  assert.match(a.w.result.reason, /QUIET/);
  assert.equal(a.ledger, 0, 'staked then refunded');

  // and a peer that IS alive keeps the bet alive, however quiet we go ourselves
  const b = machine('alice');
  b.feed(OFFER); b.feed(ACCEPT);
  for (let t = 2000; t <= 120000; t += 2000) {
    b.feed({ k: 'progress', from: 'bob', id: ID, idx: 0, e: 0, at: T0 + 4000 + t });
    b.feed({ k: 'tick', at: T0 + 4000 + t });
  }
  assert.equal(b.w.phase, 'locked', 'the other side is talking, so the bet stands');
});

test('a bet nobody ever finishes still ends, and pays the stakes back', () => {
  const a = machine('alice');
  a.feed(OFFER); a.feed(ACCEPT);
  for (let t = 2000; t <= DEFAULTS.maxRace * 1000; t += 2000) {
    a.feed({ k: 'progress', from: 'bob', id: ID, idx: 1, e: 10, at: T0 + 4000 + t });   // both still out there
    a.feed({ k: 'progress', from: 'alice', id: ID, idx: 1, e: 10, at: T0 + 4000 + t });
    a.feed({ k: 'tick', at: T0 + 4000 + t });
  }
  assert.equal(a.w.phase, 'running', 'right up to the deadline it is still a bet');
  a.feed({ k: 'tick', at: T0 + 4000 + DEFAULTS.maxRace * 1000 + 1 });
  assert.equal(a.w.phase, 'void');
  assert.match(a.w.result.reason, /RAN OUT OF TIME/);
  assert.equal(a.ledger, 0, 'escrow always comes home');
});

test('only the named opponent can accept, and only the offer it was sent', () => {
  const gate = run([OFFER, { k: 'accept', from: 'carol', id: ID, bank: 9000, at: T0 + 1000 }]);
  assert.equal(gate.w.phase, 'offer', 'a third player in the room cannot jump into the bet');
  assert.deepEqual(gate.intents, []);

  // carol has her own offer out to bob; bob accepting ALICE must not lock it
  const carols = run([{ ...OFFER, from: 'carol', seed: 3, to: 'bob' }, ACCEPT]);
  assert.equal(carols.w.phase, 'offer');
  assert.deepEqual(carols.intents, [], 'nobody is debited for somebody else handshake');

  // ... and neither may a stray progress or decline for another bet
  const stray = run([OFFER, ACCEPT, { ...cp('bob', 3, 33), id: 'someone:1' }, { k: 'decline', from: 'bob', id: 'someone:1', at: T0 }]);
  assert.deepEqual(stray.w.progress, {});
  assert.equal(stray.w.phase, 'locked');
});

test('two machines, one packet log, same verdict and no money invented', () => {
  /* The packets both sides broadcast, and the ORDER each machine happens to
     see them in. Local ticks are interleaved differently on purpose. */
  const log = [OFFER, ACCEPT, ...RACE];
  const a = machine('alice'), b = machine('bob');
  for (const ev of log) { a.feed(ev); a.feed({ k: 'tick', at: ev.at + 30 }); }
  for (const ev of [...log.slice(0, 2), ...RACE.slice().reverse()]) { b.feed(ev); }
  b.feed({ k: 'tick', at: T0 + 60000 });

  assert.deepEqual(a.w.result, b.w.result, 'the two machines disagreed about the bet');
  assert.equal(a.w.phase, 'settled');
  assert.equal(a.ledger, 500, 'alice won the pot');
  assert.equal(b.ledger, -500, 'bob paid for it');
  assert.equal(a.ledger + b.ledger, 0, 'and the city is no richer');
});

test('20,000 randomised races, two machines, different arrival orders, one verdict', () => {
  /* The guarantee the whole file exists for, checked the only way that means
     anything: build a race, hand the SAME packets to two machines in two
     different orders, and demand the same answer and a zero-sum pair of
     wallets. Heartbeats are in here too -- repeated VERBATIM, which is the
     contract main.js has to keep (see the header: a beat that re-stamps the
     time makes the two machines settle on different numbers, and this test
     fails ~1.4% of the time if anyone reintroduces that). */
  let st = 7; const rnd = () => (st = (st * 1664525 + 1013904223) >>> 0) / 4294967296;
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let races = 0;
  for (let t = 0; t < 20000; t++) {
    const evs = [];
    for (const p of ['alice', 'bob']) {
      let e = 0;
      for (let idx = 1; idx <= 3; idx++) {
        e += 4 + rnd() * 20;
        const beats = 1 + ((rnd() * 4) | 0);
        for (let b = 0; b < beats; b++) evs.push(cp(p, idx, +e.toFixed(2), T0 + 5000 + e * 1000 + b));
      }
    }
    const a = machine('alice'), b = machine('bob');
    for (const ev of [OFFER, ACCEPT]) a.feed(ev);
    for (const ev of shuffle(evs).concat({ k: 'tick', at: T0 + 1e6 })) a.feed(ev);
    for (const ev of [OFFER, ACCEPT]) b.feed(ev);
    for (const ev of shuffle(evs).concat({ k: 'tick', at: T0 + 1e6 })) b.feed(ev);
    assert.deepEqual(a.w.result, b.w.result, 'the two machines settled differently');
    assert.equal(a.ledger + b.ledger, 0, 'money was invented');
    assert.ok(Math.abs(a.ledger) === 500 || a.ledger === 0);
    races++;
  }
  assert.equal(races, 20000);
});

function sorted(intents) {
  return intents.slice().sort((a, b) => (a.player + a.kind).localeCompare(b.player + b.kind));
}

function* permutations(list) {
  if (list.length <= 1) { yield list.slice(); return; }
  for (let i = 0; i < list.length; i++) {
    const rest = list.slice(0, i).concat(list.slice(i + 1));
    for (const p of permutations(rest)) yield [list[i], ...p];
  }
}
