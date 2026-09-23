import * as THREE from 'three';
import { Recorder } from './recorder.js';
import { ARSENAL, WEAPON_KINDS } from './weapons.js';

/**
 * FeatureTour: Automated cinematic demo that tours every core feature of Halstead Bay
 * and records the full canvas session straight to a high-definition WebM video file.
 */
export class FeatureTour {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.active = false;
    this.stageIdx = 0;
    this.stageTime = 0;
    this.totalTime = 0;
    this.recorder = null;
    this.overlay = null;
    this.fireTimer = 0;
    this.tankRef = null;

    this.stages = [
      {
        id: 'tokyo_spawn',
        badge: 'SCENE 1 / 8',
        title: '🏮 LITTLE TOKYO & GRAND TORII GATEWAY ARCH',
        desc: 'Spawning on Tokyo Street (Road 168) looking through the 27m illuminated Grand Torii Arch',
        duration: 7.0,
        enter: (c) => {
          c.warp(2351.5, 1356.0, -Math.PI / 2 - 0.03);
          c.car.throttle = 0; c.car.brake = 1; c.car.vx = 0; c.car.vz = 0;
          c.car.headlights = true;
          c.car.headlightMode = 'low';
          c.chase.recentre();
        },
        update: (t, dt, c) => {
          c.car.throttle = 0; c.car.brake = 1;
          // Smooth slow camera pan around car and Torii arch
          c.chase.lookYaw = Math.sin(t * 0.7) * 0.35;
          c.chase.lookPitch = 0.08 + Math.sin(t * 0.5) * 0.06;
          c.chase.looking = true;
        },
      },
      {
        id: 'headlights',
        badge: 'SCENE 2 / 8',
        title: '💡 DUAL-STAGE LED HEADLIGHTS & RALLY PROJECTORS',
        desc: '1800cd Low Beam road footprint transitioning to 3600cd High-Beam rally projectors',
        duration: 6.5,
        enter: (c) => {
          c.chase.recentre();
          c.car.headlights = true;
          c.car.headlightMode = 'low';
        },
        update: (t, dt, c) => {
          c.car.throttle = 0; c.car.brake = 1;
          if (t > 1.8 && c.car.headlightMode === 'low') {
            c.car.headlightMode = 'high';
            c.hud?.flash?.('HEADLIGHTS · HIGH BEAM 🔆');
          }
          if (t > 4.8 && c.car.headlightMode === 'high') {
            c.car.headlightMode = 'low';
            c.hud?.flash?.('HEADLIGHTS · LOW BEAM 💡');
          }
          c.chase.lookPitch = -0.05;
        },
      },
      {
        id: 'tokyo_drive',
        badge: 'SCENE 3 / 8',
        title: '🏎️ TOKYO STREET LIFE & PROCEDURAL ARCHITECTURE',
        desc: 'Cruising through the Torii Arch past 77 custom Tokyo walk-ups, kanban banners & vending machines',
        duration: 8.5,
        enter: (c) => {
          c.chase.recentre();
          c.car.headlightMode = 'high';
          c.car.brake = 0;
          c.car.throttle = 1;
        },
        update: (t, dt, c) => {
          c.car.throttle = 0.85;
          c.car.brake = 0;
          c.chase.looking = false;
        },
      },
      {
        id: 'bridge_physics',
        fullMap: true,   // the lift bridge is outside the compact city (world/playArea.js): start() skips this scene there
        badge: 'SCENE 4 / 8',
        title: '🌉 HALSTEAD LIFT BRIDGE · ELEVATED PHYSICS & PARAPETS',
        desc: 'Continuous 7.6m river deck, smooth 62m approach ramp & solid collision parapet walls',
        duration: 9.5,
        enter: (c) => {
          c.warp(1938, 2275, 0.06);
          c.chase.recentre();
          c.car.throttle = 1;
          c.car.brake = 0;
        },
        update: (t, dt, c) => {
          c.car.throttle = 0.88;
          c.car.brake = 0;
          // Slight steering deflection against parapet wall
          if (t > 4.0 && t < 5.5) {
            c.car.steerTarget = -0.15;
          } else {
            c.car.steerTarget = 0;
          }
        },
      },
      {
        id: 'on_foot',
        badge: 'SCENE 5 / 8',
        title: '🏃 THIRD-PERSON ON-FOOT ATHLETICS & EXPLORATION',
        desc: 'Fluid third-person character locomotion, sprint strides, jumping and physical combat',
        duration: 7.5,
        enter: (c) => {
          c.stepOutOfVehicle();
          c.chase.recentre();
        },
        update: (t, dt, c) => {
          if (c.onFoot?.active) {
            // Sprint forward and jump
            c.onFoot.sprint = t > 2.0;
            if (t > 3.0 && t < 3.2 && c.onFoot.character?.jump) {
              c.onFoot.character.jump();
            }
            if (t > 4.5 && t < 5.0 && c.onFoot.character?.punch) {
              c.onFoot.character.punch();
            }
          }
        },
      },
      {
        id: 'arsenal',
        badge: 'SCENE 6 / 8',
        title: '🔫 ARSENAL WEAPONS & RECOIL BALLISTICS',
        desc: 'Rapid-fire pistol, buckshot spread, assault rifle bursts and explosive grenade arcs',
        duration: 9.5,
        enter: (c) => {
          c.equipWeapon('pistol');
          this.fireTimer = 0;
        },
        update: (t, dt, c) => {
          this.fireTimer -= dt;
          if (t < 2.5) {
            if (this.fireTimer <= 0) {
              this.fireTimer = 0.35;
              c.fireWeapon();
            }
          } else if (t < 5.0) {
            if (c.weapon?.kind !== 'shotgun') c.equipWeapon('shotgun');
            if (this.fireTimer <= 0) {
              this.fireTimer = 0.75;
              c.fireWeapon();
            }
          } else if (t < 7.5) {
            if (c.weapon?.kind !== 'rifle') c.equipWeapon('rifle');
            if (this.fireTimer <= 0) {
              this.fireTimer = 0.12;
              c.fireWeapon();
            }
          } else {
            if (this.fireTimer <= 0) {
              this.fireTimer = 999;
              c.throwGrenade();
            }
          }
        },
      },
      {
        id: 'tank',
        badge: 'SCENE 7 / 8',
        title: '🛡️ WARSTOCK 55-TON HEAVY RHINO TANK',
        desc: 'Twin-track skid steering, heavy armor plating and devastating 120mm cannon blasts',
        duration: 9.0,
        enter: (c) => {
          this.tankRef = c.spawnAndEnterTank();
          this.fireTimer = 1.5;
        },
        update: (t, dt, c) => {
          this.fireTimer -= dt;
          if (this.tankRef && c.activeVehicle === this.tankRef) {
            // Skid steering pivot
            if (t < 3.5) {
              this.tankRef.steer = 0.8;
              this.tankRef.throttle = 0.3;
            } else {
              this.tankRef.steer = 0;
              this.tankRef.throttle = 0.6;
            }
            if (this.fireTimer <= 0) {
              this.fireTimer = 3.2;
              this.tankRef.fireCannon?.();
              c.hud?.flash?.('TANK 120MM CANNON FIRED 💥');
            }
          }
        },
      },
      {
        id: 'phone_finish',
        badge: 'SCENE 8 / 8',
        title: '📱 iFRUIT SMARTPHONE & GPS NAVIGATION',
        desc: 'Live street navigation, arsenal deliveries, instant warps and mission dispatcher',
        duration: 5.5,
        enter: (c) => {
          c.stepOutOfVehicle();
          c.phone?.toggle?.(true);
          c.hud?.flash?.('iFRUIT SMARTPHONE OPEN');
        },
        update: (t, dt, c) => {
          // Keep phone open briefly
        },
      },
    ];
  }

  start() {
    if (this.active) return;
    /* The compact city (world/playArea.js) has no lift bridge: the scene that
       warps there is skipped and the rest run as they are (every other warp is
       Little Tokyo). ctx.compact wins; otherwise the loaded district says. Record
       the full eight with ?fullmap. */
    this.allStages ??= this.stages;
    const compact = this.ctx.compact ?? (typeof window !== 'undefined' && !!window.district?.play);
    this.stages = compact ? this.allStages.filter((s) => !s.fullMap) : this.allStages;
    /* The badges were literals ('SCENE 5 / 8'), so the seven-scene compact tour
       counted 1, 2, 3, 5 ... of 8. Numbered from the list that actually plays;
       copies, so the full table keeps its own. */
    if (this.stages !== this.allStages) this.stages = this.stages.map((s, i, all) => ({ ...s, badge: `SCENE ${i + 1} / ${all.length}` }));
    this.active = true;
    this.stageIdx = 0;
    this.stageTime = 0;
    this.totalTime = 0;
    this.fireTimer = 0;

    // Start video recorder
    const canvas = this.ctx.canvas || (typeof document !== 'undefined' ? document.querySelector('canvas') : null);
    if (canvas && Recorder.supported()) {
      try {
        this.recorder = new Recorder(canvas, { fps: 30, bitrate: 14_000_000 });
        this.recorder.start();
        console.info('FeatureTour: Recorder started capturing canvas at 30 FPS');
      } catch (e) {
        console.warn('FeatureTour: Recorder could not start:', e.message);
        this.recorder = null;
      }
    }

    if (typeof document !== 'undefined') {
      this.#createOverlay();
    }
    this.#enterStage(0);
    this.ctx.hud?.flash?.('🎬 FEATURE TOUR DEMO STARTED · RECORDING ACTIVE');
  }

  stop({ download = true } = {}) {
    if (!this.active) return;
    this.active = false;
    this.#removeOverlay();

    if (this.ctx.phone?.open) {
      this.ctx.phone.toggle(false);
    }

    // Stop recorder and trigger download
    if (this.recorder) {
      this.recorder.stop().then((blob) => {
        if (blob && download) {
          Recorder.download(blob, 'halstead-bay-all-features-tour.webm');
          console.info('FeatureTour: Video recording downloaded successfully');
        }
      }).catch((e) => console.warn('FeatureTour: stop error:', e));
      this.recorder = null;
    }

    // Return car to Little Tokyo spawn
    this.ctx.warp?.(2351.5, 1356.0, -Math.PI / 2 - 0.03);
    this.ctx.hud?.flash?.('🎬 FEATURE TOUR COMPLETE · VIDEO DOWNLOADED! 🏮');
  }

  applyInput(inputState, dt) {
    if (!this.active || !inputState) return;
    const stage = this.stages[this.stageIdx];
    if (!stage) return;
    const t = this.stageTime;

    switch (stage.id) {
      case 'tokyo_spawn':
      case 'headlights':
        inputState.throttle = 0;
        inputState.brake = 1;
        inputState.handbrake = 1;
        inputState.steer = 0;
        break;
      case 'tokyo_drive':
        inputState.throttle = 0.85;
        inputState.brake = 0;
        inputState.handbrake = 0;
        inputState.steer = 0;
        break;
      case 'bridge_physics':
        inputState.throttle = 0.88;
        inputState.brake = 0;
        inputState.handbrake = 0;
        inputState.steer = (t > 4.0 && t < 5.5) ? -0.15 : 0;
        break;
      case 'on_foot':
        inputState.throttle = 1;
        inputState.brake = 0;
        inputState.hold = t > 2.0;
        inputState.handbrake = (t > 3.0 && t < 3.2) ? 1 : 0;
        inputState.steer = 0;
        break;
      case 'arsenal':
        inputState.throttle = 0;
        inputState.brake = 0;
        inputState.steer = 0;
        break;
      case 'tank':
        inputState.steer = (t < 3.5) ? 0.8 : 0;
        inputState.throttle = (t < 3.5) ? 0.3 : 0.6;
        inputState.brake = 0;
        break;
      case 'phone_finish':
        inputState.throttle = 0;
        inputState.brake = 1;
        inputState.steer = 0;
        break;
    }
  }

  update(dt) {
    if (!this.active) return;
    const stage = this.stages[this.stageIdx];
    if (!stage) {
      this.stop();
      return;
    }

    this.stageTime += dt;
    this.totalTime += dt;

    if (stage.update) {
      stage.update(this.stageTime, dt, this.ctx);
    }

    this.#updateOverlay();

    if (this.stageTime >= stage.duration) {
      this.stageIdx++;
      if (this.stageIdx < this.stages.length) {
        this.#enterStage(this.stageIdx);
      } else {
        this.stop();
      }
    }
  }

  #enterStage(idx) {
    this.stageIdx = idx;
    this.stageTime = 0;
    const stage = this.stages[idx];
    if (!stage) return;
    if (stage.enter) {
      stage.enter(this.ctx);
    }
    this.#updateOverlay();
  }

  #createOverlay() {
    if (this.overlay || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'tour-recorder-banner';
    el.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(10, 14, 24, 0.88);
      border: 1px solid rgba(0, 240, 255, 0.45);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 24px rgba(0, 240, 255, 0.2);
      backdrop-filter: blur(12px);
      border-radius: 12px;
      padding: 10px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      z-index: 9999;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-width: 360px;
      max-width: 90vw;
      transition: all 0.3s ease;
    `;
    el.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:10px; height:10px; border-radius:50%; background:#ff0055; box-shadow:0 0 10px #ff0055; animation:blink 1s infinite alternate;"></div>
          <span style="color:#ff0055; font-weight:900; font-size:11px; letter-spacing:1px;">REC · FEATURE TOUR</span>
        </div>
        <span id="tour-timer" style="color:#00f0ff; font-weight:800; font-size:12px; font-variant-numeric:tabular-nums;">00:00 / 00:59</span>
      </div>
      <div id="tour-title" style="color:#ffffff; font-weight:900; font-size:14px; text-shadow:0 0 12px rgba(255,255,255,0.4); text-align:center;">
        LOADING FEATURE TOUR...
      </div>
      <div id="tour-desc" style="color:#a0b0c0; font-size:11px; text-align:center;">
        Capturing showcase gameplay...
      </div>
    `;
    if (!document.getElementById('tour-style')) {
      const st = document.createElement('style');
      st.id = 'tour-style';
      st.textContent = '@keyframes blink { from { opacity: 0.3; } to { opacity: 1; } }';
      document.head.appendChild(st);
    }
    document.body.appendChild(el);
    this.overlay = el;
  }

  #updateOverlay() {
    if (!this.overlay) return;
    const stage = this.stages[this.stageIdx];
    if (!stage) return;

    const titleEl = this.overlay.querySelector('#tour-title');
    const descEl = this.overlay.querySelector('#tour-desc');
    const timerEl = this.overlay.querySelector('#tour-timer');

    if (titleEl) titleEl.textContent = stage.title;
    if (descEl) descEl.textContent = stage.desc;
    if (timerEl) {
      const sec = Math.floor(this.totalTime);
      const totalSec = Math.floor(this.stages.reduce((a, s) => a + s.duration, 0));
      const pad = (n) => String(n).padStart(2, '0');
      timerEl.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)} / ${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`;
    }
  }

  #removeOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
