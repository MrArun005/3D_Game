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
  /** Once Halstead Bay is loaded the minimap draws real streets. */
  useDistrict(d) { this.district = d; }

  useNavigation(nav) { this.navigation = nav; }

  useClock(clock) { this.clock = clock; }

  useChat(chat) { this.chat = chat; }

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
    this.#drawMapOverlay(car, traffic, mission);
    this.#drawBigMap(car, mission);
  }

  setStats(text) { this.stats.textContent = text; }

  /** Tab: the whole city on one canvas -- roads, you, the job markers. Click sets waypoint. */
  toggleMap() {
    if (!this.mapEl) {
      const el = document.createElement('canvas');
      el.width = 1120; el.height = 800;
      el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;display:none;'
        + 'background:rgba(8,11,16,.92);border:1px solid rgba(150,172,200,.35);border-radius:10px;cursor:crosshair';
      el.addEventListener('click', (e) => {
        if (!this.district) return;
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (el.width / rect.width);
        const py = (e.clientY - rect.top) * (el.height / rect.height);
        const b = this.district.bounds;
        const sc = Math.min((el.width - 40) / b.w, (el.height - 40) / b.h);
        const ox = (el.width - b.w * sc) / 2;
        const oz = (el.height - b.h * sc) / 2;
        const wx = (px - ox) / sc;
        const wz = (py - oz) / sc;
        if (this.navigation) {
          this.navigation.setWaypoint(wx, wz);
          this.flash('GPS WAYPOINT SET');
        }
      });
      document.body.appendChild(el);
      this.mapEl = el;
    }
    this.mapOpen = !this.mapOpen;
    this.mapEl.style.display = this.mapOpen ? 'block' : 'none';
  }

  /* On top of the rotating minimap: the job marker (and the next one), live
     police as red dots, a north tick, and the district you are in. Drawn in
     screen space with the rotation applied by hand, so nothing here depends on
     the core drawer's save/restore. */
  #drawMapOverlay(car, traffic, mission) {
    const g = this.map, S = g.canvas.width, C = S / 2, SC = S / 1150, rot = car.yaw - Math.PI / 2;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const toMap = (x, z) => { const dx = (x - car.x) * SC, dz = (z - car.z) * SC; return [C + dx * cs - dz * sn, C + dx * sn + dz * cs]; };
    const clampR = (p, r) => { const dx = p[0] - C, dz = p[1] - C, d = Math.hypot(dx, dz); return d > r ? [C + dx / d * r, C + dz / d * r] : p; };

    // --- Task 1.1: GPS route line (3px neon magenta with glow) ---
    if (this.navigation?.routePoints?.length > 1) {
      g.save();
      g.strokeStyle = '#ff00aa';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.shadowColor = '#ff00aa';
      g.shadowBlur = 5;
      g.beginPath();
      for (let i = 0; i < this.navigation.routePoints.length; i++) {
        const pt = this.navigation.routePoints[i];
        const p = clampR(toMap(pt[0], pt[1]), C - 2);
        if (i === 0) g.moveTo(p[0], p[1]);
        else g.lineTo(p[0], p[1]);
      }
      g.stroke();
      g.restore();
    }

    // --- Task 1.2: Waypoint marker on minimap ---
    if (this.navigation?.waypoint) {
      const wp = this.navigation.waypoint;
      const wpP = clampR(toMap(wp.x, wp.z), C - 6);
      const dWp = Math.round(Math.hypot(car.x - wp.x, car.z - wp.z));
      g.fillStyle = '#b026ff';
      g.beginPath(); g.arc(wpP[0], wpP[1], 5.5, 0, 7); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#ffffff'; g.font = '700 9px ui-monospace,monospace';
      g.textAlign = 'center';
      g.fillText(`${dWp}m`, wpP[0], wpP[1] - 8);
    }

    if (mission?.active) {
      mission.points.forEach((pt, i) => {
        if (i < mission.index || i > mission.index + 1) return;
        const p = clampR(toMap(pt.x, pt.y), C - 8);
        g.fillStyle = i === mission.index ? '#ffc23c' : 'rgba(74,163,255,0.85)';
        g.beginPath(); g.arc(p[0], p[1], i === mission.index ? 5.5 : 3.5, 0, 7); g.fill();
      });
    }
    if (traffic?.police) for (const c of traffic.police) {
      if (!c.live) continue;
      const p = clampR(toMap(c.x, c.z), C - 6);
      g.fillStyle = '#ff4a4a'; g.beginPath(); g.arc(p[0], p[1], 3, 0, 7); g.fill();
    }
    // north tick on the rim
    const n = [C - Math.sin(rot) * (C - 6), C - Math.cos(rot) * (C - 6)];
    g.fillStyle = 'rgba(220,230,245,0.9)'; g.font = '700 10px ui-sans-serif,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', n[0], n[1]);
    // the district under your wheels
    if (this.district) {
      const t = performance.now();
      if (!this._distAt || t - this._distAt > 500) {
        this._distAt = t; let best = null, bd = Infinity;
        for (const b of this.district.blocks) { const d = Math.hypot(b.x - car.x, b.y - car.z); if (d < bd) { bd = d; best = b.district; } }
        this._dist = best;
      }
      if (this._dist) {
        g.fillStyle = 'rgba(8,11,16,0.55)'; g.fillRect(C - 60, S - 18, 120, 15);
        g.fillStyle = 'rgba(232,238,247,0.95)'; g.font = '600 10px ui-monospace,Menlo,monospace';
        g.fillText(this._dist, C, S - 10.5);
      }
    }

    // --- Task 2.1: Game Clock Time on Minimap ---
    if (this.clock) {
      g.fillStyle = 'rgba(8,11,16,0.65)'; g.fillRect(C - 28, 5, 56, 15);
      g.fillStyle = '#ffd98a'; g.font = '700 11px ui-monospace,Menlo,monospace';
      g.textAlign = 'center';
      g.fillText(this.clock.formattedTime, C, 16.5);
    }
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  }

  #drawBigMap(car, mission) {
    if (!this.mapOpen || !this.district) return;
    const g = this.mapEl.getContext('2d'), W = this.mapEl.width, H = this.mapEl.height;
    const b = this.district.bounds, sc = Math.min((W - 40) / b.w, (H - 40) / b.h), ox = (W - b.w * sc) / 2, oz = (H - b.h * sc) / 2;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(150,172,200,0.55)'; g.lineCap = 'round';
    for (const s of this.district.segments) {
      g.lineWidth = Math.max(1, s.half * 2 * sc);
      g.beginPath(); g.moveTo(ox + s.ax * sc, oz + s.az * sc); g.lineTo(ox + s.bx * sc, oz + s.bz * sc); g.stroke();
    }
    g.fillStyle = 'rgba(200,214,232,0.9)'; g.font = '12px ui-monospace, Menlo, monospace';
    for (const [name, c] of Object.entries(this.districtCentres())) g.fillText(name, ox + c[0] * sc - 30, oz + c[1] * sc);

    // Route on big map
    if (this.navigation?.routePoints?.length > 1) {
      g.strokeStyle = '#ff00aa';
      g.lineWidth = 4;
      g.beginPath();
      for (let i = 0; i < this.navigation.routePoints.length; i++) {
        const pt = this.navigation.routePoints[i];
        if (i === 0) g.moveTo(ox + pt[0] * sc, oz + pt[1] * sc);
        else g.lineTo(ox + pt[0] * sc, oz + pt[1] * sc);
      }
      g.stroke();
    }

    // Waypoint on big map
    if (this.navigation?.waypoint) {
      const wp = this.navigation.waypoint;
      g.fillStyle = '#b026ff';
      g.beginPath(); g.arc(ox + wp.x * sc, oz + wp.z * sc, 8, 0, 7); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.stroke();
    }

    // Places: Hospitals, Police, Landmarks
    if (this.district?.places) {
      for (const p of this.district.places) {
        const px = ox + p.x * sc, pz = oz + (p.z ?? p.y ?? 0) * sc;
        if (p.type === 'hosp') {
          g.fillStyle = '#2fe675';
          g.beginPath(); g.arc(px, pz, 6, 0, 7); g.fill();
          g.fillStyle = '#ffffff'; g.font = '700 9px monospace'; g.textAlign = 'center';
          g.fillText('+', px, pz + 3);
        } else if (p.type === 'police') {
          g.fillStyle = '#3f7dff';
          g.beginPath(); g.arc(px, pz, 6, 0, 7); g.fill();
          g.fillStyle = '#ffffff'; g.font = '700 8px monospace'; g.textAlign = 'center';
          g.fillText('P', px, pz + 3);
        }
      }
    }

    if (mission?.active) mission.points.forEach((p, i) => {
      g.fillStyle = i === mission.index ? '#ffc23c' : 'rgba(74,163,255,0.8)';
      g.beginPath(); g.arc(ox + p.x * sc, oz + p.y * sc, i === mission.index ? 7 : 4, 0, 7); g.fill();
    });

    // Player position & heading
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ox + car.x * sc, oz + car.z * sc, 5, 0, 7); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.moveTo(ox + car.x * sc, oz + car.z * sc);
    g.lineTo(ox + (car.x + Math.cos(car.yaw) * 60) * sc, oz + (car.z - Math.sin(car.yaw) * 60) * sc); g.stroke();

    // --- Task 5: Map Legend ---
    const lx = W - 230, ly = H - 165;
    g.fillStyle = 'rgba(8,11,16,0.88)';
    g.fillRect(lx, ly, 215, 150);
    g.strokeStyle = 'rgba(150,172,200,0.3)';
    g.lineWidth = 1;
    g.strokeRect(lx, ly, 215, 150);

    g.fillStyle = '#cfe0f5';
    g.font = '700 11px ui-sans-serif,system-ui,sans-serif';
    g.textAlign = 'left';
    g.fillText('MAP LEGEND', lx + 12, ly + 20);

    const legendItems = [
      { color: '#ffffff', icon: '▶', text: 'You (Heading)' },
      { color: '#b026ff', icon: '●', text: 'GPS Waypoint (Click map)' },
      { color: '#ff00aa', icon: '―', text: 'Navigation Route' },
      { color: '#ffc23c', icon: '●', text: 'Active Objective' },
      { color: '#2fe675', icon: '+', text: 'Hospital (Respawn)' },
      { color: '#3f7dff', icon: 'P', text: 'Police Station' },
    ];

    legendItems.forEach((item, idx) => {
      const iy = ly + 40 + idx * 17;
      g.fillStyle = item.color;
      g.font = '700 11px monospace';
      g.fillText(item.icon, lx + 12, iy);
      g.fillStyle = 'rgba(207,224,245,0.85)';
      g.font = '10px ui-sans-serif,sans-serif';
      g.fillText(item.text, lx + 30, iy);
    });
  }

  districtCentres() {
    if (this._centres) return this._centres;
    const acc = {};
    for (const b of this.district.blocks) { const c = acc[b.district] || (acc[b.district] = [0, 0, 0]); c[0] += b.x; c[1] += b.y; c[2]++; }
    this._centres = Object.fromEntries(Object.entries(acc).map(([k, c]) => [k, [c[0] / c[2], c[1] / c[2]]]));
    return this._centres;
  }

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

  /** A transient line under the mission text, unified with the multi-line chat feed. */
  flash(text, channel = null) {
    this.flashText = text;
    this.flashUntil = performance.now() + 3200;
    if (this.chat && text) {
      let ch = channel;
      if (!ch) {
        if (text.includes('📻')) ch = 'RADIO';
        else if (text.includes('POLICE') || text.includes('10-') || text.includes('WANTED') || text.includes('HEAT')) ch = 'DISPATCH';
        else ch = 'SYSTEM';
      }
      this.chat.post(ch, text.replace(/^📻\s*/, ''));
    }
  }
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

    // Turn arrow within 60m
    if (this.navigation?.turnInfo) {
      lines.unshift(`🧭 ${this.navigation.turnInfo.arrow} ${this.navigation.turnInfo.dir} IN ${this.navigation.turnInfo.dist}m`);
    }

    if (st && st.time !== null) {
      lines.push(`CHECKPOINT ${st.line}   ${st.time.toFixed(1)}s`
        + (st.best ? `   BEST ${st.best.toFixed(1)}s` : ''));
    } else if (!lines.length && st && st.best) {
      lines.push(`G — START RUN   BEST ${st.best.toFixed(1)}s`);
    } else if (!mission.active) {
      // First-minute onboarding sequence (Task 1.7)
      const elapsed = (performance.now() - (this.bootTime || (this.bootTime = performance.now()))) / 1000;
      if (elapsed < 8) {
        lines.push('🎮 DRIVE: WASD / Left Stick · SPACE: Handbrake · Q: Look Back');
      } else if (elapsed < 16) {
        lines.push('💼 MISSIONS: Press G or Start to take a contract');
      } else if (elapsed < 24) {
        lines.push('📍 GPS: Follow magenta route · TAB for City Map & Waypoints');
      } else if (!lines.length) {
        lines.push('G — TAKE A JOB');
      }
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
    const g = this.map, S = g.canvas.width, C = S / 2, SC = S / 1150;   // ~210 px shows ~180 m across
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
