import { V } from '../vehicle/config.js';
import { searchRadius } from '../game/policeAi.js';
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

    // Dedicated flight controls banner
    this.flightBanner = document.getElementById('flight-banner');
    if (!this.flightBanner && typeof document !== 'undefined') {
      const b = document.createElement('div');
      b.id = 'flight-banner';
      b.style.cssText = 'position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:60;'
        + 'background:rgba(12,18,28,0.88);backdrop-filter:blur(10px);border:1px solid rgba(57,255,176,0.45);'
        + 'border-radius:24px;padding:8px 20px;color:#cfe0f5;font:600 12px/1.4 system-ui,-apple-system,sans-serif;'
        + 'letter-spacing:.06em;box-shadow:0 8px 32px rgba(0,0,0,0.65),0 0 16px rgba(57,255,176,0.22);'
        + 'display:none;align-items:center;gap:12px;pointer-events:none;';
      b.innerHTML = '<span style="color:#39ffb0;font-size:15px">🚁</span> '
        + '<span><b style="color:#fff;background:rgba(255,255,255,0.18);padding:2px 7px;border-radius:4px">W</b> / <b style="color:#fff;background:rgba(255,255,255,0.18);padding:2px 7px;border-radius:4px">SPACE</b> Fly Up</span> · '
        + '<span><b style="color:#fff;background:rgba(255,255,255,0.18);padding:2px 7px;border-radius:4px">SHIFT</b> / <b style="color:#fff;background:rgba(255,255,255,0.18);padding:2px 7px;border-radius:4px">S</b> Descend</span> · '
        + '<span><b style="color:#fff;background:rgba(255,255,255,0.18);padding:2px 7px;border-radius:4px">A/D</b> Turn</span> · '
        + '<span><b style="color:#fff;background:rgba(255,255,255,0.18);padding:2px 7px;border-radius:4px">F</b> Exit</span>';
      document.body.appendChild(b);
      this.flightBanner = b;
    }

    // Purposeful gameplay guidance prompt bar
    this.promptBar = document.getElementById('gameplay-prompt-bar');
    if (!this.promptBar && typeof document !== 'undefined') {
      const p = document.createElement('div');
      p.id = 'gameplay-prompt-bar';
      p.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:50;'
        + 'background:rgba(10,14,24,0.88);backdrop-filter:blur(10px);border:1px solid rgba(130,160,210,0.3);'
        + 'border-radius:20px;padding:6px 18px;color:#cfe0f5;font:600 11px/1.4 system-ui,-apple-system,sans-serif;'
        + 'letter-spacing:.04em;box-shadow:0 6px 24px rgba(0,0,0,0.65);display:flex;align-items:center;gap:12px;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(p);
      this.promptBar = p;
    }
  }

  /** Once Halstead Bay is loaded the minimap draws real streets. */
  useDistrict(d) { this.district = d; }

  useNavigation(nav) { this.navigation = nav; }

  useClock(clock) { this.clock = clock; }

  useChat(chat) { this.chat = chat; }

  dismiss() { this.overlay.classList.add('gone'); }

  update(car, traffic, mission, net, heli) {
    this.heli = heli;
    const activeV = (typeof window !== 'undefined') ? window._activeVehicle : null;
    const vehicleType = car.type || activeV?.type || 'car';
    const altAboveGround = car.altitudeAboveGround !== undefined ? car.altitudeAboveGround : (activeV?.altitudeAboveGround ?? 0);
    const isLanded = car.landed !== undefined ? car.landed : (activeV?.landed ?? false);
    const reloadTimer = car.reloadTime !== undefined ? car.reloadTime : (activeV?.reloadTime ?? 0);

    if (this.flightBanner) {
      this.flightBanner.style.display = vehicleType === 'helicopter' ? 'flex' : 'none';
    }
    if (this.promptBar) {
      if (vehicleType === 'helicopter') {
        this.promptBar.style.display = 'none';
      } else {
        this.promptBar.style.display = 'flex';
        const onFootActive = (typeof window !== 'undefined' && window.onFoot) ? !!window.onFoot.active : false;
        if (onFootActive) {
          this.promptBar.innerHTML = '<span style="color:#39ffb0">🏃 ON FOOT</span> · <span><b>WASD</b> Move</span> · <span><b>SHIFT</b> Sprint</span> · <span><b>SPACE</b> Jump</span> · <span><b>F</b> Enter Vehicle</span> · <span><b>M</b> Phone Heists</span> · <span><b>K</b> Switch Hero</span>';
        } else if (mission?.active || this.jobLine) {
          const mText = this.jobLine || mission?.prompt || 'MISSION IN PROGRESS';
          this.promptBar.innerHTML = `<span style="color:#ffd23f">🎯 OBJECTIVE</span> · <span>${mText}</span> · <span><b>M</b> Phone</span> · <span><b>G</b> Abort</span>`;
        } else {
          this.promptBar.innerHTML = '<span style="color:#5bc0be">📱 [M] iFruit Phone (Heists & Services)</span> · <span>💼 [G] Street Jobs</span> · <span>🏃 [F] Step Out On Foot</span> · <span>🗺️ [Tab] GPS Map</span>';
        }
      }
    }
    this.#drawWanted(traffic);
    this.#drawMission(mission);
    this.net = net;
    const fwd = car.fwdSpeed !== undefined ? car.fwdSpeed : (car.speed || 0);
    const kphVal = Math.round(Math.abs(fwd) * 3.6);
    if (kphVal !== this._lastKph) {
      this._lastKph = kphVal;
      this.kph.innerHTML = `${kphVal}<small>KM/H</small>`;
    }
    let gearStr = '';
    if (vehicleType === 'helicopter') {
      const alt = Math.round(altAboveGround || 0);
      gearStr = `ALT <b>${alt}m</b> · ${isLanded ? 'LANDED' : 'AIRBORNE'}`;
    } else if (vehicleType === 'tank') {
      const ready = reloadTimer <= 0;
      gearStr = `CANNON <b>${ready ? 'READY' : reloadTimer.toFixed(1) + 's'}</b>`;
    } else {
      const name = car.gear === 0 ? 'R' : car.gear === 1 ? 'N' : String((car.gear || 2) - 1);
      gearStr = `GEAR <b>${name}</b>${car.holdGear ? ' · HOLD' : ''}`;
    }
    if (gearStr !== this._lastGearStr) {
      this._lastGearStr = gearStr;
      this.gear.innerHTML = gearStr;
    }
    this.#drawDials(car);
    this.#tickWedges(1 / 60);
    this.#drawMap(car, traffic);
    this.#drawMapOverlay(car, traffic, mission);
    this.#drawBigMap(car, mission);
  }

  setStats(text) { this.stats.textContent = text; }

  /** Tab: the whole city on one canvas -- roads, you, the job markers. Click sets waypoint. */
  toggleMap() {
    if (!this.mapEl) {
      const el = document.createElement('canvas');
      /* Backing store bigger than the drawn size: the map is scaled up by CSS
         to fill the screen, and at 1120x800 every road came out soft. */
      el.width = 1680; el.height = 1200;
      el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;display:none;'
        + 'width:min(94vw,1680px);height:auto;background:#0a0d13;border:1px solid rgba(120,140,170,.28);'
        + 'border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.6);cursor:crosshair';
      el.addEventListener('click', (e) => {
        if (!this.district) return;
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (el.width / rect.width);
        const py = (e.clientY - rect.top) * (el.height / rect.height);
        const { sc, ox, oz } = this.#mapTransform();
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

    // --- Task 1.1: GPS route line ---
    if (this.navigation?.routePoints?.length > 1) {
      g.save();
      g.strokeStyle = '#ff00aa';
      g.lineWidth = 3.5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
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
        const pz = pt.z !== undefined ? pt.z : pt.y;
        const p = clampR(toMap(pt.x, pz), C - 8);
        g.fillStyle = i === mission.index ? '#ffc23c' : 'rgba(74,163,255,0.85)';
        g.beginPath(); g.arc(p[0], p[1], i === mission.index ? 5.5 : 3.5, 0, 7); g.fill();
      });
    }
    // they lost you: a search ring where they last had you, growing as it goes cold (policeAi.searchRadius)
    if (traffic?.wanted > 0 && traffic.coldFor > 3 && traffic.seenX !== undefined) {
      const r = searchRadius(traffic.coldFor) * SC, p = toMap(traffic.seenX, traffic.seenZ);
      g.save();
      g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill();
      g.setLineDash([6, 5]); g.lineDashOffset = -(performance.now() / 60) % 11;
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5; g.stroke();
      g.restore();
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

  /** One transform for the whole map, so a click maps back to the same metres. */
  #mapTransform() {
    const el = this.mapEl, b = this.district.bounds;
    const PAD_X = 26, PAD_TOP = 54, PAD_BOT = 26;      // room for the title bar
    const sc = Math.min((el.width - PAD_X * 2) / b.w, (el.height - PAD_TOP - PAD_BOT) / b.h);
    return { sc, ox: (el.width - b.w * sc) / 2, oz: PAD_TOP + (el.height - PAD_TOP - PAD_BOT - b.h * sc) / 2 };
  }

  /** The static half of the map: ground, blocks, roads, labels, places, legend.
      Built once into an offscreen canvas -- it never changes, and redrawing
      506 blocks and 2,900 road segments every frame is wasted work. */
  #mapBaseLayer() {
    const el = this.mapEl;
    if (this._mapBase && this._mapBaseW === el.width) return this._mapBase;
    const c = document.createElement('canvas');
    c.width = el.width; c.height = el.height;
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    const { sc, ox, oz } = this.#mapTransform();
    const X = (x) => ox + x * sc, Z = (z) => oz + z * sc;

    // ground
    g.fillStyle = '#0a0d13'; g.fillRect(0, 0, W, H);

    /* Land. Without filled blocks the city is a wire mesh with nothing between
       the lines; with them the streets become the gaps and the map reads as a
       plan. Parks are the one hue that is allowed to differ. */
    const BLOCK = { park: '#14251b', vacant: '#101319', row: '#161b24', mid: '#181e28', tower: '#1c2331', yard: '#151920', lot: '#131720' };
    for (const b of this.district.blocks) {
      g.save();
      g.translate(X(b.x), Z(b.y));
      g.rotate(b.angle || 0);
      g.fillStyle = BLOCK[b.type] || '#161b24';
      g.fillRect(-b.w * sc / 2, -b.h * sc / 2, b.w * sc, b.h * sc);
      g.restore();
    }

    /* Roads. A city map reads because its roads do NOT all look alike: the eye
       follows the wide bright ones and treats the rest as texture. Each class is
       one path per pass -- casing first, then fill -- so segments join instead of
       beading at every end, and the colours are opaque so overlaps do not stack
       into white mush. Width comes from the road's own half-width in metres. */
    const STYLE = {
      boundary: { w: 0.55, casing: '#0a0d13', fill: '#242b36' },
      street:   { w: 0.85, casing: '#0c1018', fill: '#414b5a' },
      arterial: { w: 1.00, casing: '#0c1018', fill: '#7a8798' },
      ramp:     { w: 0.85, casing: '#141108', fill: '#8b7647' },
      freeway:  { w: 1.05, casing: '#141108', fill: '#c9a961' },
    };
    const byClass = new Map();
    for (const seg of this.district.segments) {
      let l = byClass.get(seg.cls); if (!l) byClass.set(seg.cls, (l = []));
      l.push(seg);
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of ['casing', 'fill']) {
      for (const cls of ['boundary', 'street', 'arterial', 'ramp', 'freeway']) {
        const list = byClass.get(cls), st = STYLE[cls];
        if (!list || !list.length || !st) continue;
        const half = list.reduce((a, sg) => a + sg.half, 0) / list.length;
        const base = Math.max(1.2, half * 2 * sc * st.w);
        g.strokeStyle = st[pass];
        g.lineWidth = pass === 'casing' ? base + 1.8 : base;
        g.beginPath();
        for (const sg of list) { g.moveTo(X(sg.ax), Z(sg.az)); g.lineTo(X(sg.bx), Z(sg.bz)); }
        g.stroke();
      }
    }

    // places: only the two you navigate by, so the map stays quiet
    if (this.district.places) {
      for (const p of this.district.places) {
        if (p.type !== 'hosp' && p.type !== 'police') continue;
        const px = X(p.x), pz = Z(p.z ?? p.y ?? 0);
        const hosp = p.type === 'hosp';
        g.fillStyle = hosp ? '#2fbf6a' : '#3f7dff';
        g.beginPath(); g.arc(px, pz, 7, 0, 7); g.fill();
        g.fillStyle = '#eaf1fb'; g.font = '700 10px ui-monospace,Menlo,monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(hosp ? '+' : 'P', px, pz + 0.5);
      }
    }

    // district names, letterspaced, over a soft plate so they read on any block
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [name, c] of Object.entries(this.districtCentres())) {
      const px = X(c[0]), pz = Z(c[1]);
      const label = name.split('').join(' ');
      g.font = '600 13px ui-sans-serif,system-ui,sans-serif';
      const wpx = g.measureText(label).width;
      g.fillStyle = 'rgba(10,13,19,0.72)';
      g.fillRect(px - wpx / 2 - 8, pz - 10, wpx + 16, 20);
      g.fillStyle = 'rgba(196,210,230,0.92)';
      g.fillText(label, px, pz);
    }

    // title bar and scale
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = '#e6edf7'; g.font = '700 15px ui-sans-serif,system-ui,sans-serif';
    g.fillText('H A L S T E A D   B A Y', 26, 28);
    g.fillStyle = 'rgba(150,168,192,0.75)'; g.font = '11px ui-monospace,Menlo,monospace';
    g.fillText('click anywhere to set a GPS waypoint  ·  TAB to close', 250, 29);
    const barM = 500, barPx = barM * sc;
    const bx = W - 26 - barPx, by = H - 26;
    g.strokeStyle = 'rgba(190,205,225,0.8)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + barPx, by); g.moveTo(bx, by - 5); g.lineTo(bx, by + 5);
    g.moveTo(bx + barPx, by - 5); g.lineTo(bx + barPx, by + 5); g.stroke();
    g.fillStyle = 'rgba(190,205,225,0.8)'; g.textAlign = 'center';
    g.fillText('500 m', bx + barPx / 2, by - 12);

    this._mapBase = c; this._mapBaseW = el.width;
    return c;
  }

  #drawBigMap(car, mission) {
    if (!this.mapOpen || !this.district) return;
    const g = this.mapEl.getContext('2d'), W = this.mapEl.width, H = this.mapEl.height;
    const { sc, ox, oz } = this.#mapTransform();
    const X = (x) => ox + x * sc, Z = (z) => oz + z * sc;

    g.clearRect(0, 0, W, H);
    g.drawImage(this.#mapBaseLayer(), 0, 0);

    // route: a dark casing under the magenta so it reads over pale arterials too
    const rp = this.navigation?.routePoints;
    if (rp?.length > 1) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [col, w] of [['rgba(6,8,12,0.85)', 7], ['#ff2d95', 3.5]]) {
        g.strokeStyle = col; g.lineWidth = w;
        g.beginPath();
        for (let i = 0; i < rp.length; i++) { const p = rp[i]; i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])); }
        g.stroke();
      }
    }

    if (this.navigation?.waypoint) {
      const wp = this.navigation.waypoint, px = X(wp.x), pz = Z(wp.z);
      g.fillStyle = '#b026ff'; g.beginPath(); g.arc(px, pz, 7, 0, 7); g.fill();
      g.strokeStyle = '#f2e8ff'; g.lineWidth = 2; g.stroke();
      const d = Math.round(Math.hypot(car.x - wp.x, car.z - wp.z));
      g.fillStyle = '#f2e8ff'; g.font = '700 11px ui-monospace,Menlo,monospace';
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText(`${d} m`, px, pz - 12);
    }

    if (mission?.active) mission.points.forEach((p, i) => {
      const pz = p.z !== undefined ? p.z : p.y;
      g.fillStyle = i === mission.index ? '#ffc23c' : 'rgba(74,163,255,0.8)';
      g.beginPath(); g.arc(X(p.x), Z(pz), i === mission.index ? 7 : 4, 0, 7); g.fill();
    });

    // you: a heading triangle, which is what the legend has always promised
    const px = X(car.x), pz = Z(car.z);
    g.save();
    g.translate(px, pz);
    g.rotate(-car.yaw + Math.PI / 2);
    g.beginPath(); g.moveTo(0, -10); g.lineTo(6.5, 8); g.lineTo(0, 4.5); g.lineTo(-6.5, 8); g.closePath();
    g.fillStyle = '#ffffff'; g.fill();
    g.strokeStyle = 'rgba(6,8,12,0.9)'; g.lineWidth = 1.5; g.stroke();
    g.restore();

    this.#drawMapLegend(g, W, H);
  }

  #drawMapLegend(g, W, H) {
    const items = [
      ['#ffffff', 'tri', 'You'],
      ['#b026ff', 'dot', 'GPS waypoint — click the map'],
      ['#ff2d95', 'line', 'Route'],
      ['#ffc23c', 'dot', 'Objective'],
      ['#2fbf6a', 'dot', 'Hospital'],
      ['#3f7dff', 'dot', 'Police station'],
    ];
    const w = 250, h = 30 + items.length * 20, x = W - w - 26, y = H - h - 26;
    g.fillStyle = 'rgba(9,12,18,0.9)'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(120,140,170,0.28)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    items.forEach(([col, kind, text], i) => {
      const iy = y + 22 + i * 20, ix = x + 20;
      g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 3; g.lineCap = 'round';
      if (kind === 'dot') { g.beginPath(); g.arc(ix, iy, 5, 0, 7); g.fill(); }
      else if (kind === 'line') { g.beginPath(); g.moveTo(ix - 6, iy); g.lineTo(ix + 6, iy); g.stroke(); }
      else { g.beginPath(); g.moveTo(ix, iy - 6); g.lineTo(ix + 4.5, iy + 5); g.lineTo(ix, iy + 2.5); g.lineTo(ix - 4.5, iy + 5); g.closePath(); g.fill(); }
      g.fillStyle = 'rgba(200,214,234,0.9)';
      g.font = '11px ui-sans-serif,system-ui,sans-serif';
      g.fillText(text, x + 38, iy);
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
  /**
   * Ammunition, bottom-right above the tacho. Only appears once you are armed
   * and holding something, and the magazine count goes amber at a third and
   * red when it is empty -- you should be able to read "reload now" without
   * reading the number.
   */
  /** Four weapon slots with their rounds; the one in hand is lit. Redrawn only when the summary string changes. */
  setArsenal(rows) {
    if (!this.arsEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;right:26px;bottom:262px;z-index:40;display:flex;gap:6px;pointer-events:none';
      document.body.appendChild(el);
      this.arsEl = el;
    }
    const key = rows.map((r) => `${r.key}${r.current ? '*' : ''}${r.mag}/${r.reserve}`).join('|');
    if (key === this._arsKey) return;
    this._arsKey = key;
    this.arsEl.innerHTML = rows.map((r) => `<div style="min-width:52px;padding:5px 7px;border-radius:6px;text-align:center;font:700 10px ui-monospace,Menlo,monospace;letter-spacing:.05em;`
      + `background:${r.current ? 'rgba(234,241,251,.92)' : 'rgba(9,12,18,.72)'};color:${r.current ? '#0b0e14' : '#c8d2e2'};border:1px solid rgba(120,140,170,.35)">`
      + `<div>${r.key}</div><div style="font-size:12px">${r.name}</div><div style="opacity:.75">${r.reserve === '' ? (r.mag === '' ? '&nbsp;' : r.mag) : `${r.mag}/${r.reserve}`}</div></div>`).join('');
  }

  setAmmo(name, ammo, reserve, reloading, armour = 0, magSize = 12) {
    const mag = reserve;   // the second number is now the reserve, not the magazine size
    if (!this.ammoEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;right:26px;bottom:190px;z-index:40;text-align:right;'
        + 'font:700 13px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:#dbe4f2;'
        + 'text-shadow:0 2px 8px rgba(0,0,0,.75);pointer-events:none;display:none';
      document.body.appendChild(el);
      this.ammoEl = el;
    }
    const el = this.ammoEl;
    el.style.display = 'block';
    const low = ammo === 0 ? '#ff5f5f' : ammo <= Math.ceil(magSize / 3) ? '#ffc23c' : '#eaf1fb';
    const arm = armour > 0 ? `<br><span style="font-size:11px;color:#6fb1ff">ARMOUR ${Math.round(armour * 100)}%</span>` : '';
    if (ammo === '' || ammo === null) { el.innerHTML = `<span style="font-size:20px">${name}</span>` + arm; return; }
    el.innerHTML = (reloading
      ? `<span style="opacity:.65">${name}</span><br><span style="font-size:20px;color:#ffc23c">RELOADING</span>`
      : `<span style="opacity:.65">${name}</span><br>`
        + `<span style="font-size:24px;color:${low}">${ammo}</span>`
        + `<span style="opacity:.5"> / ${mag}</span>`) + arm;
  }

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

  /**
   * Damage direction: a red wedge on the screen edge toward where the round
   * came from, in the player's look frame (0 = ahead), fading over 0.7 s.
   * Four wedges are pooled so a burst from two sides shows both.
   */
  hitFrom(bearing) {
    if (!this.wedges) {
      this.wedges = [];
      for (let i = 0; i < 4; i++) {
        const w = document.createElement('div');
        w.style.cssText = 'position:fixed;left:50%;top:50%;width:0;height:0;z-index:44;pointer-events:none;opacity:0;'
          + 'border-left:70px solid transparent;border-right:70px solid transparent;border-top:180px solid rgba(255,60,60,.55);'
          + 'transform-origin:50% 0;margin-left:-70px;filter:blur(6px)';
        document.body.appendChild(w);
        this.wedges.push({ el: w, t: 0 });
      }
    }
    const slot = this.wedges.reduce((a, b) => (a.t <= b.t ? a : b));
    slot.t = 0.7;
    // bearing: 0 ahead, +left; screen: rotate the wedge so its tip points from centre toward the source
    const deg = -bearing * 180 / Math.PI + 180;
    slot.el.style.transform = `rotate(${deg}deg) translateY(120px)`;
    slot.el.style.opacity = '1';
  }

  #tickWedges(dt) {
    if (!this.wedges) return;
    for (const w of this.wedges) {
      if (w.t <= 0) continue;
      w.t -= dt;
      w.el.style.opacity = String(Math.max(0, w.t / 0.7));
    }
  }

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

  /** GTA-style celebration banner for mission / job / challenge completions. */
  showVictoryBanner(title, subtitle, cash = 0) {
    if (!this.victoryEl) {
      const el = document.createElement('div');
      el.id = 'victory-banner';
      el.style.cssText = 'position:fixed;top:20%;left:50%;transform:translate(-50%,-20%) scale(0.85);opacity:0;'
        + 'z-index:120;display:flex;flex-direction:column;align-items:center;justify-content:center;'
        + 'padding:22px 48px;min-width:340px;background:linear-gradient(135deg,rgba(14,18,28,0.96) 0%,rgba(24,32,48,0.94) 100%);'
        + 'border:2px solid #f1c40f;border-radius:20px;box-shadow:0 0 50px rgba(241,196,15,0.45),inset 0 0 20px rgba(241,196,15,0.15);'
        + 'backdrop-filter:blur(14px);pointer-events:none;transition:all .4s cubic-bezier(0.18,0.9,0.3,1.25);'
        + 'text-align:center;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      document.body.appendChild(el);
      this.victoryEl = el;
    }
    const el = this.victoryEl;
    el.innerHTML = `
      <div style="font-size:12px;font-weight:800;letter-spacing:6px;color:#f39c12;margin-bottom:6px;text-transform:uppercase;">
        ★ CHALLENGE COMPLETED ★
      </div>
      <div style="font-size:28px;font-weight:900;letter-spacing:1px;color:#ffffff;text-shadow:0 2px 14px rgba(0,0,0,0.9);margin-bottom:4px;">
        ${title}
      </div>
      <div style="font-size:13px;font-weight:600;color:#bdc3c7;letter-spacing:1px;margin-bottom:${cash ? '10px' : '0'};">
        ${subtitle}
      </div>
      ${cash ? `
        <div style="font-size:32px;font-weight:900;color:#2ecc71;text-shadow:0 0 20px rgba(46,204,113,0.5);letter-spacing:2px;">
          +$${Number(cash).toLocaleString()}
        </div>
      ` : ''}
    `;

    this.#burstConfetti();

    clearTimeout(this._vicTimer);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translate(-50%,-20%) scale(1)';
    });

    this._vicTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%,-20%) scale(0.85)';
    }, 4500);
  }

  #burstConfetti() {
    for (let i = 0; i < 35; i++) {
      const p = document.createElement('div');
      const size = 5 + Math.random() * 5;
      const colors = ['#f1c40f', '#2ecc71', '#e74c3c', '#3498db', '#ffffff', '#e67e22'];
      const col = colors[(Math.random() * colors.length) | 0];
      p.style.cssText = `position:fixed;left:50%;top:26%;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 2.2)}px;`
        + `background:${col};border-radius:2px;pointer-events:none;z-index:121;opacity:1;`
        + `transform:translate(-50%,-50%);transition:transform 1.8s cubic-bezier(0.2,0.8,0.4,1),opacity 1.8s ease-out`;
      document.body.appendChild(p);
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 240;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist + 70;
      requestAnimationFrame(() => {
        p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 720}deg)`;
        p.style.opacity = '0';
      });
      setTimeout(() => p.remove(), 1900);
    }
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
    // when an officer has a line on you the stars pulse; no line, they sit still
    if (traffic?.hot) { this.wantedEl.style.filter = 'drop-shadow(0 0 7px rgba(255,74,74,.95))'; this.wantedEl.style.opacity = '1'; this._coldFor = 0; }
    else {
      // nobody has a line on you: after three seconds the stars go grey -- you are evading, keep it up
      this._coldFor = (this._coldFor ?? 0) + 1 / 60;
      const evading = this._coldFor > 3 && (traffic?.wanted ?? 0) > 0;
      this.wantedEl.style.filter = evading ? 'grayscale(1)' : '';
      this.wantedEl.style.opacity = evading ? '0.55' : '1';
    }
    const n = Math.ceil(w - 0.001);
    if (n === this.lastWanted) return;
    if (this.lastWanted !== undefined && n > this.lastWanted && n >= 2) this.flash?.(`WANTED LEVEL ${n}`);   // a new star is news; the first one the stars themselves announce
    this.lastWanted = n;
    this.wantedEl.textContent = n > 0 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
  }

  #getDialPlate() {
    if (this.dialPlate) return this.dialPlate;
    const c = document.createElement('canvas');
    c.width = 230; c.height = 230;
    const g = c.getContext('2d'), W = 230, C = W / 2, R = 96;
    g.translate(C, C);

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(140,158,182,0.13)';
    g.beginPath(); g.arc(0, 0, R, a0, a1); g.stroke();

    const redline = a0 + (a1 - a0) * (V.shiftUp / V.redline);
    g.strokeStyle = 'rgba(200,58,50,0.5)';
    g.beginPath(); g.arc(0, 0, R, redline, a1); g.stroke();

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
    g.fillStyle = 'rgba(150,166,186,0.62)';
    g.font = '500 10px ui-sans-serif,sans-serif';
    g.fillText('x1000 RPM', 0, 42);
    this.dialPlate = c;
    return c;
  }

  #drawDials(car) {
    const g = this.dials, W = 230, C = W / 2, R = 96;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.#getDialPlate(), 0, 0);

    g.save();
    g.translate(C, C);

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const activeV = (typeof window !== 'undefined') ? window._activeVehicle : null;
    const vType = car.type || activeV?.type || 'car';
    const rotorRpm = car.rotorRpm !== undefined ? car.rotorRpm : (activeV?.rotorRpm ?? 0);
    const rpm = car.rpm ?? (vType === 'helicopter' ? rotorRpm * 4500 : (car.speed ? car.speed * 120 : 0));
    const p = Math.max(0, Math.min(1, rpm / V.redline));

    if (!this._dialGrad) {
      this._dialGrad = g.createLinearGradient(-R, 0, R, 0);
      this._dialGrad.addColorStop(0, '#6f9ccc');
      this._dialGrad.addColorStop(0.7, '#d8bd84');
      this._dialGrad.addColorStop(1, '#d85f54');
    }
    g.lineWidth = 12;
    g.strokeStyle = this._dialGrad;
    g.beginPath(); g.arc(0, 0, R, a0, a0 + (a1 - a0) * p); g.stroke();

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
    g.restore();
  }

  #drawMap(car, traffic) {
    const g = this.map, S = g.canvas.width, C = S / 2, SC = S / 1150;   // ~210 px shows ~180 m across
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(C, C);
    g.rotate(car.yaw - Math.PI / 2);
    if (this.district) {
      /* Real streets batched into a single stroke pass */
      const segs = this.district.segmentsNear(car.x, car.z, S / SC / 2);
      g.strokeStyle = 'rgba(150,172,200,0.34)';
      g.lineCap = 'round';
      g.lineWidth = 2.4;
      g.beginPath();
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        g.moveTo((seg.ax - car.x) * SC, (seg.az - car.z) * SC);
        g.lineTo((seg.bx - car.x) * SC, (seg.bz - car.z) * SC);
      }
      g.stroke();
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

      // Safehouse refuges on minimap
      const rep = (typeof window !== 'undefined') ? window._reputation : null;
      if (rep && rep.safehouses) {
        for (let i = 0; i < rep.safehouses.length; i++) {
          const sh = rep.safehouses[i];
          const dx = (sh.x - car.x) * SC, dz = (sh.z - car.z) * SC;
          if (dx * dx + dz * dz > 95 * 95) continue;
          const isOwned = rep.isOwned(sh.id);
          g.fillStyle = isOwned ? '#2ecc71' : '#9b59b6';
          g.beginPath();
          g.arc(dx, dz, 4.5, 0, 7);
          g.fill();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.2;
          g.stroke();
        }
      }

      // Active Navigation Waypoint indicator on radar rim
      if (this.navigation && this.navigation.waypoint) {
        const wp = this.navigation.waypoint;
        const dx = (wp.x - car.x) * SC, dz = (wp.z - car.z) * SC;
        const d = Math.hypot(dx, dz);
        const maxR = C - 10;
        if (d <= maxR) {
          g.fillStyle = '#b026ff';
          g.beginPath();
          g.arc(dx, dz, 5.5, 0, 7);
          g.fill();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.stroke();
        } else {
          const nx = dx / d, nz = dz / d;
          const px = nx * maxR, pz = nz * maxR;
          g.save();
          g.translate(px, pz);
          g.rotate(Math.atan2(nz, nx) + Math.PI / 2);
          g.fillStyle = '#b026ff';
          g.beginPath();
          g.moveTo(0, -6);
          g.lineTo(4.5, 5);
          g.lineTo(-4.5, 5);
          g.closePath();
          g.fill();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.2;
          g.stroke();
          g.restore();
        }
      }
    }
    g.restore();
    g.fillStyle = '#e8c489';
    g.beginPath();
    g.moveTo(C, C - 7); g.lineTo(C - 4.5, C + 5); g.lineTo(C + 4.5, C + 5);
    g.closePath(); g.fill();

    // Subtle glass radar boundary ring
    g.strokeStyle = 'rgba(120, 160, 210, 0.25)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(C, C, C - 1.5, 0, 7);
    g.stroke();
  }
}
