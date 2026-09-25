/**
 * Street skill (2026-09-25): the moment-to-moment reward loop.
 *
 * GTA pays you for missions; Burnout and Midnight Club pay you for DRIVING.
 * This is the second kind, and it is what makes an aimless cruise feel good:
 *   - NEAR MISS: threading past a car within ~2 m, fast, without touching it
 *   - DRIFT:     holding a slide (slip angle past ~16 deg) at speed; points
 *                grow with angle, speed and time
 *   - COMBO:     every trick in a chain raises the multiplier (x1 .. x5)
 * The chain BANKS as cash 2.5 s after the last trick; a crash WIPES whatever
 * is unbanked. Risk, then relief -- the loop that keeps you driving.
 *
 * Pure: no DOM, no three. `update()` takes plain numbers and returns events
 * for main.js to show and pay. Tested in test/skill.test.js.
 *
 * Conventions (from main.js's horn code): the car's forward is
 * (cos yaw, -sin yaw) in XZ; lateral = -sin(yaw)*dx - cos(yaw)*dz.
 */

export const SKILL = {
  nearDist: 2.3,        // lateral clearance that counts as a near miss (m, between centres minus half widths ~ 1.1 m of air)
  nearAlong: 3.2,       // and within this along the car's heading (m): it is beside you, not ahead
  nearMinKmh: 60,
  nearPoints: 120,
  driftSlip: 0.28,      // rad (~16 deg) of slip before a slide counts
  driftMinKmh: 40,
  driftRate: 260,       // points per second at 1 rad of slip and 100 km/h
  bankAfter: 2.5,       // s of calm before the chain banks
  maxMult: 5,
  crashImpact: 2.4,     // car.impact above this is a crash: the chain is lost
  cashPerPoint: 0.1,    // $ per point: a tidy 30 s run pays a few hundred dollars
};

export function createSkill(cfg = SKILL) {
  const s = {
    chain: 0,          // unbanked points
    mult: 1,
    calm: 0,           // seconds since the last trick
    drifting: false,
    driftPts: 0,
    driftT: 0,
    passed: new Set(),   // cars already counted while beside you
    beside: new Set(),
  };

  /**
   * @param {object} car      { x, z, yaw, vx, vz, impact }
   * @param {Array}  others   [{ id, x, z }] live traffic
   * @param {number} dt
   * @returns {Array} events: { kind: 'near'|'drift'|'bank'|'lost', pts, mult, total?, cash? }
   */
  function update(car, others, dt) {
    const ev = [];
    const kmh = Math.hypot(car.vx || 0, car.vz || 0) * 3.6;
    const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);

    // a crash takes the unbanked chain
    if ((car.impact || 0) > cfg.crashImpact && (s.chain > 0 || s.driftPts > 0)) {
      ev.push({ kind: 'lost', pts: Math.round(s.chain + s.driftPts), mult: s.mult });
      s.chain = 0; s.mult = 1; s.calm = 0; s.drifting = false; s.driftPts = 0; s.driftT = 0;
      return ev;
    }

    // near misses: a car enters the beside-you window and leaves it without contact
    const nowBeside = new Set();
    if (kmh >= cfg.nearMinKmh) {
      for (const o of others) {
        const key = o.id ?? o;   // traffic cars are their own id
        const dx = o.x - car.x, dz = o.z - car.z;
        const along = dx * fx + dz * fz;
        const latS = -Math.sin(car.yaw) * dx - Math.cos(car.yaw) * dz, lat = Math.abs(latS);   // signed: + is the car's left
        if (Math.abs(along) < cfg.nearAlong && lat < cfg.nearDist + 1.9) nowBeside.add(key);
        if (Math.abs(along) < cfg.nearAlong && lat < cfg.nearDist && !s.passed.has(key)) {
          s.passed.add(key);
          const pts = cfg.nearPoints * (1 + Math.max(0, (kmh - cfg.nearMinKmh) / 60));
          s.chain += pts; s.mult = Math.min(cfg.maxMult, s.mult + 1); s.calm = 0;
          ev.push({ kind: 'near', pts: Math.round(pts), mult: s.mult, side: Math.sign(latS) || 1 });
        }
      }
    }
    for (const id of s.passed) if (!nowBeside.has(id)) s.passed.delete(id);   // gone past: it may count again next time

    // drift: slip between where the car points and where it goes
    const v = Math.hypot(car.vx || 0, car.vz || 0);
    let slip = 0;
    if (v > 0.5) {
      const c = Math.max(-1, Math.min(1, ((car.vx || 0) * fx + (car.vz || 0) * fz) / v));
      slip = Math.acos(c);
      if (slip > Math.PI / 2) slip = 0;   // rolling backwards is reversing, not drifting
    }
    if (slip > cfg.driftSlip && kmh > cfg.driftMinKmh) {
      if (!s.drifting) { s.drifting = true; s.driftPts = 0; s.driftT = 0; }
      s.driftT += dt;
      s.driftPts += cfg.driftRate * slip * (kmh / 100) * dt;
      s.calm = 0;
    } else if (s.drifting) {
      s.drifting = false;
      if (s.driftT > 0.6 && s.driftPts > 40) {
        s.chain += s.driftPts; s.mult = Math.min(cfg.maxMult, s.mult + 1);
        ev.push({ kind: 'drift', pts: Math.round(s.driftPts), mult: s.mult, secs: +s.driftT.toFixed(1) });
      }
      s.driftPts = 0; s.driftT = 0;
    }

    // calm banks the chain
    if (s.chain > 0 && !s.drifting) {
      s.calm += dt;
      if (s.calm >= cfg.bankAfter) {
        const total = Math.round(s.chain * s.mult);
        ev.push({ kind: 'bank', pts: Math.round(s.chain), mult: s.mult, total, cash: Math.max(1, Math.round(total * cfg.cashPerPoint)) });
        s.chain = 0; s.mult = 1; s.calm = 0;
      }
    }
    return ev;
  }

  /** What the HUD shows while a chain is live: null when idle. */
  function live() {
    const pts = s.chain + (s.drifting ? s.driftPts : 0);
    if (pts <= 0) return null;
    return { pts: Math.round(pts), mult: s.mult, drifting: s.drifting, bankIn: Math.max(0, SKILL.bankAfter - s.calm) };
  }

  return { update, live, state: s };
}
