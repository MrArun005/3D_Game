import * as THREE from 'three';
import { groundHeightAt } from '../world/metrics.js';

/**
 * Two reasons to shoot: a RANGE and a HOLD-OUT.
 *
 * Range: six boards at 15, 30 and 60 m in front of you, a timer, a score by
 * distance, and an accuracy readout. Zero stakes; it is where the weapons get
 * tuned and where a new player learns the recoil. Boards are a shared box
 * geometry, one mesh each, six draws, and they are removed when you leave.
 *
 * Hold-out: you pick the ground, the city comes to you. Wanted climbs half a
 * star every 40 s to a cap, the timer runs 180 s, and the score is officers
 * put down and seconds survived. It is the arcade mode and the test bed for
 * the police AI, because it produces a firefight on demand.
 *
 * The rules are pure and tested; the class glues them to a scene.
 */

export const RANGE_ROWS = [15, 30, 60];
export const RANGE_SECONDS = 60;
export const HOLDOUT_SECONDS = 180;
export const HOLDOUT_START_STARS = 2;
export const HOLDOUT_STEP_EVERY = 40;
export const HOLDOUT_MAX_STARS = 4.6;

/** Points for a board hit: farther is worth more, headshots are a board's top third. */
export function rangeScore(distance, high) {
  const base = distance >= 60 ? 30 : distance >= 30 ? 15 : 5;
  return high ? base * 2 : base;
}

/** Accuracy as a whole-number percentage; no shots is 0, not NaN. */
export function accuracy(hits, shots) {
  return shots > 0 ? Math.round((hits / shots) * 100) : 0;
}

/** Wanted level for a hold-out at elapsed seconds. */
export function holdoutWanted(elapsed) {
  return Math.min(HOLDOUT_MAX_STARS, HOLDOUT_START_STARS + Math.floor(elapsed / HOLDOUT_STEP_EVERY) * 0.5);
}

/** Hold-out score: seconds count, downed officers count more. */
export function holdoutScore(survivedS, downed) {
  return Math.round(survivedS) * 2 + downed * 50;
}

/** Rank the way arcade boards do it, so a score means something at a glance. */
export function rank(score, mode) {
  const bands = mode === 'range' ? [60, 140, 240, 360] : [200, 400, 650, 900];
  return score >= bands[3] ? 'S' : score >= bands[2] ? 'A' : score >= bands[1] ? 'B' : score >= bands[0] ? 'C' : 'D';
}

let BOARD = null;
function boardGeo() {
  if (BOARD) return BOARD;
  const g = new THREE.BoxGeometry(0.62, 1.7, 0.06);
  g.translate(0, 0.85, 0);            // stands on its base
  BOARD = g;
  return BOARD;
}

export class Modes {
  constructor(scene, hud, traffic) {
    this.scene = scene; this.hud = hud; this.traffic = traffic;
    this.active = null;                 // 'range' | 'holdout' | null
    this.t = 0; this.shots = 0; this.hits = 0; this.score = 0; this.downed = 0;
    this.boards = [];
    this.mat = new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.8 });
    this.hitMat = new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.8, emissive: 0x1a4a80, emissiveIntensity: 0.6 });
    this._t0 = 0;
  }

  /** Start the range: boards down-range along the player's facing. */
  startRange(x, z, yaw) {
    this.stop();
    this.active = 'range'; this.t = RANGE_SECONDS; this.shots = 0; this.hits = 0; this.score = 0;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), sx = Math.cos(yaw + Math.PI / 2), sz = -Math.sin(yaw + Math.PI / 2);
    for (const d of RANGE_ROWS) {
      for (const side of [-1, 1]) {
        const bx = x + fx * d + sx * side * 1.6, bz = z + fz * d + sz * side * 1.6;
        const m = new THREE.Mesh(boardGeo(), this.mat);
        m.position.set(bx, groundHeightAt(bx, bz), bz);
        m.rotation.y = yaw + Math.PI / 2;
        m.castShadow = true;
        m.userData.range = { d, hitT: 0 };
        this.scene.add(m);
        this.boards.push(m);
      }
    }
    this.hud.flash?.('RANGE · 60 s · boards at 15 / 30 / 60 m');
  }

  /** Start a hold-out where you stand. The wanted ramp does the rest. */
  startHoldout() {
    this.stop();
    this.active = 'holdout'; this.t = HOLDOUT_SECONDS; this.shots = 0; this.hits = 0; this.score = 0; this.downed = 0;
    this._elapsed = 0; this._wave = 1;
    if (this.traffic) this.traffic.wanted = Math.max(this.traffic.wanted, HOLDOUT_START_STARS);
    this.hud.flash?.('HOLD OUT · 3 minutes · they are coming');
  }

  stop() {
    for (const b of this.boards) this.scene.remove(b);
    this.boards.length = 0;
    if (this.active) {
      let best = 0;
      try { best = +(localStorage.getItem('hb.best.' + this.active) || 0); if (this.score > best) { best = this.score; localStorage.setItem('hb.best.' + this.active, String(best)); } } catch { /* private mode */ }
      this.hud.flash?.(`${this.active.toUpperCase()} OVER · ${this.score} pts · rank ${rank(this.score, this.active)}${best === this.score ? ' · NEW BEST' : ` · best ${best}`}`);
      this.justEnded = true;
    }
    this.active = null;
  }

  /** Range boards as weapon targets; kind 'target' so the crime report ignores them. */
  targets(out) {
    if (this.active !== 'range') return;
    for (const b of this.boards) {
      out.push({ x: b.position.x, z: b.position.z, y: b.position.y + 0.85, r: 0.55, kind: 'target', ref: b });
    }
  }

  /** Called by the trigger for every shot; `hit` is what the weapon reported. */
  onShot(hit, hitY = 0) {
    if (!this.active) return;
    this.shots++;
    if (this.active === 'range' && hit?.kind === 'target') {
      const b = hit.ref, info = b.userData.range;
      this.hits++;
      const high = hitY > b.position.y + 1.25;
      this.score += rangeScore(info.d, high);
      info.hitT = 0.25;
      b.material = this.hitMat;
    } else if (this.active === 'holdout' && hit && hit.kind !== 'target') {
      this.hits++;
    }
  }

  /** traffic.officerHit() result plumbing: an officer went down. */
  onOfficerDown() { if (this.active === 'holdout') { this.downed++; this.score = holdoutScore(this._elapsed, this.downed); } }

  update(dt) {
    if (!this.active) return;
    this.t -= dt;
    for (const b of this.boards) {
      const info = b.userData.range;
      if (info.hitT > 0) { info.hitT -= dt; if (info.hitT <= 0) b.material = this.mat; }
    }
    if (this.active === 'holdout') {
      this._elapsed += dt;
      const want = holdoutWanted(this._elapsed);
      if (this.traffic) this.traffic.wanted = Math.max(this.traffic.wanted, want);
      const wave = 1 + Math.floor(this._elapsed / HOLDOUT_STEP_EVERY);
      if (wave !== this._wave) { this._wave = wave; if (wave > 1) this.hud.flash?.(`WAVE ${wave} · ${want}★ · ${Math.ceil(this.t)} s left`); }
      this.score = holdoutScore(this._elapsed, this.downed);
    }
    if (this.t <= 0) this.stop();
  }

  /** One line for the HUD. */
  line() {
    if (!this.active) return null;
    const s = Math.max(0, Math.ceil(this.t));
    return this.active === 'range'
      ? `RANGE ${s}s · ${this.score} pts · ${accuracy(this.hits, this.shots)}% · ${this.hits}/${this.shots}`
      : `HOLD OUT ${s}s · ${this.score} pts · ${this.downed} down`;
  }

  dispose() { this.stop(); this.mat.dispose(); this.hitMat.dispose(); BOARD?.dispose(); BOARD = null; }
}
