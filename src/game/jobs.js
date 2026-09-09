import { roadDepth } from '../world/metrics.js';

/**
 * Jobs: the reason to drive to the next street.
 *
 * G takes the next job (G again abandons it). Three kinds, all routed through
 * the Mission markers the checkpoint run already draws:
 *
 *   COURIER  pick up at A, deliver to B against the clock; late = less pay
 *   FARE     a passenger at a kerb; stop inside the ring, drive them across town
 *   GETAWAY  you start hot (2 stars); reach the drop and lose the heat to be paid
 *
 * Pay is base by distance and district tier, then heat eats it: each wanted
 * star at the drop costs 20%, a clean drop pays a bonus, WASTED or BUSTED
 * forfeits the job. Cash persists in localStorage ('hb.cash'); the rating
 * (jobs done) opens longer, better-paid jobs. This is the loop; the garage
 * that spends the cash is the next slice.
 */
const KINDS = ['courier', 'fare', 'getaway'];
const TIER = { KINGSWAY: 3, 'HARBOUR POINT': 2, STEELGATE: 2, 'OLD QUARTER': 2, 'VELLERY ROW': 2,
  NORTHLINE: 1, ASHMOOR: 1, 'MARROW HILL': 1, 'THE FLATS': 1, 'GREENFELL PARK': 1 };

export class Jobs {
  constructor(mission, traffic, hud, district, audio = null, navigation = null) {
    this.mission = mission; this.traffic = traffic; this.hud = hud; this.district = district; this.audio = audio;
    this.navigation = navigation;
    let savedCash = 0, savedDone = 0;
    let grantedBonus = false;
    try {
      if (typeof localStorage !== 'undefined') {
        savedCash = Number(localStorage.getItem('hb.cash') || 0);
        savedDone = Number(localStorage.getItem('hb.jobs') || 0);
        if (!Number.isFinite(savedCash)) savedCash = 0;   // a corrupt value read as NaN, and NaN < price is false: spendCash never failed
        if (!Number.isFinite(savedDone)) savedDone = 0;
        // the test-funds grant is a dev convenience: only under ?debug (the flag semantics are unchanged)
        const debug = typeof location !== 'undefined' && /[?&]debug/.test(location.search);
        if (debug && !localStorage.getItem('hb.grant_50k')) {
          savedCash += 50000;
          grantedBonus = true;
          localStorage.setItem('hb.grant_50k', '1');
          localStorage.setItem('hb.cash', String(savedCash));
        }
      }
    } catch { /* private mode */ }
    this.cash = savedCash;
    this.done = savedDone;
    this.job = null;
    this.nodes = district.graph.nodes.filter((n) => n.kind === 'cross' || n.kind === 'tee');
    if (mission.addListener) {
      mission.addListener('finish', (t) => this.#finish(t));
    } else {
      const prev = mission.onFinish;
      mission.onFinish = (t) => { if (prev) prev(t); this.#finish(t); };
    }
    this.#show();
    if (grantedBonus && this.hud) {
      setTimeout(() => {
        if (this.hud?.flash) this.hud.flash('💰 +$50,000 TEST FUNDS CREDITED! OPEN PHONE [M] TO CALL HELI / TANK');
      }, 1500);
    }
  }

  #districtAt(x, z) {
    let best = null, bd = Infinity;
    for (const b of this.district.blocks) { const d = Math.hypot(b.x - x, b.y - z); if (d < bd) { bd = d; best = b.district; } }
    return best;
  }

  #pick(from, min, max, avoid) {
    let best = null, bs = -1;
    for (let k = 0; k < 200; k++) {
      const n = this.nodes[(Math.random() * this.nodes.length) | 0];
      const d = Math.hypot(n.x - from.x, n.y - from.z);
      if (d < min || d > max) continue;
      const s = Math.random() + (avoid && Math.hypot(n.x - avoid.x, n.y - avoid.y) < 150 ? -1 : 0);
      if (s > bs) { bs = s; best = n; }
    }
    return best;
  }

  /** G: take a job, or abandon the current one. */
  toggle(car) {
    if (this.job) {
      this.mission.stop('JOB ABANDONED');
      this.job = null;
      if (this.navigation) this.navigation.clearWaypoint();
      this.#show();
      return;
    }
    const kind = KINDS[(Math.random() * KINDS.length) | 0];
    const rating = 1 + Math.min(3, Math.floor(this.done / 4));          // longer runs as you prove yourself
    const a = this.#pick({ x: car.x, z: car.z }, 120, 260 + 80 * rating);
    if (!a) return;
    const b = this.#pick({ x: a.x, z: a.y }, 250, 450 + 120 * rating, a);
    if (!b) return;
    const dist = Math.hypot(a.x - car.x, a.y - car.z) + Math.hypot(b.x - a.x, b.y - a.y);
    const tier = TIER[this.#districtAt(b.x, b.y)] ?? 1;
    const pay = Math.round((60 + dist * 0.45) * (0.8 + tier * 0.35));
    const limit = kind === 'courier' ? dist / 12 + 20 : Infinity;          // 12 m/s average is honest city pace
    this.job = { kind, pay, limit, tier, a, b, pickedUp: false, t: 0 };
    // fares board and packages load only at a standstill: the ring holds until you stop (mission.js requireStop); a getaway is a fly-through
    this.mission.route([a, b], kind === 'fare' ? 'PICK UP THE FARE · COME TO A STOP AT MARKER' : kind === 'getaway' ? 'LOSE THE HEAT · REACH THE DROP' : 'COLLECT THE PACKAGE', false, { requireStop: kind !== 'getaway' });
    if (this.navigation) {
      this.navigation.setWaypoint(a.x, a.z !== undefined ? a.z : a.y);
      this.navigation.lastTarget = null;
    }
    if (kind === 'getaway') { this.traffic.wanted = Math.max(this.traffic.wanted, 2); this.traffic.cool = 0; }   // 'you start hot (2 stars)': reportCrime('police', 6) gave 1.04 and needed a witness
    this.hud.flash(`${kind.toUpperCase()} · $${pay}${limit < Infinity ? ` · ${Math.round(limit)}s` : ''}`);
    this.#show();
  }

  update(car, dt) {
    const j = this.job; if (!j) return;
    j.t += dt;
    const spd = Math.abs(car.fwdSpeed ?? car.speed ?? 0);

    // Guidance prompt on approach to pickup
    if (!j.pickedUp && this.mission.index === 0 && j.a) {
      const distA = Math.hypot(car.x - j.a.x, car.z - (j.a.y ?? j.a.z));
      if (distA < 16 && spd > 5.5) {
        this.hud.flash(j.kind === 'fare' ? '🛑 COME TO A STOP TO BOARD FARE' : '🛑 COME TO A STOP TO LOAD PACKAGE');
      }
    }

    // fares and packages want a real stop at the first marker, not a fly-through
    if (!j.pickedUp && this.mission.index === 1) {
      j.pickedUp = true;
      if (this.audio?.cash) this.audio.cash();
      this.hud.flash(j.kind === 'fare' ? 'PASSENGER ABOARD · DELIVER TO DESTINATION' : 'PACKAGE ABOARD · DELIVER TO DESTINATION');
      if (this.navigation && j.b) {
        this.navigation.setWaypoint(j.b.x, j.b.z !== undefined ? j.b.z : j.b.y);
        this.navigation.lastTarget = null;
      }
    }

    // Guidance on approach to dropoff
    if (j.b && (j.pickedUp || j.kind === 'getaway')) {
      const distB = Math.hypot(car.x - j.b.x, car.z - (j.b.y ?? j.b.z));
      const stars = this.traffic.wanted | 0;
      if (distB < 35) {
        if (j.kind === 'getaway' && stars > 0) {
          if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0xff3b30);
          this.hud.flash(`🚨 SAFE DROP LOCKED (${stars}★ HEAT)! EVADE COPS OR CALL PAY 'N' SPRAY [PHONE M]`);
        } else {
          if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0x2ecc71);
          if (distB < 14 && spd > 5.5) {
            this.hud.flash('🛑 COME TO A STOP INSIDE ZONE TO FINISH CONTRACT');
          }
        }
      }
    }

    if (j.limit < Infinity && j.t > j.limit * 1.6) this.fail('TOO LATE · JOB LOST');
    this.#show();
  }

  #finish() {
    const j = this.job; if (!j) return;
    const stars = this.traffic.wanted | 0;
    let pay = j.pay;
    if (j.kind === 'getaway' && stars > 0) {
      this.hud.flash(`🚨 STILL HOT (${stars}★)! EVADE COPS OR CALL PAY 'N' SPRAY [PHONE M]`);
      if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0xff3b30);
      this.mission.route([j.b], 'LOSE THE HEAT');
      return;
    }
    if (j.limit < Infinity && j.t > j.limit) pay = Math.round(pay * Math.max(0.3, 1 - (j.t - j.limit) / j.limit));
    pay = Math.round(pay * Math.max(0.2, 1 - stars * 0.2));
    if (stars === 0 && j.t < (j.limit === Infinity ? 1e9 : j.limit)) pay += 40;   // clean bonus
    if (typeof window !== 'undefined' && window._reputation) {
      if (window._reputation.score >= 80) pay = Math.round(pay * 1.25); // Bounty License perk bonus
      window._reputation.adjust(25, 'CIVIC CONTRACT COMPLETED');
    }
    this.cash += pay; this.done++;
    try { localStorage.setItem('hb.cash', String(this.cash)); localStorage.setItem('hb.jobs', String(this.done)); } catch { /* private mode */ }

    if (this.hud?.showVictoryBanner) {
      const sub = `${j.kind.toUpperCase()} CONTRACT · ${stars ? `${stars}★ HEAT PENALTY` : 'CLEAN RUN BONUS'}`;
      this.hud.showVictoryBanner('CONTRACT COMPLETE', sub, pay);
    } else {
      this.hud.flash(`PAID $${pay}${stars ? ` · ${stars}★ COST YOU` : ' · CLEAN'}`);
    }
    if (this.audio?.victoryFanfare) {
      this.audio.victoryFanfare();
    }
    if (this.navigation) this.navigation.clearWaypoint();
    this.job = null; this.#show();
  }


  persist() { try { localStorage.setItem('hb.cash', String(this.cash)); } catch { /* private mode */ } this.#show(); }

  fail(why) {
    if (!this.job) return;
    this.mission.stop(why);
    if (this.navigation) this.navigation.clearWaypoint();
    this.job = null; this.#show();
  }

  #show() {
    const j = this.job;
    const line = j ? `${j.kind.toUpperCase()} · $${j.pay}${j.limit < Infinity ? ` · ${Math.max(0, Math.round(j.limit - j.t))}s` : ''}` : `G — TAKE A JOB · ${this.done} DONE`;
    this.hud.setJob(`$${this.cash.toLocaleString()}   ${line}`);
  }
}

/** Is the car up on the pavement at speed? (pedestrians scatter) */
export function onPavementAtSpeed(car) {
  return Math.abs(car.fwdSpeed) > 8 && roadDepth(car.x, car.z) > 0.8;
}
