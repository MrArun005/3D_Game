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
  constructor(mission, traffic, hud, district) {
    this.mission = mission; this.traffic = traffic; this.hud = hud; this.district = district;
    this.cash = Number(localStorage.getItem('hb.cash') || 0);
    this.done = Number(localStorage.getItem('hb.jobs') || 0);
    this.job = null;
    this.nodes = district.graph.nodes.filter((n) => n.kind === 'cross' || n.kind === 'tee');
    mission.onFinish = (t) => this.#finish(t);
    this.#show();
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
    if (this.job) { this.mission.stop('JOB ABANDONED'); this.job = null; this.#show(); return; }
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
    this.mission.route([a, b], kind === 'fare' ? 'PICK UP THE FARE' : kind === 'getaway' ? 'LOSE THE HEAT · REACH THE DROP' : 'COLLECT THE PACKAGE');
    if (kind === 'getaway') this.traffic.reportCrime('police', 6);
    this.hud.flash(`${kind.toUpperCase()} · $${pay}${limit < Infinity ? ` · ${Math.round(limit)}s` : ''}`);
    this.#show();
  }

  update(car, dt) {
    const j = this.job; if (!j) return;
    j.t += dt;
    // fares and packages want a real stop at the first marker, not a fly-through
    if (!j.pickedUp && this.mission.index === 1) {
      j.pickedUp = true;
      this.hud.flash(j.kind === 'fare' ? 'PASSENGER ABOARD · DROP THEM OFF' : 'PACKAGE ABOARD · DELIVER IT');
    }
    if (j.limit < Infinity && j.t > j.limit * 1.6) this.fail('TOO LATE · JOB LOST');
    this.#show();
  }

  #finish() {
    const j = this.job; if (!j) return;
    const stars = this.traffic.wanted | 0;
    let pay = j.pay;
    if (j.kind === 'getaway' && stars > 0) { this.hud.flash('STILL HOT · LOSE THE POLICE FIRST'); this.mission.route([j.b], 'LOSE THE HEAT'); return; }
    if (j.limit < Infinity && j.t > j.limit) pay = Math.round(pay * Math.max(0.3, 1 - (j.t - j.limit) / j.limit));
    pay = Math.round(pay * Math.max(0.2, 1 - stars * 0.2));
    if (stars === 0 && j.t < (j.limit === Infinity ? 1e9 : j.limit)) pay += 40;   // clean bonus
    this.cash += pay; this.done++;
    try { localStorage.setItem('hb.cash', String(this.cash)); localStorage.setItem('hb.jobs', String(this.done)); } catch { /* private mode */ }
    this.hud.flash(`PAID $${pay}${stars ? ` · ${stars}★ COST YOU` : ' · CLEAN'}`);
    this.job = null; this.#show();
  }

  persist() { try { localStorage.setItem('hb.cash', String(this.cash)); } catch { /* private mode */ } this.#show(); }

  fail(why) {
    if (!this.job) return;
    this.mission.stop(why);
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
