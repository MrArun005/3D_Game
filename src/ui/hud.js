import { V } from '../vehicle/config.js';
import { CELL } from '../world/metrics.js';

export class Hud {
  constructor() {
    this.dials = document.getElementById('dials').getContext('2d');
    this.map = document.getElementById('minimap').getContext('2d');
    this.kph = document.getElementById('kph');
    this.gear = document.getElementById('gear');
    this.stats = document.getElementById('stats');
    this.overlay = document.getElementById('hud');
    this.district = null;
  }

  /** Once Halstead Bay is loaded the minimap draws real streets. */
  useDistrict(d) { this.district = d; }

  dismiss() { this.overlay.classList.add('gone'); }

  update(car, traffic, mission, net, heli) {
    this.heli = heli;
    this.#drawWanted(traffic);
    this.#drawMission(mission);
    this.net = net;
    this.kph.innerHTML = `${Math.round(Math.abs(car.fwdSpeed) * 3.6)}<small>KM/H</small>`;
    const name = car.gear === 0 ? 'R' : car.gear === 1 ? 'N' : String(car.gear - 1);
    this.gear.innerHTML = `GEAR <b>${name}</b>${car.holdGear ? ' · HOLD' : ''}`;
    this.#drawDials(car);
    this.#drawMap(car, traffic);
  }

  setStats(text) { this.stats.textContent = text; }

  /** Player condition, shown only once you have actually been hurt. */
  setHealth(v) {
    if (!this.healthEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:24px;bottom:172px;width:180px;height:7px;'
        + 'background:rgba(10,14,20,.7);border-radius:4px;overflow:hidden;pointer-events:none';
      const bar = document.createElement('div');
      bar.style.cssText = 'height:100%;width:100%;background:#e0503c;transition:width .18s';
      el.appendChild(bar);
      document.body.appendChild(el);
      this.healthEl = el; this.healthBar = bar;
    }
    this.healthEl.style.display = v >= 1 ? 'none' : 'block';
    this.healthBar.style.width = `${Math.max(0, v) * 100}%`;
  }

  /** A transient line under the mission text. */
  flash(text) { this.flashText = text; this.flashUntil = performance.now() + 3200; }
  /** Cash and the current job, first line of the mission drawer (jobs.js). */
  setJob(text) { this.jobLine = text; }

  /** The invite link, sitting where it can be selected and copied. */
  setRoom(url) {
    if (!this.roomEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:14px;right:18px;max-width:44vw;'
        + 'font:600 12px/1.5 ui-monospace,monospace;color:#cfe0f5;'
        + 'background:rgba(10,14,20,.72);padding:8px 12px;border-radius:8px;'
        + 'user-select:all;cursor:text;word-break:break-all';
      document.body.appendChild(el);
      this.roomEl = el;
    }
    this.roomEl.textContent = url;
  }

  /**
   * Black screen either side of a respawn.
   *
   * `at` runs at full black, which is the whole point: the player never sees
   * the world jump. Built here rather than in CSS because the HUD already owns
   * every other overlay and there is no stylesheet to add a class to.
   */
  blackout(at, hold = 420) {
    if (!this.fadeEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;'
        + 'pointer-events:none;z-index:60;transition:opacity .34s linear';
      document.body.appendChild(el);
      this.fadeEl = el;
    }
    const el = this.fadeEl;
    el.style.opacity = '1';
    setTimeout(() => {
      at();
      setTimeout(() => { el.style.opacity = '0'; }, hold);
    }, 360);
  }

  /** Switch the big banner between BUSTED and WASTED. */
  setDead(on) { this.deadMode = on; if (this.bustEl) this.bustEl.textContent = on ? 'WASTED' : 'BUSTED'; }

  /** BUSTED, for as long as `t` seconds remain on it. */
  setBusted(t) {
    if (!this.bustEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;font:800 76px/1 ui-sans-serif,system-ui,sans-serif;'
        + 'letter-spacing:14px;color:#ff5a4a;pointer-events:none;'
        + 'text-shadow:0 6px 40px rgba(0,0,0,.9);transition:opacity .2s';
      el.style.color = '#ff5a4a';
      el.textContent = this.deadMode ? 'WASTED' : 'BUSTED';
      document.body.appendChild(el);
      this.bustEl = el;
    }
    this.bustEl.style.opacity = t > 0 ? String(Math.min(1, t / 1.2)) : '0';
  }

  /** The run: checkpoint count, clock, best, and any transient message. */
  #drawMission(mission) {
    if (!this.missionEl) {
      const el = document.createElement('div');
      el.id = 'mission';
      el.style.cssText = 'position:fixed;top:22px;left:50%;transform:translateX(-50%);'
        + 'font:700 15px/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:2px;'
        + 'color:#ffd98a;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,.85);'
        + 'pointer-events:none;white-space:pre-line';
      document.body.appendChild(el);
      this.missionEl = el;
    }
    if (!mission) { this.missionEl.textContent = ''; return; }
    const st = mission.status();
    const lines = [];
    if (this.jobLine) lines.push(this.jobLine);
    if (this.flashUntil > performance.now()) lines.push(this.flashText);
    if (mission.messageFor > 0 && mission.message) lines.push(mission.message);
    if (st && st.time !== null) {
      lines.push(`CHECKPOINT ${st.line}   ${st.time.toFixed(1)}s`
        + (st.best ? `   BEST ${st.best.toFixed(1)}s` : ''));
    } else if (!lines.length && st && st.best) {
      lines.push(`G — START RUN   BEST ${st.best.toFixed(1)}s`);
    } else if (!lines.length && !mission.active) {
      lines.push('G — TAKE A JOB');
    }
    this.missionEl.textContent = lines.join('\n');
  }

  /** Wanted level, as stars over the minimap. */
  #drawWanted(traffic) {
    const w = traffic ? traffic.wanted : 0;
    if (!this.wantedEl) {
      const el = document.createElement('div');
      el.id = 'wanted';
      el.style.cssText = 'position:fixed;left:24px;bottom:196px;font:700 26px/1 ui-sans-serif,sans-serif;'
        + 'letter-spacing:4px;color:#ffb020;text-shadow:0 2px 8px rgba(0,0,0,.8);pointer-events:none';
      document.body.appendChild(el);
      this.wantedEl = el;
    }
    const n = Math.ceil(w - 0.001);
    if (n === this.lastWanted) return;
    this.lastWanted = n;
    this.wantedEl.textContent = n > 0 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
  }

  #drawDials(car) {
    const g = this.dials, W = 230, C = W / 2, R = 96;
    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(C, C);

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(140,158,182,0.13)';
    g.beginPath(); g.arc(0, 0, R, a0, a1); g.stroke();

    const redline = a0 + (a1 - a0) * (V.shiftUp / V.redline);
    g.strokeStyle = 'rgba(200,58,50,0.5)';
    g.beginPath(); g.arc(0, 0, R, redline, a1); g.stroke();

    const p = Math.max(0, Math.min(1, car.rpm / V.redline));
    const grad = g.createLinearGradient(-R, 0, R, 0);
    grad.addColorStop(0, '#6f9ccc');
    grad.addColorStop(0.7, '#d8bd84');
    grad.addColorStop(1, '#d85f54');
    g.strokeStyle = grad;
    g.beginPath(); g.arc(0, 0, R, a0, a0 + (a1 - a0) * p); g.stroke();

    g.strokeStyle = 'rgba(180,196,216,0.55)';
    g.lineWidth = 2;
    g.font = '600 11px ui-sans-serif,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i <= 7; i++) {
      const a = a0 + (a1 - a0) * (i / 7);
      g.beginPath();
      g.moveTo(Math.cos(a) * (R - 20), Math.sin(a) * (R - 20));
      g.lineTo(Math.cos(a) * (R - 10), Math.sin(a) * (R - 10));
      g.stroke();
      g.fillStyle = 'rgba(160,176,196,0.72)';
      g.fillText(String(i), Math.cos(a) * (R - 33), Math.sin(a) * (R - 33));
    }

    const na = a0 + (a1 - a0) * p;
    g.strokeStyle = '#e0685a';
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(Math.cos(na) * 14, Math.sin(na) * 14);
    g.lineTo(Math.cos(na) * (R - 16), Math.sin(na) * (R - 16));
    g.stroke();

    g.fillStyle = '#1b2028';
    g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
    g.fillStyle = 'rgba(150,166,186,0.62)';
    g.font = '500 10px ui-sans-serif,sans-serif';
    g.fillText('x1000 RPM', 0, 42);
    g.restore();
  }

  #drawMap(car, traffic) {
    const g = this.map, S = 150, C = S / 2, SC = 0.13;
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(C, C);
    g.rotate(car.yaw - Math.PI / 2);
    if (this.district) {
      /* Real streets, at their real widths. The procedural grid this replaced
         drew a perfect lattice that stopped matching the world the moment the
         city came out of a file. */
      g.strokeStyle = 'rgba(150,172,200,0.34)';
      g.lineCap = 'round';
      for (const seg of this.district.segmentsNear(car.x, car.z, S / SC / 2)) {
        g.lineWidth = Math.max(1.2, seg.half * 2 * SC);
        g.beginPath();
        g.moveTo((seg.ax - car.x) * SC, (seg.az - car.z) * SC);
        g.lineTo((seg.bx - car.x) * SC, (seg.bz - car.z) * SC);
        g.stroke();
      }
    } else {
      g.strokeStyle = 'rgba(140,162,190,0.28)';
      g.lineWidth = CELL * SC * 0.2;
      const ci = Math.round(car.x / CELL), cj = Math.round(car.z / CELL);
      for (let i = ci - 3; i <= ci + 3; i++) {
        const X = (i * CELL - car.x) * SC;
        g.beginPath(); g.moveTo(X, -S); g.lineTo(X, S); g.stroke();
      }
      for (let j = cj - 3; j <= cj + 3; j++) {
        const Z = (j * CELL - car.z) * SC;
        g.beginPath(); g.moveTo(-S, Z); g.lineTo(S, Z); g.stroke();
      }
    }
    if (traffic) {
      g.fillStyle = 'rgba(190, 205, 220, 0.7)';
      for (const t of traffic.cars) {
        if (!t.live) continue;
        const dx = (t.x - car.x) * SC, dz = (t.z - car.z) * SC;
        if (dx * dx + dz * dz > 80 * 80) continue;
        g.fillRect(dx - 1.4, dz - 2.4, 2.8, 4.8);
      }
      for (const o of (this.net ? this.net.others() : [])) {
        const dx = (o.x - car.x) * SC, dz = (o.z - car.z) * SC;
        g.fillStyle = '#5ce06a';
        g.fillRect(dx - 2, dz - 3, 4, 6);
      }
      if (this.heli && this.heli.live) {
        const dx = (this.heli.pos.x - car.x) * SC, dz = (this.heli.pos.z - car.z) * SC;
        g.fillStyle = '#7fe3ff';
        g.beginPath();
        g.moveTo(dx, dz - 4); g.lineTo(dx + 4, dz + 3); g.lineTo(dx - 4, dz + 3);
        g.closePath(); g.fill();
      }
      // pursuit is the one thing on this map you need to find instantly
      for (const t of traffic.police || []) {
        if (!t.live) continue;
        const dx = (t.x - car.x) * SC, dz = (t.z - car.z) * SC;
        g.fillStyle = Math.floor(Date.now() / 160) % 2 ? '#ff3b2c' : '#3f7dff';
        g.fillRect(dx - 2, dz - 3, 4, 6);
      }
    }
    g.restore();
    g.fillStyle = '#e8c489';
    g.beginPath();
    g.moveTo(C, C - 7); g.lineTo(C - 4.5, C + 5); g.lineTo(C + 4.5, C + 5);
    g.closePath(); g.fill();
  }
}
