import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District } from '../src/world/district.js';
import {
  KINDS, TUNING, hashSeed, courseSeed, generate, createMatch, tick, report, receive, compare, roleOn, VersusRoom,
} from '../src/game/versus.js';

const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const city = new District(data);

const ROOM = 'kestrel';
const OTHER = 'dogwood';

/** Every point a generated challenge asks a player to drive to. */
function points(p) {
  return [...(p.gates ?? []), ...(p.route ?? []), ...(p.pickup ? [p.pickup, p.drop] : [])];
}

/**
 * Advance a match by `secs` in dt steps, collecting events. Input can be a
 * function of (state, elapsed). The peer is kept alive with the 2 Hz progress
 * packet it would really be sending, unless `silent` -- otherwise every test
 * longer than PEER_TIMEOUT would void.
 */
function run(state, secs, input = {}, dt = 0.25, silent = false) {
  const events = [];
  for (let t = 0; t < secs; t += dt) {
    if (!silent) state = receive(state, { k: 'p', round: state.round, kind: state.kind, done: 0, metric: null, i: 0 });
    const inp = typeof input === 'function' ? input(state, t) : input;
    const r = tick(state, { dt, ...inp });
    state = r.state;
    events.push(...r.events);
    if (state.phase === 'over') break;
  }
  return { state, events };
}

/** Get a match past the countdown with a live peer. */
function started(kind, opts = {}) {
  let s = createMatch({ kind, roomSeed: hashSeed(ROOM), district: city, wager: 500, ...opts });
  s = tick(s, { dt: 0.1, accepted: true }).state;
  return run(s, TUNING.COUNTDOWN + 0.5, { x: 2350, z: 1350 }).state;
}

test('a course is the room seed, not a packet: same room and round, same course', () => {
  for (const kind of KINDS) {
    const a = generate(kind, courseSeed(hashSeed(ROOM), kind, 0), city);
    const b = generate(kind, courseSeed(hashSeed(ROOM), kind, 0), city);
    assert.deepEqual(a, b, `${kind} is not reproducible from the room seed`);
  }
});

test('a different room, a different kind and a rematch are all different courses', () => {
  const mine = generate('race', courseSeed(hashSeed(ROOM), 'race', 0), city);
  const theirs = generate('race', courseSeed(hashSeed(OTHER), 'race', 0), city);
  const rematch = generate('race', courseSeed(hashSeed(ROOM), 'race', 1), city);
  assert.notDeepEqual(mine.gates, theirs.gates, 'two rooms share a course');
  assert.notDeepEqual(mine.gates, rematch.gates, 'a rematch replays the same course');
  const delivery = generate('delivery', courseSeed(hashSeed(ROOM), 'delivery', 0), city);
  assert.notDeepEqual(delivery.pickup, mine.gates[0]);
});

test('every checkpoint is on tarmac, out of the water and inside the plan', () => {
  let checked = 0;
  for (const room of [ROOM, OTHER, 'a', 'zz9', 'halstead']) {
    for (const kind of KINDS) {
      const p = generate(kind, courseSeed(hashSeed(room), kind, 0), city);
      for (const g of points(p)) {
        checked++;
        assert.ok(city.tarmacDepth(g.x, g.z) < 0, `${kind} gate ${g.x},${g.z} is off the tarmac`);
        assert.equal(city.inWater(g.x, g.z), false, `${kind} gate ${g.x},${g.z} is in the water`);
        assert.ok(g.x >= 0 && g.z >= 0 && g.x <= city.bounds.w && g.z <= city.bounds.h, 'gate outside the plan');
      }
    }
  }
  assert.ok(checked > 60, `only sampled ${checked} gates`);
});

test('no checkpoint stands inside a building footprint', () => {
  const byBlock = new Map();
  for (const b of data.blocks) byBlock.set(b.id, b);
  const boxes = data.buildings.map((bu) => {
    const blk = byBlock.get(bu.blockId);
    const c = Math.cos(blk.angle), s = Math.sin(blk.angle);
    return { x: blk.x + bu.x * c - bu.y * s, z: blk.y + bu.x * s + bu.y * c, r: Math.hypot(bu.w, bu.d) / 2 };
  });
  for (const room of [ROOM, OTHER, 'hbay']) {
    for (const kind of KINDS) {
      for (const g of points(generate(kind, courseSeed(hashSeed(room), kind, 0), city))) {
        for (const b of boxes) {
          // the bounding circle is generous on purpose: a gate that even grazes
          // one is a gate you cannot drive through
          assert.ok(Math.hypot(b.x - g.x, b.z - g.z) > b.r,
            `${kind} gate ${g.x},${g.z} is inside a building`);
        }
      }
    }
  }
});

test('the legs of a course are drivable distances, not teleports', () => {
  const race = generate('race', courseSeed(hashSeed(ROOM), 'race', 0), city);
  assert.equal(race.gates.length, 6);
  for (let i = 1; i < race.gates.length; i++) {
    const d = Math.hypot(race.gates[i].x - race.gates[i - 1].x, race.gates[i].z - race.gates[i - 1].z);
    assert.ok(d >= 220 && d <= 460, `leg ${i} is ${d.toFixed(0)} m`);
  }
  const del = generate('delivery', courseSeed(hashSeed(ROOM), 'delivery', 0), city);
  const run = Math.hypot(del.drop.x - del.pickup.x, del.drop.z - del.pickup.z);
  assert.ok(run >= 600 && run <= 1150, `delivery run ${run.toFixed(0)} m`);
  assert.ok(race.par > 60 && race.cap > race.par, 'par and cap are sane');
});

test('an offer nobody answers times out as a void, and costs nobody anything', () => {
  const s = createMatch({ kind: 'race', roomSeed: hashSeed(ROOM), district: city, wager: 750 });
  const mid = run(s, TUNING.OFFER_TIMEOUT - 1).state;
  assert.equal(mid.phase, 'offered');
  const out = run(mid, 3).state;
  assert.equal(out.phase, 'over');
  assert.equal(out.result, 'void');
  assert.equal(out.delta, 0);
});

test('declining ends it; bailing before the green light is a void, after it is a DNF', () => {
  const offer = () => createMatch({ kind: 'race', roomSeed: hashSeed(ROOM), district: city, wager: 300 });
  assert.equal(tick(offer(), { dt: 0.1, declined: true }).state.result, 'void');
  assert.equal(tick(offer(), { dt: 0.1, abort: true }).state.result, 'void');
  assert.equal(tick(offer(), { dt: 0.1, aborted: true }).state.result, 'void');
  const live = started('race');            // wager 500
  assert.equal(live.phase, 'running');

  /* A bail after the green light is a DNF, NOT an instant loss: the instant
     version resolves locally before the other side's bail can arrive, so two
     people quitting at once both pay and the stake is destroyed twice. */
  const bailed = tick(live, { dt: 0.1, abort: true }).state;
  assert.equal(bailed.phase, 'waiting');
  assert.equal(bailed.metric, null);
  assert.equal(bailed.result, null, 'a bail must not settle before their number is in');

  // their number, a finish, beats my DNF
  const lost = tick(receive(bailed, { k: 'p', round: 0, kind: 'race', done: 1, metric: 30 }), { dt: 0.1 }).state;
  assert.equal(lost.result, 'loss');
  assert.equal(lost.delta, -500);
  // and the other machine, holding the finish, reads my DNF the same way
  const won = tick(receive(started('race'), { k: 'p', round: 0, kind: 'race', done: 1, metric: null }),
    { dt: 0.1, x: 0, z: 0 }).state;
  assert.equal(tick({ ...won, metric: 30, phase: 'waiting' }, { dt: 0.1 }).state.result, 'win');
  assert.equal(lost.delta + 500, 0, 'a bail must not mint cash');

  // both quit: two DNFs are a dead heat, which is the only answer that balances
  const theyWentToo = tick(bailed, { dt: 0.1, aborted: true }).state;
  assert.equal(theyWentToo.result, 'draw');
  assert.equal(theyWentToo.delta, 0);
});

test('a peer that goes silent voids the bet rather than handing anyone a walkover', () => {
  // both sides run the same rule, so both void: cash can never be minted here
  const a = started('race');
  const b = started('race');
  const outA = run(a, TUNING.PEER_TIMEOUT + 2, { x: 2350, z: 1350 }, 0.25, true).state;
  const outB = run(b, TUNING.PEER_TIMEOUT + 2, { x: 2350, z: 1350 }, 0.25, true).state;
  assert.equal(outA.result, 'void');
  assert.equal(outB.result, 'void');
  assert.equal(outA.delta + outB.delta, 0);
});

test('a race reports a split per gate and finishes on the last one', () => {
  let s = started('race');
  const gates = s.params.gates;
  const evs = [];
  for (const g of gates) {
    const r = tick(s, { dt: 0.5, x: g.x, z: g.z });
    s = r.state; evs.push(...r.events);
    s = receive(s, { k: 'p', round: 0, kind: 'race', done: 0, metric: null, i: 0 });
  }
  const splits = evs.filter((e) => e.k === 'checkpoint');
  assert.equal(splits.length, gates.length);
  assert.deepEqual(splits.map((e) => e.i), [1, 2, 3, 4, 5, 6]);
  assert.ok(splits[5].split > splits[0].split, 'splits do not advance');
  assert.equal(s.phase, 'waiting', 'finishing should wait for the other number');
  assert.equal(typeof s.metric, 'number');
  assert.equal(s.splits.length, gates.length);
});

test('two machines reach the same verdict from the same numbers, and the cash nets to zero', () => {
  const mk = (mine) => createMatch({ kind: 'race', roomSeed: hashSeed(ROOM), district: city, wager: 1000, mine });
  let a = tick(mk(true), { dt: 0.1, accepted: true }).state;
  let b = tick(mk(false), { dt: 0.1, accepted: true }).state;
  a = run(a, TUNING.COUNTDOWN + 0.5, { x: 0, z: 0 }).state;
  b = run(b, TUNING.COUNTDOWN + 0.5, { x: 0, z: 0 }).state;
  // A drives the course; B does not, and caps out
  const gates = a.params.gates;
  for (const g of gates) {
    a = tick(a, { dt: 0.5, x: g.x, z: g.z }).state;
    b = receive(b, report(a));
    a = receive(a, report(b));
  }
  assert.equal(a.phase, 'waiting');
  // B never finishes: it caps out at a DNF, then takes A's number and settles
  let bs = run(b, b.params.cap + 2, { x: 0, z: 0 }, 0.5).state;
  assert.equal(bs.metric, null);
  // A's report keeps going out for LINGER seconds after it finished
  bs = receive(bs, report(a));
  bs = tick(bs, { dt: 0.1, x: 0, z: 0 }).state;
  a = receive(a, { k: 'p', round: 0, kind: 'race', done: 1, metric: null, i: 0 });
  a = tick(a, { dt: 0.1 }).state;
  assert.equal(a.result, 'win');
  assert.equal(bs.result, 'loss');
  assert.equal(a.delta + bs.delta, 0, 'a wager must not mint or destroy cash');
});

test('the comparison is the settlement rule, and a dead heat pays nobody', () => {
  assert.equal(compare('low', 42.0, 51.2), 'win');
  assert.equal(compare('low', 51.2, 42.0), 'loss');
  assert.equal(compare('low', null, 42.0), 'loss');       // I never finished
  assert.equal(compare('low', 42.0, null), 'win');
  assert.equal(compare('low', null, null), 'draw');       // neither did
  assert.equal(compare('high', 31.5, 12.0), 'win');       // seconds held / survived
  assert.equal(compare('high', 12.0, 31.5), 'loss');
  assert.equal(compare('high', 12.0, 12.0), 'draw');
});

test('a delivery wants a stop at the drop, not a fly-past', () => {
  let s = started('delivery');
  s = tick(s, { dt: 0.5, x: s.params.pickup.x, z: s.params.pickup.z }).state;
  assert.equal(s.i, 1, 'pickup missed');
  const fast = tick(s, { dt: 0.5, x: s.params.drop.x, z: s.params.drop.z, speed: 22 }).state;
  assert.equal(fast.phase, 'running', 'a fly-past counted as a delivery');
  const done = tick(s, { dt: 0.5, x: s.params.drop.x, z: s.params.drop.z, speed: 1 }).state;
  assert.equal(done.phase, 'waiting');
  assert.ok(done.metric > 0);
});

test('pursuit: roles swap, only the chaser scores, and the distance rule is inclusive at N metres', () => {
  const a = started('pursuit', { mine: true });    // I offered
  const b = started('pursuit', { mine: false });   // I was challenged
  assert.equal(roleOn(a, 0), 'runner');            // the challenger runs first
  assert.equal(roleOn(b, 0), 'chaser');
  assert.equal(roleOn(a, 1), 'chaser');
  assert.equal(roleOn(b, 1), 'runner');
  const N = a.params.maxDist;
  const keep = (d) => ({ x: 2350, z: 1350, peerDist: d });
  // the runner banks nothing however close they sit
  assert.equal(run(a, 10, keep(1)).state.hold, 0);
  // exactly N counts, a whisker over does not, and no packet at all does not
  assert.ok(run(b, 10, keep(N)).state.hold > 9, 'N metres exactly should count');
  assert.equal(run(b, 10, keep(N + 0.01)).state.hold, 0);
  assert.equal(run(b, 10, keep(null)).state.hold, 0);
});

test('pursuit runs two legs and settles on the aggregate hold', () => {
  let s = started('pursuit', { mine: false });   // challenged, so chases leg 0
  const legs = [];
  const out = run(s, s.params.legSecs * 2 + 2, (st) => {
    void st; return { x: 2350, z: 1350, peerDist: 10 };
  }, 0.5);
  s = out.state;
  legs.push(...out.events.filter((e) => e.k === 'leg'));
  assert.equal(legs.length, 1, 'the legs did not swap exactly once');
  assert.equal(legs[0].role, 'runner');
  assert.equal(s.phase, 'waiting');
  // held the whole of leg 0 and none of leg 1 (the runner scores nothing)
  assert.ok(s.metric > 55 && s.metric <= 61, `hold ${s.metric}`);
});

test('survivor ends the moment you are busted, and the time cap is the other way out', () => {
  const early = started('survivor');
  const busted = run(early, 30, (st, t) => ({ x: 2350, z: 1350, busted: t > 10 })).state;
  assert.equal(busted.phase, 'waiting');
  assert.ok(busted.metric > 9 && busted.metric < 12, `busted at ${busted.metric}`);

  const s = started('survivor');
  const cap = s.params.cap;
  const justUnder = run(s, cap - 1, { x: 2350, z: 1350 }, 0.5).state;
  assert.equal(justUnder.phase, 'running', 'ended before the cap');
  assert.equal(justUnder.metric, null);
  const over = run(justUnder, 3, { x: 2350, z: 1350 }, 0.5).state;
  assert.equal(over.phase, 'waiting');
  assert.equal(over.metric, cap, 'surviving to the cap should score the full cap');
  assert.ok(s.params.stars >= 3 && s.params.stars <= 4);
});

test('a race that never finishes caps out as a DNF rather than hanging', () => {
  const s = started('race');
  const out = run(s, s.params.cap + 2, { x: 2350, z: 1350 }, 0.5).state;
  assert.equal(out.phase, 'waiting');
  assert.equal(out.metric, null);
  // and waiting itself has an end: no number from them, no bet
  const void_ = run(out, TUNING.WAIT_SLACK + 2, { x: 2350, z: 1350 }, 0.5).state;
  assert.equal(void_.result, 'void');
  assert.equal(void_.delta, 0);
});

test('driving out of the district ends your run after a grace, not instantly', () => {
  const s = started('race');
  const far = { x: -900, z: -900 };
  const early = run(s, TUNING.STRAY_GRACE - 1, far, 0.5).state;
  assert.equal(early.phase, 'running', 'a moment off the map should not end it');
  const out = run(early, 3, far, 0.5).state;
  assert.equal(out.phase, 'waiting');
  assert.equal(out.metric, null, 'leaving the map should be a DNF, not a time');
});

test('the wire is quiet, typed, and ignores a packet from another round', () => {
  // straight out of the countdown, so nothing has been heard from the peer yet
  const s = tick(createMatch({ kind: 'race', roomSeed: hashSeed(ROOM), district: city }), { dt: 0.1, accepted: true }).state;
  const p = report(s);
  assert.equal(p.k, 'p');
  assert.deepEqual(Object.keys(p).sort(), ['done', 'i', 'k', 'kind', 'metric', 'round']);
  assert.equal(report(createMatch({ kind: 'race', roomSeed: 1, district: city })), null, 'an unaccepted offer should say nothing');
  const stale = receive(s, { k: 'p', round: 7, kind: 'race', done: 1, metric: 9 });
  assert.equal(stale.peer, null, 'a packet from another round was accepted');
  const wrong = receive(s, { k: 'p', round: 0, kind: 'survivor', done: 1, metric: 9 });
  assert.equal(wrong.peer, null, 'a packet from another challenge was accepted');
  const good = receive(s, { k: 'p', round: 0, kind: 'race', done: 1, metric: 9 });
  assert.equal(good.peer.metric, 9);
  assert.equal(good.peerAge, 0);
});

test('the countdown counts down once per second and then says go', () => {
  const s = createMatch({ kind: 'race', roomSeed: hashSeed(ROOM), district: city, wager: 100 });
  const first = tick(s, { dt: 0.1, accepted: true });
  assert.equal(first.state.phase, 'countdown');
  assert.deepEqual(first.events, [{ k: 'countdown', n: TUNING.COUNTDOWN }]);
  const out = run(first.state, TUNING.COUNTDOWN + 1, { x: 0, z: 0 }, 0.25);
  const counts = out.events.filter((e) => e.k === 'countdown').map((e) => e.n);
  assert.deepEqual(counts, [4, 3, 2, 1]);
  assert.equal(out.events.filter((e) => e.k === 'go').length, 1);
  assert.equal(out.state.phase, 'running');
});

/* The glue, exercised end to end: two rooms wired straight into each other.
   This is the money path, so it is the one integration test worth having. */
function table(kind = 'race', wager = 400) {
  const rooms = {};
  const mk = (name) => {
    const g = {
      jobs: { cash: 5000 },
      addCash(n) { this.jobs.cash += n; },
      spendCash(n) { if (this.jobs.cash < n) return false; this.jobs.cash -= n; return true; },
    };
    const banners = [];
    const net = {
      connected: 1, seed: hashSeed(ROOM),
      versus: (msg) => rooms[name === 'a' ? 'b' : 'a'].room.onPacket(JSON.parse(JSON.stringify(msg)), name),
      others: () => [{ x: 0, z: 0 }],
    };
    const room = new VersusRoom({
      net, district: city, garage: g,
      mission: { route() {}, stop() {} },
      hud: { flash() {}, setJob() {}, showVictoryBanner: (t, s2, c) => banners.push([t, c]) },
      setWanted() {},
    });
    room.kind = kind; room.wager = wager;
    return { room, g, banners };
  };
  rooms.a = mk('a'); rooms.b = mk('b');
  return rooms;
}

test('two rooms settle the same race the same way, and the cash nets to zero', () => {
  const { a, b } = table('race', 400);
  const purse = a.g.jobs.cash + b.g.jobs.cash;
  a.room.offerOrAccept();                       // A challenges
  assert.equal(b.room.incoming, true, 'the offer never arrived');
  b.room.offerOrAccept();                       // B accepts
  const still = { x: 0, z: 0, fwdSpeed: 0 };
  for (let t = 0; t < TUNING.COUNTDOWN + 1; t += 0.25) { a.room.update(still, 0.25); b.room.update(still, 0.25); }
  assert.equal(a.room.match.phase, 'running');
  assert.equal(b.room.match.phase, 'running');
  // A drives the course, B sits on the line
  for (const g of a.room.match.params.gates) {
    a.room.update({ x: g.x, z: g.z, fwdSpeed: 30 }, 0.5);
    b.room.update(still, 0.5);
  }
  assert.equal(a.room.match.phase, 'waiting', 'A did not finish');
  // B runs out its cap, hears A's number, settles; A waits for it and settles too
  let aResult = null, bResult = null;
  for (let t = 0; t < b.room.match.params.cap + 20; t += 0.5) {
    a.room.update(still, 0.5);
    b.room.update(still, 0.5);
    aResult = aResult ?? a.room.match?.result ?? null;
    bResult = bResult ?? b.room.match?.result ?? null;
    if (aResult && bResult) break;
  }
  assert.equal(bResult, 'loss');
  assert.equal(aResult, 'win');
  assert.equal(a.g.jobs.cash, 5400);
  assert.equal(b.g.jobs.cash, 4600);
  assert.equal(a.g.jobs.cash + b.g.jobs.cash, purse, 'the wager minted or destroyed cash');
  assert.deepEqual(a.banners[0], ['YOU WIN', 400]);
  assert.deepEqual(b.banners[0], ['YOU LOSE', 400]);
});

test('you cannot stake what you have not got, and a declined offer costs nothing', () => {
  const { a, b } = table('race', 9000);
  a.room.offerOrAccept();
  assert.equal(a.room.match, null, 'offered a stake it cannot cover');
  assert.equal(b.room.match, null);
  const { a: c, b: d } = table('race', 400);
  c.room.offerOrAccept();
  d.room.bail();                                 // decline
  c.room.update({ x: 0, z: 0 }, 0.1);
  assert.equal(c.room.match.result, 'void');
  assert.equal(c.g.jobs.cash, 5000);
  assert.equal(d.g.jobs.cash, 5000);
});

/* ---------------------------------------------------------------------------
 * Review pass (2026-09-12). The two properties a wager lives or dies on:
 *
 *   CONSISTENCY  -- the same events, delivered in any order, at any latency,
 *                   settle to the same verdict on BOTH machines. A wager that
 *                   settles differently on the two screens is the worst
 *                   outcome there is, worse than no wager at all.
 *   CONSERVATION -- across every path (win, loss, draw, bail, both bail,
 *                   decline, expiry, dropout, a loser who is broke) the two
 *                   purses together never change. Cash minted by a dropped
 *                   peer is a real bug; cash destroyed is the safe direction.
 *
 * Both are measured against the glue, not the pure half, because the glue is
 * where the wire, the round numbers and the money actually meet.
 * ------------------------------------------------------------------------- */

const PARK = { x: 2350, z: 1350, fwdSpeed: 0 };

/** Two rooms and a wire between them with a per-direction delay and a queue. */
function sim({ kind = 'race', wager = 400, cashA = 5000, cashB = 5000, lat = [0, 0], shuffle = false, jitter = 0, seed = 1 }) {
  const q = [];
  let clock = 0;
  // seeded jitter: a packet can overtake the one before it, which is the only
  // way to test that nothing in here depends on the order things arrive in
  let st = seed >>> 0 || 1;
  const jit = () => {
    st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0;
    return jitter ? (st / 4294967296) * jitter : 0;
  };
  const rooms = {};
  const mk = (name, cash, delay) => {
    const purse = { cash, persist() {} };
    const garage = {
      jobs: purse,
      addCash(n) { purse.cash += n; },
      spendCash(n) { if (purse.cash < n) return false; purse.cash -= n; return true; },
    };
    const to = name === 'a' ? 'b' : 'a';
    const net = {
      connected: 1, seed: hashSeed(ROOM),
      versus: (msg) => q.push({ at: clock + delay + jit(), to, from: name, msg: JSON.parse(JSON.stringify(msg)) }),
      others: () => [{ x: 0, z: 0 }],
    };
    const room = new VersusRoom({
      net, district: city, garage,
      mission: { route() {}, stop() {} },
      hud: { flash() {}, setVersus() {}, showVictoryBanner() {} },
      setWanted() {},
    });
    room.kind = kind; room.wager = wager;
    return { room, purse, alive: true, result: null };
  };
  rooms.a = mk('a', cashA, lat[0]); rooms.b = mk('b', cashB, lat[1]);
  const start = cashA + cashB;

  const step = (dt, carA, carB) => {
    clock += dt;
    const due = q.filter((m) => m.at <= clock);
    for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= clock) q.splice(i, 1);
    if (shuffle) due.reverse();                       // same-frame arrivals, the other way round
    for (const m of due) if (rooms[m.to].alive) rooms[m.to].room.onPacket(m.msg, m.from);
    for (const [name, car] of [['a', carA], ['b', carB]]) {
      const r = rooms[name];
      if (!r.alive) continue;
      r.room.update(car, dt);
      r.result = r.result ?? r.room.match?.result ?? null;
    }
  };
  return { rooms, step, start, cash: () => rooms.a.purse.cash + rooms.b.purse.cash };
}

/** win/loss, loss/win, void/void, draw/draw -- anything else is a disagreement. */
function agree(ra, rb) {
  if (ra === 'win') return rb === 'loss';
  if (ra === 'loss') return rb === 'win';
  return ra === rb;
}

/**
 * Offer, auto-accept, then drive. `a`/`b` are frames-per-gate (null = park on
 * the line). Returns the sim once both sides have a verdict or time runs out.
 */
function playRace({ lat = [0, 0], shuffle = false, jitter = 0, seed = 1, a = 1, b = null, wager = 400, cashB = 5000 } = {}) {
  const s = sim({ kind: 'race', lat, shuffle, jitter, seed, wager, cashB });
  s.rooms.a.room.offerOrAccept();
  let fa = 0, fb = 0;
  for (let t = 0; t < 420; t += 0.5) {
    if (s.rooms.b.room.incoming) s.rooms.b.room.offerOrAccept();
    const pick = (r, every, f) => {
      if (!every || r.room.match?.phase !== 'running') return PARK;
      const g = (r.room.match.params.gates)[Math.floor(f / every)];
      return g ? { x: g.x, z: g.z, fwdSpeed: 25 } : PARK;
    };
    const ca = pick(s.rooms.a, a, fa); const cb = pick(s.rooms.b, b, fb);
    if (s.rooms.a.room.match?.phase === 'running') fa++;
    if (s.rooms.b.room.match?.phase === 'running') fb++;
    s.step(0.5, ca, cb);
    if (s.rooms.a.result && s.rooms.b.result) break;
  }
  return s;
}

test('the line both cars park on is not sitting in a checkpoint', () => {
  // the whole fixture leans on this: a parked car must score nothing
  const g = generate('race', courseSeed(hashSeed(ROOM), 'race', 1), city);
  for (const p of g.gates) assert.ok(Math.hypot(p.x - PARK.x, p.z - PARK.z) > TUNING.GATE_R * 2);
});

test('CONSISTENCY: the same race settles identically at every latency and arrival order', () => {
  const wires = [
    { lat: [0, 0] },                       // both instant
    { lat: [0.5, 0.5] },                   // half a second each way
    { lat: [2, 2] },                       // a bad connection
    { lat: [2, 0] },                       // asymmetric: A's packets crawl
    { lat: [0, 2] },                       // asymmetric the other way
    { lat: [1, 1], shuffle: true },        // same-frame arrivals reordered
  ];
  const seen = [];
  for (const w of wires) {
    const s = playRace({ ...w, a: 1, b: 6 });            // A drives it, B dawdles
    const ra = s.rooms.a.result, rb = s.rooms.b.result;
    assert.ok(agree(ra, rb), `wire ${JSON.stringify(w)} disagreed: A=${ra} B=${rb}`);
    assert.equal(s.cash(), s.start, `wire ${JSON.stringify(w)} moved the total`);
    seen.push(`${ra}/${rb}`);
  }
  assert.equal(new Set(seen).size, 1, `arrival order changed the verdict: ${seen.join(' ')}`);
  assert.equal(seen[0], 'win/loss', `A drove the whole course and should have won, got ${seen[0]}`);
});

test('CONSISTENCY: an identical drive is a dead heat on both machines, and pays nobody', () => {
  for (const w of [{ lat: [0, 0] }, { lat: [1.5, 0.5] }, { lat: [1, 1], shuffle: true }]) {
    const s = playRace({ ...w, a: 2, b: 2 });
    assert.equal(s.rooms.a.result, 'draw', `A: ${s.rooms.a.result}`);
    assert.equal(s.rooms.b.result, 'draw', `B: ${s.rooms.b.result}`);
    assert.equal(s.cash(), s.start);
    assert.equal(s.rooms.a.purse.cash, 5000);
  }
});

test('CONSERVATION: every ending moves the same money out of one purse and into the other', () => {
  const rows = [];

  // 1. a clean win
  let s = playRace({ a: 1, b: 6 });
  rows.push(['win', s, 'win', 'loss', 400]);

  // 2. both finish, A first
  s = playRace({ a: 1, b: 3 });
  rows.push(['both finish', s, 'win', 'loss', 400]);

  // 3. A bails once it is running, B drives on and finishes: the bailer pays
  s = sim({ kind: 'race' });
  s.rooms.a.room.offerOrAccept();
  let fb = 0, quit = false;
  for (let t = 0; t < 200; t += 0.5) {
    if (s.rooms.b.room.incoming) s.rooms.b.room.offerOrAccept();
    if (!quit && s.rooms.a.room.match?.phase === 'running' && t > 12) { quit = true; s.rooms.a.room.bail(); }
    const mb = s.rooms.b.room.match;
    const g = mb?.phase === 'running' ? mb.params.gates[fb++] : null;
    s.step(0.5, PARK, g ? { x: g.x, z: g.z, fwdSpeed: 25 } : PARK);
    if (s.rooms.a.result && s.rooms.b.result) break;
  }
  assert.ok(quit, 'A never got to bail');
  rows.push(['A bails', s, 'loss', 'win', 400]);

  // 4. both bail inside one packet's flight -- a dead heat, not two losses
  s = sim({ kind: 'race', lat: [1, 1] });
  s.rooms.a.room.offerOrAccept();
  let bailed = false;
  for (let t = 0; t < 400; t += 0.5) {
    if (s.rooms.b.room.incoming) s.rooms.b.room.offerOrAccept();
    if (!bailed && s.rooms.a.room.match?.phase === 'running' && s.rooms.b.room.match?.phase === 'running') {
      bailed = true; s.rooms.a.room.bail(); s.rooms.b.room.bail();
    }
    s.step(0.5, PARK, PARK);
    if (s.rooms.a.result && s.rooms.b.result) break;
  }
  assert.ok(bailed, 'never got both sides running');
  rows.push(['both bail', s, 'draw', 'draw', 0]);

  // 5. declined
  s = sim({ kind: 'race' });
  s.rooms.a.room.offerOrAccept();
  for (let t = 0; t < 20; t += 0.5) {
    if (s.rooms.b.room.incoming) s.rooms.b.room.bail();
    s.step(0.5, PARK, PARK);
    if (s.rooms.a.result && s.rooms.b.result) break;
  }
  rows.push(['declined', s, 'void', 'void', 0]);

  // 6. nobody answers
  s = sim({ kind: 'race' });
  s.rooms.a.room.offerOrAccept();
  for (let t = 0; t < TUNING.OFFER_TIMEOUT + 5; t += 0.5) s.step(0.5, PARK, PARK);
  rows.push(['no answer', s, 'void', 'void', 0]);

  for (const [name, sm, ra, rb, moved] of rows) {
    assert.equal(sm.rooms.a.result, ra, `${name}: A got ${sm.rooms.a.result}`);
    assert.equal(sm.rooms.b.result, rb, `${name}: B got ${sm.rooms.b.result}`);
    assert.ok(agree(sm.rooms.a.result, sm.rooms.b.result), `${name}: the two machines disagree`);
    assert.equal(sm.cash(), sm.start, `${name}: the wager minted or destroyed cash`);
    assert.equal(Math.abs(sm.rooms.a.purse.cash - 5000), moved, `${name}: moved the wrong amount`);
  }
});

test('CONSERVATION: a peer that vanishes mid-race mints nothing for the one still driving', () => {
  const s = sim({ kind: 'race' });
  s.rooms.a.room.offerOrAccept();
  let fa = 0;
  for (let t = 0; t < 120; t += 0.5) {
    if (s.rooms.b.room.incoming) s.rooms.b.room.offerOrAccept();
    if (t > 12) s.rooms.b.alive = false;                 // B's tab is gone: no packets, no updates
    const g = s.rooms.a.room.match?.phase === 'running' ? s.rooms.a.room.match.params.gates[fa++] : null;
    s.step(0.5, g ? { x: g.x, z: g.z, fwdSpeed: 25 } : PARK, PARK);
    if (s.rooms.a.result) break;
  }
  assert.equal(s.rooms.a.result, 'void', 'a dropped peer must not hand out a walkover');
  assert.equal(s.rooms.b.result, null);
  assert.equal(s.cash(), s.start);
  assert.equal(s.rooms.a.purse.cash, 5000);
});

test('CONSERVATION: a loser who spends the stake mid-race still pays it', () => {
  /* You cannot STAKE what you have not got -- offerOrAccept checks that -- but
     you can spend it afterwards, on a gun or a respray, while the race is on.
     garage.spendCash then deducts NOTHING and returns false, and taking that
     as "paid" would pay the winner out of thin air. */
  assert.equal(playRace({ a: 1, b: 6, wager: 9000 }).rooms.a.room.match, null, 'staked more than it holds');

  const s = sim({ kind: 'race', wager: 400 });
  s.rooms.a.room.offerOrAccept();
  let fa = 0, drained = false;
  for (let t = 0; t < 420; t += 0.5) {
    if (s.rooms.b.room.incoming) s.rooms.b.room.offerOrAccept();
    const ma = s.rooms.a.room.match;
    if (!drained && s.rooms.b.room.match?.phase === 'running') { drained = true; s.rooms.b.purse.cash = 100; }
    const g = ma?.phase === 'running' ? ma.params.gates[fa++] : null;
    s.step(0.5, g ? { x: g.x, z: g.z, fwdSpeed: 25 } : PARK, PARK);
    if (s.rooms.a.result && s.rooms.b.result) break;
  }
  assert.ok(drained, 'never got to spend B down');
  assert.equal(s.rooms.a.result, 'win');
  assert.equal(s.rooms.b.result, 'loss');
  assert.equal(s.rooms.b.purse.cash, -300, 'the loser kept money it had staked');
  assert.equal(s.rooms.a.purse.cash + s.rooms.b.purse.cash, 5000 + 100, 'a broke loser minted the wager');
});

test('CONSERVATION: settling twice is not a thing -- the frames after the end move nothing', () => {
  const s = playRace({ a: 1, b: 6 });
  const after = s.cash();
  const ca = s.rooms.a.purse.cash;
  for (let t = 0; t < TUNING.LINGER + 20; t += 0.5) s.step(0.5, PARK, PARK);
  assert.equal(s.cash(), after);
  assert.equal(s.rooms.a.purse.cash, ca, 'the result paid out again');
  assert.equal(s.rooms.a.room.match, null, 'the finished match was never cleared');
});

test('a rematch gets a round of its own, so the dead match cannot settle it', () => {
  const s = playRace({ a: 1, b: 6 });
  const first = s.rooms.a.room.round;
  // the losing side lingers its final packet; meanwhile the winner offers again
  s.rooms.a.room.offerOrAccept();
  assert.ok(s.rooms.a.room.round > first, 'the rematch re-used a round number');
  assert.equal(s.rooms.a.room.match.phase, 'offered');
  assert.equal(s.rooms.a.room.match.peer, null, 'a packet from the dead match bound to the new one');
  // the old round's done packet must bounce off the new match
  s.rooms.a.room.onPacket({ k: 'p', round: first, kind: 'race', done: 1, metric: 1 }, 'b');
  assert.equal(s.rooms.a.room.match.peer, null, 'a stale round settled a live match');
  const fresh = generate('race', courseSeed(hashSeed(ROOM), 'race', s.rooms.a.room.round), city);
  assert.deepEqual(s.rooms.a.room.match.params.gates, fresh.gates);
});

test('the wager survives the other three challenges too', () => {
  for (const kind of ['pursuit', 'delivery', 'survivor']) {
    const s = sim({ kind, lat: [0.5, 0.5] });
    s.rooms.a.room.offerOrAccept();
    let bailed = false;
    for (let t = 0; t < 300; t += 0.5) {
      if (s.rooms.b.room.incoming) s.rooms.b.room.offerOrAccept();
      if (!bailed && s.rooms.b.room.match?.phase === 'running' && t > 20) { bailed = true; s.rooms.b.room.bail(); }
      // A sees it through: the delivery has to be driven, the other two only sat out
      const ma = s.rooms.a.room.match;
      let ca = PARK;
      if (kind === 'delivery' && ma?.phase === 'running') {
        const p = ma.i === 0 ? ma.params.pickup : ma.params.drop;
        ca = { x: p.x, z: p.z, fwdSpeed: 0 };
      }
      s.step(0.5, ca, PARK);
      if (s.rooms.a.result && s.rooms.b.result) break;
    }
    assert.ok(bailed, `${kind}: B never got to bail`);
    assert.equal(s.rooms.b.result, 'loss', `${kind}: the bailer did not pay`);
    assert.equal(s.rooms.a.result, 'win', `${kind}: A got ${s.rooms.a.result}`);
    assert.equal(s.cash(), s.start, `${kind}: cash was minted or destroyed`);
  }
});

test('no district, no crash: a room joined from the URL before the city loads', () => {
  // main.js runs joinRoom() at the top level; window.district only exists once
  // the plan has parsed, so the injected district has to be read lazily
  let plan = null;
  const sent = [];
  const room = new VersusRoom({
    net: { connected: 1, seed: 1, versus: (m) => sent.push(m), others: () => [] },
    district: () => plan,
    garage: { jobs: { cash: 9000 }, addCash() {}, spendCash() { return true; } },
    mission: { route() {}, stop() {} }, hud: { flash() {} }, setWanted() {},
  });
  room.offerOrAccept();
  assert.equal(room.match, null, 'laid a course with no city');
  assert.deepEqual(sent, [], 'offered a match it could not build');
  room.onPacket({ k: 'offer', kind: 'race', wager: 100, round: 1 }, 'b');
  assert.equal(room.match, null);
  assert.equal(sent[0]?.k, 'decline', 'an offer we cannot build must be declined, not dropped');
  plan = city;                                   // the district finishes loading
  room.offerOrAccept();
  assert.equal(room.match?.phase, 'offered');
});

test('CONSISTENCY: packets that overtake each other still settle the same way', () => {
  /* The wire is not a queue. An accept can land after the first progress
     packet, a bail after a report, a report after the result. Eight seeded
     reorderings of the same race must all reach the same verdict, or two
     players are going to see two different answers on one wager. */
  const seen = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    const s = playRace({ lat: [0.4, 0.9], jitter: 2.5, seed, a: 1, b: 6 });
    const ra = s.rooms.a.result, rb = s.rooms.b.result;
    assert.ok(agree(ra, rb), `seed ${seed}: A=${ra} B=${rb}`);
    assert.equal(s.cash(), s.start, `seed ${seed}: the total moved`);
    seen.add(`${ra}/${rb}`);
  }
  assert.deepEqual([...seen], ['win/loss'], `reordering changed the verdict: ${[...seen].join(' ')}`);
});

test('CONSISTENCY: a dead heat survives reordering too, and still pays nobody', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const s = playRace({ lat: [1, 0.2], jitter: 3, seed, a: 2, b: 2 });
    assert.equal(s.rooms.a.result, 'draw', `seed ${seed}: A=${s.rooms.a.result}`);
    assert.equal(s.rooms.b.result, 'draw', `seed ${seed}: B=${s.rooms.b.result}`);
    assert.equal(s.cash(), s.start);
  }
});

test('a peer bailing tells you to finish, because a DNF of your own is a dead heat', () => {
  const live = started('race');
  const r = tick(live, { dt: 0.1, x: 0, z: 0, aborted: true });
  assert.equal(r.state.phase, 'running', 'hearing a bail must not end my run');
  assert.equal(r.events.filter((e) => e.k === 'quit').length, 1, 'no word that they quit');
  assert.equal(r.state.peer.done, true);
  assert.equal(r.state.peer.metric, null);
});
