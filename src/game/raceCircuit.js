import * as THREE from 'three';
import {
  TRACK_CONTROL_POINTS,
  TRACK_CHECKPOINTS,
  GRID_SLOTS,
  START_FINISH,
  getSampledTrack,
  isRacewayArea,
  RACEWAY_ELEVATION,
} from '../world/raceTrack.js';
import { groundHeightAt } from '../world/metrics.js';

/**
 * RaceCircuit — Complete Multi-Lap Circuit Racing Manager for Halstead International Raceway.
 *
 * Manages:
 *  - Grid staging (player at pole, 5 AI rivals in staggered rows)
 *  - 3-2-1-GO! countdown with audio tones & overhead gantry start lights
 *  - 3-Lap racing with sector checkpoint tracking (anti-cut validation)
 *  - Dynamic standings calculation (P1 to P6)
 *  - Live lap timing, sector splits, and persistent best lap record in localStorage
 *  - Chequered flag finish, podium rankings, and cash purse settlement
 */

export const RACE_TOTAL_LAPS = 3;
export const PURSE = { 1: 12000, 2: 8000, 3: 5000, default: 2000 };

export class RaceCircuit {
  constructor(scene, hud, traffic, audio = null, garage = null) {
    this.scene = scene;
    this.hud = hud;
    this.traffic = traffic;
    this.audio = audio;
    this.garage = garage;

    this.state = 'idle'; // 'idle' | 'staging' | 'countdown' | 'racing' | 'finished'
    this.trackGroup = null;

    this.lap = 1;
    this.totalLaps = RACE_TOTAL_LAPS;
    this.lapStartTime = 0;
    this.currentLapTime = 0;
    this.bestLapTime = null;
    this.lastLapTime = null;
    this.totalRaceTime = 0;

    this.playerCpIndex = 0;
    this.playerClearedCount = 0;
    this.playerPlace = 1;
    this.fieldCount = 6;

    this.countdownTimer = 0;
    this.countdownSeconds = 3;

    this.circuitWaypoints = getSampledTrack(8); // dense path for AI rivals
    this.checkpoints = TRACK_CHECKPOINTS;
    this.rivals = [];

    // Load persistent best lap from storage
    try {
      const stored = localStorage.getItem('hb.track_best_lap');
      if (stored) this.bestLapTime = parseFloat(stored);
    } catch {
      /* private browsing */
    }
  }

  setTrackGroup(tg) {
    this.trackGroup = tg;
  }

  /** Formats seconds into MM:SS.cc */
  static formatTime(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.floor((sec * 100) % 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  /**
   * Stages a 3-lap circuit race: places player on pole position and spawns 5 rivals.
   * Starts the 3-2-1-GO! countdown.
   */
  startCircuitRace(car) {
    this.endRace();

    this.state = 'staging';
    this.lap = 1;
    this.currentLapTime = 0;
    this.totalRaceTime = 0;
    this.playerCpIndex = 0;
    this.playerClearedCount = 0;
    this.playerPlace = 1;

    // Ensure player is equipped with a high-performance track-ready vehicle
    if (this.garage && typeof this.garage.equipRaceCar === 'function') {
      const current = this.garage.fitted;
      const isRaceClass = ['s-porsche-gt3r', 's-corvette-c6r', 's-f40-comp', 's-corvette-zr1', 's-monza'].includes(current);
      if (!isRaceClass) {
        this.garage.equipRaceCar('s-porsche-gt3r');
        this.hud?.flash?.('🏁 RACEDAY: PORSCHE 992 GT3 R EQUIPPED!');
      }
    }

    // Position player car on pole position (Grid slot 1)
    const pole = GRID_SLOTS[0];
    car.x = pole.x;
    car.z = pole.z;
    car.y = groundHeightAt(pole.x, pole.z) + 0.35;
    car.yaw = pole.yaw;
    car.speed = 0;
    car.fwdSpeed = 0;
    car.yawRate = 0;
    car.steer = 0;
    car.brake = 1; // Hold on line during countdown

    // Spawn 5 AI rival cars on staggered grid slots
    this.rivals = [];
    const count = 5;
    if (this.traffic && typeof this.traffic.makeCar === 'function') {
      for (let i = 0; i < count; i++) {
        const slot = GRID_SLOTS[i + 1];
        const rival = this.traffic.makeCar();
        rival.live = true;
        rival.isRacer = true;
        rival.isCircuitRacer = true;
        if (rival.mesh) rival.mesh.visible = true;

        rival.x = slot.x;
        rival.z = slot.z;
        rival.yaw = slot.yaw;
        rival.speed = 0;
        rival.leg = 0;
        rival.lap = 1;
        rival.finished = false;
        // Skill spreads performance: 0.90 to 1.10
        rival.skill = 0.90 + (i / Math.max(1, count - 1)) * 0.20;
        rival.topSpeed = 37 * rival.skill; // ~133 km/h
        rival.clearedCount = 0;
        rival.style = rival.style || `Rival ${i + 1}`;

        if (rival.mesh) {
          rival.mesh.position?.set?.(rival.x, groundHeightAt(rival.x, rival.z), rival.z);
          if (rival.mesh.rotation) rival.mesh.rotation.y = rival.yaw;
        }
        this.rivals.push(rival);
      }
    }

    // Begin countdown
    this.state = 'countdown';
    this.countdownSeconds = 3;
    this.countdownTimer = 3.99;
    this.setGantryLights(3, false);
    this.audio?.countdownBeep?.(false);
    this.hud?.flash?.('🏁 CIRCUIT RACE STAGED · 3 LAPS');
  }

  setGantryLights(count, green = false) {
    if (this.trackGroup?.userData?.setLights) {
      this.trackGroup.userData.setLights(count, green);
    }
  }

  /** Aborts or cleans up active race */
  endRace() {
    this.state = 'idle';
    this.setGantryLights(0, false);
    for (const r of this.rivals) {
      r.live = false;
      r.isRacer = false;
      r.isCircuitRacer = false;
      if (r.mesh) r.mesh.visible = false;
    }
    this.rivals = [];
  }

  /** Called every game frame */
  update(dt, car) {
    if (this.state === 'idle') return;

    if (this.state === 'countdown') {
      this.#updateCountdown(dt, car);
      return;
    }

    if (this.state === 'racing') {
      this.#updateRacing(dt, car);
      this.#driveRivals(dt);
      this.#updateStandings(car);
      return;
    }

    if (this.state === 'finished') {
      this.#driveRivals(dt);
    }
  }

  #updateCountdown(dt, car) {
    // Hold car on start line
    car.speed = 0;
    car.fwdSpeed = 0;

    const prevSec = Math.ceil(this.countdownTimer);
    this.countdownTimer -= dt;
    const currSec = Math.ceil(this.countdownTimer);

    if (currSec !== prevSec && currSec >= 1) {
      this.setGantryLights(currSec, false);
      this.audio?.countdownBeep?.(false);
      this.hud?.flash?.(`GET READY · ${currSec}`);
    }

    if (this.countdownTimer <= 0) {
      // GREEN LIGHT! GO!
      this.state = 'racing';
      this.lap = 1;
      this.lapStartTime = performance.now() / 1000;
      this.currentLapTime = 0;
      this.totalRaceTime = 0;
      this.setGantryLights(0, true);
      this.audio?.countdownBeep?.(true);
      this.hud?.flash?.('🟢 GO! GO! GO! · LAP 1 / 3');

      // Clear green lights after 3 seconds
      setTimeout(() => this.setGantryLights(0, false), 3000);
    }
  }

  #updateRacing(dt, car) {
    this.totalRaceTime += dt;
    this.currentLapTime += dt;

    // Checkpoint progression & lap detection
    const cp = this.checkpoints[this.playerCpIndex];
    const distToCp = Math.hypot(car.x - cp.x, car.z - cp.z);

    if (distToCp < cp.radius) {
      this.playerClearedCount++;
      const nextIndex = (this.playerCpIndex + 1) % this.checkpoints.length;

      // Completed a full lap when looping from last checkpoint back to start/finish
      if (this.playerCpIndex === this.checkpoints.length - 1 && nextIndex === 0) {
        this.#onLapComplete(car);
      }

      this.playerCpIndex = nextIndex;
    }
  }

  #onLapComplete(car) {
    const lapTime = this.currentLapTime;
    this.lastLapTime = lapTime;
    this.currentLapTime = 0;

    const isBest = !this.bestLapTime || lapTime < this.bestLapTime;
    if (isBest) {
      this.bestLapTime = lapTime;
      try {
        localStorage.setItem('hb.track_best_lap', String(lapTime.toFixed(2)));
      } catch {
        /* private mode */
      }
    }

    if (this.lap < this.totalLaps) {
      this.lap++;
      const lapMsg = this.lap === this.totalLaps
        ? `🔔 FINAL LAP! · LAP ${this.lap}/${this.totalLaps} · ${RaceCircuit.formatTime(lapTime)}`
        : `LAP ${this.lap}/${this.totalLaps} · ${RaceCircuit.formatTime(lapTime)}${isBest ? ' (NEW BEST!)' : ''}`;
      this.hud?.flash?.(lapMsg);
      this.audio?.click?.();
    } else {
      // RACE FINISHED!
      this.#onRaceFinish();
    }
  }

  #onRaceFinish() {
    this.state = 'finished';
    this.audio?.raceFinishFanfare?.();

    const place = this.playerPlace;
    const prize = PURSE[place] ?? PURSE.default;
    if (this.garage?.addCash) {
      this.garage.addCash(prize, 'RACE PURSE');
    }

    const placeStr = place === 1 ? '🥇 1ST PLACE WINNER!' : place === 2 ? '🥈 2ND PLACE!' : place === 3 ? '🥉 3RD PLACE!' : `${place}TH PLACE`;
    this.hud?.flash?.(`🏁 ${placeStr} · +$${prize.toLocaleString()} · TIME ${RaceCircuit.formatTime(this.totalRaceTime)}`);
  }

  #driveRivals(dt) {
    const path = this.circuitWaypoints;
    const M = path.length;
    if (!path || !M || !this.rivals.length) return;

    for (const r of this.rivals) {
      if (!r.live) continue;

      // Advance along path
      let guard = 0;
      while (guard++ < 8) {
        const pt = path[r.leg % M];
        if (Math.hypot(pt.x - r.x, pt.z - r.z) < 16) {
          r.leg++;
          r.clearedCount++;
          // Check for rival lap completion
          if (r.leg >= M) {
            r.leg = r.leg % M;
            r.lap = (r.lap || 1) + 1;
            if (r.lap > this.totalLaps) {
              r.finished = true;
            }
          }
        } else {
          break;
        }
      }

      if (r.finished) {
        r.speed *= 0.96;
      } else {
        // Lookahead aim point
        const target = path[(r.leg + 1) % M];
        const lookahead = path[(r.leg + 3) % M];
        const aimX = target.x * 0.65 + lookahead.x * 0.35;
        const aimZ = target.z * 0.65 + lookahead.z * 0.35;

        // Speed regulation based on corner curvature
        const dx = target.x - r.x, dz = target.z - r.z;
        const targetYaw = Math.atan2(-dz, dx);
        let yawDiff = Math.abs(targetYaw - r.yaw);
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        yawDiff = Math.abs(yawDiff);

        // Slow down for heavy corners, accelerate on straights
        const speedCap = yawDiff > 0.4 ? 22 * r.skill : r.topSpeed;
        this.#steerToward(r, aimX, aimZ, dt, 0, speedCap);
      }

      r.mesh?.position?.set?.(r.x, groundHeightAt(r.x, r.z), r.z);
      if (r.mesh?.rotation) r.mesh.rotation.y = r.yaw;
    }
  }

  #steerToward(c, targetX, targetZ, dt, targetSpeed, speedCap) {
    const dx = targetX - c.x, dz = targetZ - c.z;
    const wantYaw = Math.atan2(-dz, dx);
    let dyaw = wantYaw - c.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;

    const steerRate = 3.2 * c.skill;
    c.yaw += Math.max(-steerRate * dt, Math.min(steerRate * dt, dyaw * 4.0));

    const accel = 12.0 * c.skill;
    if (c.speed < speedCap) {
      c.speed = Math.min(speedCap, c.speed + accel * dt);
    } else {
      c.speed = Math.max(speedCap, c.speed - 18.0 * dt);
    }

    c.x += Math.cos(c.yaw) * c.speed * dt;
    c.z += -Math.sin(c.yaw) * c.speed * dt;
  }

  #updateStandings(car) {
    // Score based on completed laps, cleared checkpoints, and distance to next checkpoint
    const nextCp = this.checkpoints[this.playerCpIndex];
    const playerDist = Math.hypot(car.x - nextCp.x, car.z - nextCp.z);
    const playerScore = (this.lap * 100000) + (this.playerClearedCount * 1000) - playerDist;

    const field = [{ who: 'YOU', score: playerScore }];

    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i];
      const rNext = this.circuitWaypoints[(r.leg + 1) % this.circuitWaypoints.length];
      const rDist = Math.hypot(r.x - rNext.x, r.z - rNext.z);
      const rScore = ((r.lap || 1) * 100000) + (r.clearedCount * 1000) - rDist;
      field.push({ who: r.style, score: rScore });
    }

    field.sort((a, b) => b.score - a.score);
    this.playerPlace = field.findIndex((f) => f.who === 'YOU') + 1;
  }

  /** Exposes race readout state for the HUD overlay. */
  getStatus(car) {
    const inArea = isRacewayArea(car.x, car.z);
    return {
      inRaceway: inArea,
      state: this.state,
      lap: this.lap,
      totalLaps: this.totalLaps,
      place: this.playerPlace,
      fieldCount: this.rivals.length + 1,
      currentLapTime: this.currentLapTime,
      lastLapTime: this.lastLapTime,
      bestLapTime: this.bestLapTime,
      totalRaceTime: this.totalRaceTime,
      countdown: Math.max(0, Math.ceil(this.countdownTimer)),
    };
  }
}
