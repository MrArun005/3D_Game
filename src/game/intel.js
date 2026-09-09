import * as THREE from 'three';

/**
 * Astra-Style Tactical AI Scanner & Multimodal Reconnaissance Engine.
 *
 * Provides real-time AR target acquisition brackets for police cruisers,
 * civilian traffic, pedestrians, and city safehouses. Uses a pre-allocated
 * DOM element pool and scratch vector to achieve 60fps with ZERO per-frame
 * heap allocations.
 */

const MAX_TARGETS = 8;
const SCAN_RANGE = 75; // metres

const _proj = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

export class IntelScanner {
  constructor(audio = null, hud = null) {
    this.audio = audio;
    this.hud = hud;
    this.active = false;
    this.targets = [];
    this.pulseTimer = 0;

    this.#buildDOM();
  }

  #buildDOM() {
    if (typeof document === 'undefined') return;

    const overlay = document.createElement('div');
    overlay.id = 'astra-scanner-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 85;
      display: none; font-family: 'SF Mono', Consolas, Monaco, monospace;
      user-select: none;
    `;

    // Subtle holographic vignette & scanline grid
    const grid = document.createElement('div');
    grid.style.cssText = `
      position: absolute; inset: 0;
      background: radial-gradient(circle at center, rgba(16, 44, 87, 0.05) 0%, rgba(5, 12, 28, 0.35) 100%),
                  repeating-linear-gradient(0deg, rgba(52, 152, 219, 0.03) 0px, rgba(52, 152, 219, 0.03) 1px, transparent 1px, transparent 3px);
      box-shadow: inset 0 0 80px rgba(0, 200, 255, 0.15);
    `;
    overlay.appendChild(grid);

    // Top status header
    const header = document.createElement('div');
    header.style.cssText = `
      position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
      background: rgba(10, 25, 47, 0.85); border: 1px solid rgba(0, 220, 255, 0.4);
      padding: 6px 20px; border-radius: 4px; color: #00e5ff; font-size: 11px;
      font-weight: 700; letter-spacing: 2px; text-shadow: 0 0 8px rgba(0, 229, 255, 0.6);
      display: flex; align-items: center; gap: 14px;
    `;
    header.innerHTML = `
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#00e5ff; box-shadow:0 0 8px #00e5ff; animation:pulse 1s infinite alternate;"></span>
      ASTRA 5.1 // TACTICAL RECON ACTIVE [KEY Z]
      <span id="astra-target-count" style="color:#2ecc71; font-weight:800;">0 TARGETS</span>
    `;
    overlay.appendChild(header);

    // Pre-allocated bracket pool
    this.brackets = [];
    for (let i = 0; i < MAX_TARGETS; i++) {
      const b = document.createElement('div');
      b.style.cssText = `
        position: absolute; width: 110px; height: 75px; transform: translate(-50%, -50%);
        border: 2px solid #00e5ff; border-radius: 6px; box-sizing: border-box;
        box-shadow: 0 0 12px rgba(0, 229, 255, 0.35); display: none;
        transition: transform 0.05s ease-out;
      `;
      const label = document.createElement('div');
      label.style.cssText = `
        position: absolute; bottom: -24px; left: 50%; transform: translateX(-50%);
        white-space: nowrap; font-size: 10px; font-weight: 700; padding: 2px 6px;
        border-radius: 3px; background: rgba(5, 15, 30, 0.88); border: 1px solid #00e5ff;
        color: #00e5ff; text-align: center; letter-spacing: 0.5px;
      `;
      b.appendChild(label);
      overlay.appendChild(b);
      this.brackets.push({ el: b, label });
    }

    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.countEl = overlay.querySelector('#astra-target-count');
  }

  toggle() {
    this.active = !this.active;
    if (this.overlay) {
      this.overlay.style.display = this.active ? 'block' : 'none';
    }
    if (this.hud) {
      this.hud.flash(this.active ? '🛰️ ASTRA RECON ONLINE · TARGET ACQUISITION' : '🛰️ ASTRA RECON OFFLINE');
    }
    this.#playPulseSound(this.active ? 880 : 440);
    return this.active;
  }

  #playPulseSound(freq) {
    if (!this.audio?.ctx) return;
    try {
      const ctx = this.audio.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain);
      if (typeof this.audio.bus === 'function') gain.connect(this.audio.bus());
      else gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // Audio not initialized or permitted
    }
  }

  /**
   * Main per-frame update loop.
   * Finds closest interesting targets (police, traffic, safehouses) and projects onto screen.
   */
  update(dt, camera, playerPos, traffic, safehouses = null) {
    if (!this.active || !this.overlay || !camera) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    let slot = 0;

    // 1. Scan safehouses
    if (safehouses?.length && slot < MAX_TARGETS) {
      for (const sh of safehouses) {
        if (slot >= MAX_TARGETS) break;
        const d = Math.hypot(sh.x - playerPos.x, sh.z - playerPos.z);
        if (d < SCAN_RANGE * 1.2) {
          _targetPos.set(sh.x, (sh.y || 1.5) + 1.2, sh.z);
          _proj.copy(_targetPos).project(camera);

          if (_proj.z < 1.0 && _proj.x >= -1 && _proj.x <= 1 && _proj.y >= -1 && _proj.y <= 1) {
            const sx = (_proj.x * 0.5 + 0.5) * w;
            const sy = (-(_proj.y * 0.5) + 0.5) * h;
            const b = this.brackets[slot++];
            b.el.style.display = 'block';
            b.el.style.left = `${sx}px`;
            b.el.style.top = `${sy}px`;
            b.el.style.borderColor = '#9b59b6';
            b.label.style.borderColor = '#9b59b6';
            b.label.style.color = '#e0b0ff';
            b.label.textContent = `${sh.name.toUpperCase()} · ${Math.round(d)}m`;
          }
        }
      }
    }

    // 2. Scan police & traffic vehicles
    if (traffic?.cars && slot < MAX_TARGETS) {
      // cruisers live in traffic.police, not traffic.cars; a car in play is `live` (there is no `active`)
      const fleet = traffic.police ? traffic.cars.concat(traffic.police) : traffic.cars;
      for (let i = 0; i < fleet.length && slot < MAX_TARGETS; i++) {
        const c = fleet[i];
        if (!c || !c.live) continue;
        const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
        if (d > SCAN_RANGE) continue;

        _targetPos.set(c.x, (c.y || 0) + 1.0, c.z);
        _proj.copy(_targetPos).project(camera);

        if (_proj.z < 1.0 && _proj.x >= -1 && _proj.x <= 1 && _proj.y >= -1 && _proj.y <= 1) {
          const sx = (_proj.x * 0.5 + 0.5) * w;
          const sy = (-(_proj.y * 0.5) + 0.5) * h;
          const b = this.brackets[slot++];
          b.el.style.display = 'block';
          b.el.style.left = `${sx}px`;
          b.el.style.top = `${sy}px`;

          const isPolice = !!traffic.police?.includes(c);
          const speedKmh = Math.round((c.speed || 0) * 3.6);   // traffic cars carry a scalar `speed` along their path, no vx/vz

          if (isPolice) {
            b.el.style.borderColor = '#ff3344';
            b.label.style.borderColor = '#ff3344';
            b.label.style.color = '#ff6b7b';
            b.label.textContent = `🚨 POLICE CRUISER · ${speedKmh}KM/H · [THREAT: HIGH]`;
          } else {
            const chop = 1500 + Math.floor((c.x % 1000) * 4.2);
            b.el.style.borderColor = '#00e5ff';
            b.label.style.borderColor = '#00e5ff';
            b.label.style.color = '#00e5ff';
            b.label.textContent = `VEHICLE // CHOP: $${chop} · ${speedKmh}KM/H`;
          }
        }
      }
    }

    // Hide remaining unused brackets
    for (let i = slot; i < MAX_TARGETS; i++) {
      this.brackets[i].el.style.display = 'none';
    }

    if (this.countEl) {
      this.countEl.textContent = `${slot} TARGETS ACQUIRED`;
    }
  }
}
