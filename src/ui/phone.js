import { STORY_MISSIONS } from '../game/storyMissions.js';

export class Phone {
  constructor(storyManager, garage, hero, traffic, dispatchService = null, car = null, reputation = null, intel = null, navigation = null) {
    this.story = storyManager;
    this.garage = garage;
    this.hero = hero;
    this.traffic = traffic;
    this.dispatch = dispatchService;
    this.car = car;
    this.reputation = reputation;
    this.intel = intel;
    this.navigation = navigation;

    this.open = false;
    this.tab = 'missions'; // 'missions' | 'garage' | 'contacts' | 'intel'
    this.#build();
  }

  #build() {
    const el = document.createElement('div');
    el.id = 'gta-phone';
    el.style.cssText = `
      position: fixed;
      right: 28px;
      bottom: -640px;
      width: 320px;
      height: 580px;
      background: rgba(15, 18, 26, 0.94);
      backdrop-filter: blur(14px);
      border: 2px solid rgba(130, 160, 210, 0.35);
      border-radius: 36px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.85);
      z-index: 100;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: bottom 0.36s cubic-bezier(0.18, 0.89, 0.32, 1.28);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    `;

    // Phone Top Speaker / Camera notch
    const notch = document.createElement('div');
    notch.style.cssText = `
      width: 120px; height: 16px; background: #000; border-radius: 0 0 12px 12px;
      margin: 0 auto 6px auto; display: flex; align-items: center; justify-content: center;
    `;
    const speaker = document.createElement('div');
    speaker.style.cssText = 'width: 44px; height: 4px; background: #333; border-radius: 2px;';
    notch.appendChild(speaker);
    el.appendChild(notch);

    // Header bar
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding: 4px 18px 10px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);';
    header.innerHTML = `
      <div style="font-weight: 700; font-size: 13px; color: #5bc0be;">iFRUIT OS 5.1</div>
      <div id="phone-cash" style="font-weight: 800; font-size: 15px; color: #2ecc71;">$${this.garage.cash.toLocaleString()}</div>
    `;
    el.appendChild(header);

    // App Navigation Tabs
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex; background:rgba(0,0,0,0.35); border-bottom:1px solid rgba(255,255,255,0.06);';
    nav.innerHTML = `
      <button id="tab-missions" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#fff; font-weight:700; font-size:10px; cursor:pointer; border-bottom: 2px solid #3498db;">HEISTS</button>
      <button id="tab-garage" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#888; font-weight:700; font-size:10px; cursor:pointer;">TUNING</button>
      <button id="tab-contacts" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#888; font-weight:700; font-size:10px; cursor:pointer;">SERVICES</button>
      <button id="tab-intel" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#888; font-weight:700; font-size:10px; cursor:pointer;">INTEL</button>
    `;
    el.appendChild(nav);

    // Body content area
    const content = document.createElement('div');
    content.id = 'phone-content';
    content.style.cssText = 'flex:1; overflow-y:auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;';
    el.appendChild(content);

    // Bottom Close prompt
    const footer = document.createElement('div');
    footer.style.cssText = 'padding: 8px; text-align: center; font-size: 11px; color: #777; background: rgba(0,0,0,0.4);';
    footer.textContent = 'PRESS M TO CLOSE PHONE';
    el.appendChild(footer);

    document.body.appendChild(el);
    this.el = el;
    this.content = content;

    // Hook tab clicks
    nav.querySelector('#tab-missions').onclick = () => this.#switchTab('missions');
    nav.querySelector('#tab-garage').onclick = () => this.#switchTab('garage');
    nav.querySelector('#tab-contacts').onclick = () => this.#switchTab('contacts');
    nav.querySelector('#tab-intel').onclick = () => this.#switchTab('intel');

    // On-screen toggle trigger button
    const trigger = document.createElement('button');
    trigger.id = 'phone-btn';
    trigger.style.cssText = `
      position: fixed; right: 28px; bottom: 24px; z-index: 90;
      padding: 10px 18px; background: linear-gradient(135deg, #2980b9, #2c3e50);
      color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 20px;
      font-weight: 800; font-size: 13px; letter-spacing: 1px; cursor: pointer;
      box-shadow: 0 4px 18px rgba(0,0,0,0.5);
    `;
    trigger.textContent = '📱 PHONE (M)';
    trigger.onclick = () => this.toggle();
    document.body.appendChild(trigger);
  }

  #switchTab(tab) {
    this.tab = tab;
    const nav = this.el.querySelector('#tab-missions').parentElement;
    nav.querySelectorAll('button').forEach((b) => {
      b.style.color = '#888';
      b.style.borderBottom = 'none';
    });
    const btn = nav.querySelector(`#tab-${tab}`);
    if (btn) {
      btn.style.color = '#fff';
      btn.style.borderBottom = '2px solid #3498db';
    }
    this.#render();
  }

  #render() {
    this.el.querySelector('#phone-cash').textContent = `$${this.garage.cash.toLocaleString()}`;
    this.content.innerHTML = '';

    if (this.tab === 'missions') {
      STORY_MISSIONS.forEach((m) => {
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 4px;';
        const isCurrent = this.story.active?.id === m.id;
        card.innerHTML = `
          <div style="font-weight: 800; font-size: 12px; color: ${m.type === 'heist' ? '#f39c12' : '#3498db'};">${m.title}</div>
          <div style="font-size: 11px; color: #bbb;">${m.subtitle}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 6px;">
            <div style="font-weight:800; color:#2ecc71; font-size:12px;">+$${(m.payout ?? m.pay ?? 0).toLocaleString()}</div>
            <button class="start-mission-btn" style="padding: 5px 12px; border-radius: 6px; border:none; background:${isCurrent ? '#e74c3c' : '#27ae60'}; color:#fff; font-weight:700; font-size:11px; cursor:pointer;">
              ${isCurrent ? 'ABANDON' : 'START HEIST'}
            </button>
          </div>
        `;
        card.querySelector('.start-mission-btn').onclick = () => {
          if (isCurrent) {
            this.story.abandon();
          } else {
            const activeV = (typeof window !== 'undefined') ? window._activeVehicle : null;
            this.story.startMission(m.id, activeV || this.car || this.hero);
            this.toggle(false);
          }
          this.#render();
        };
        this.content.appendChild(card);
      });
    } else if (this.tab === 'garage') {
      // Nitrous
      const nosCard = document.createElement('div');
      nosCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px; display:flex; justify-content:space-between; align-items:center;';
      nosCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:12px; color:#3498db;">NITROUS OXIDE (NOS)</div>
          <div style="font-size:11px; color:#888;">${this.garage.hasNos ? 'INSTALLED · HOLD SHIFT TO BOOST' : '$3,000 · Supercharged speed boost'}</div>
        </div>
        <button id="buy-nos-btn" style="padding:6px 12px; border-radius:6px; border:none; background:${this.garage.hasNos ? '#555' : '#2980b9'}; color:#fff; font-weight:700; font-size:11px; cursor:pointer;">
          ${this.garage.hasNos ? 'OWNED' : 'BUY $3K'}
        </button>
      `;
      nosCard.querySelector('#buy-nos-btn').onclick = () => {
        if (!this.garage.hasNos) this.garage.installNos();
        this.#render();
      };
      this.content.appendChild(nosCard);

      // Engine Tuning
      const tuneCard = document.createElement('div');
      tuneCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px; display:flex; justify-content:space-between; align-items:center;';
      const maxTune = this.garage.stage >= 3;
      tuneCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:12px; color:#e67e22;">TURBO TUNE (STAGE ${this.garage.stage})</div>
          <div style="font-size:11px; color:#888;">${maxTune ? 'MAXED OUT (+40 KM/H)' : 'Upgrade ECU & Turbo'}</div>
        </div>
        <button id="tune-btn" style="padding:6px 12px; border-radius:6px; border:none; background:${maxTune ? '#555' : '#d35400'}; color:#fff; font-weight:700; font-size:11px; cursor:pointer;">
          ${maxTune ? 'MAX' : 'TUNE $' + (this.garage.stage === 1 ? '4K' : '8K')}
        </button>
      `;
      tuneCard.querySelector('#tune-btn').onclick = () => {
        if (!maxTune) this.garage.tuneEngine();
        this.#render();
      };
      this.content.appendChild(tuneCard);

      // Chassis Underglow Neon
      const neonCard = document.createElement('div');
      neonCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px; display:flex; flex-direction:column; gap:6px;';
      neonCard.innerHTML = `
        <div style="font-weight:800; font-size:12px; color:#00d4ff;">CHASSIS UNDERGLOW NEON</div>
        <div style="display:flex; gap:6px; margin-top:2px;">
          <button class="neon-col-btn" data-col="0x00d4ff" style="flex:1; padding:6px 0; border:none; border-radius:6px; background:#00d4ff; color:#000; font-weight:800; font-size:10px; cursor:pointer;">CYAN</button>
          <button class="neon-col-btn" data-col="0xff0077" style="flex:1; padding:6px 0; border:none; border-radius:6px; background:#ff0077; color:#fff; font-weight:800; font-size:10px; cursor:pointer;">PINK</button>
          <button class="neon-col-btn" data-col="0x9900ff" style="flex:1; padding:6px 0; border:none; border-radius:6px; background:#9900ff; color:#fff; font-weight:800; font-size:10px; cursor:pointer;">PURPLE</button>
          <button class="neon-col-btn" data-col="0x00ff66" style="flex:1; padding:6px 0; border:none; border-radius:6px; background:#00ff66; color:#000; font-weight:800; font-size:10px; cursor:pointer;">GREEN</button>
        </div>
      `;
      neonCard.querySelectorAll('.neon-col-btn').forEach((btn) => {
        btn.onclick = (e) => {
          const col = Number(e.target.getAttribute('data-col'));
          if (window.vehicleVFX) window.vehicleVFX.setNeonColor(col);
        };
      });
      this.content.appendChild(neonCard);

      // Supercar Deliveries
      const cars = [
        { id: 's-corvette-zr1', name: 'Corvette ZR1 Supercar', cost: 25000 },
        { id: 's-camaro-patrol', name: 'Camaro ZL1 Interceptor', cost: 18000 },
        { id: 's-corvette-c6r', name: 'Corvette C6.R GT2 Race Car', cost: 35000 },
      ];
      cars.forEach((c) => {
        const cCard = document.createElement('div');
        const owned = this.garage.ownedCars ? this.garage.ownedCars.includes(c.id) : (this.garage.owned ? this.garage.owned.has(c.id) : false);
        cCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px; display:flex; justify-content:space-between; align-items:center;';
        cCard.innerHTML = `
          <div>
            <div style="font-weight:800; font-size:12px; color:#ecf0f1;">${c.name}</div>
            <div style="font-size:11px; color:#888;">${owned ? 'DELIVER IMMEDIATELY' : '$' + c.cost.toLocaleString()}</div>
          </div>
          <button class="buy-car-btn" style="padding:6px 12px; border-radius:6px; border:none; background:${owned ? '#27ae60' : '#8e44ad'}; color:#fff; font-weight:700; font-size:11px; cursor:pointer;">
            ${owned ? 'DELIVER' : 'BUY'}
          </button>
        `;
        cCard.querySelector('.buy-car-btn').onclick = () => {
          this.garage.buyCar(c.id, this.hero, c.cost);
          this.#render();
        };
        this.content.appendChild(cCard);
      });
    } else if (this.tab === 'contacts') {
      // Maze Bank Tester Grant (One-touch test funds)
      const fundCard = document.createElement('div');
      fundCard.style.cssText = 'background: rgba(46, 204, 113, 0.12); border: 1px solid rgba(46, 204, 113, 0.35); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      fundCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#2ecc71;">MAZE BANK TEST GRANT</div>
          <div style="font-size:11px; color:#bbb;">+$50,000 · Test Heli ($2.5k), Tank ($12k), Tuning</div>
        </div>
        <button id="claim-funds-btn" style="padding:8px 14px; border-radius:8px; border:none; background:#27ae60; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
          +$50K CASH
        </button>
      `;
      fundCard.querySelector('#claim-funds-btn').onclick = (e) => {
        e.stopPropagation();
        this.garage.addCash(50000, 'TESTER GRANT');
        this.#render();
      };
      this.content.appendChild(fundCard);

      // Feature Tour & Demo Video Recorder
      const tourCard = document.createElement('div');
      tourCard.style.cssText = 'background: rgba(255, 0, 85, 0.14); border: 1px solid rgba(255, 0, 85, 0.5); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      tourCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#ff0055;">🎬 RECORD FULL FEATURE DEMO</div>
          <div style="font-size:11px; color:#ddd;">Tokyo · Torii Arch · High Beams · Bridge · On-Foot · Arsenal · Tank</div>
        </div>
        <button id="start-tour-btn" style="padding:8px 14px; border-radius:8px; border:none; background:linear-gradient(135deg, #ff0055, #9b00e8); color:#fff; font-weight:800; font-size:11px; cursor:pointer; box-shadow:0 0 12px rgba(255,0,85,0.4);">
          🔴 RECORD
        </button>
      `;
      tourCard.querySelector('#start-tour-btn').onclick = (e) => {
        e.stopPropagation();
        this.toggle(false);
        if (typeof window !== 'undefined' && window.startFeatureTour) {
          window.startFeatureTour();
        }
      };
      this.content.appendChild(tourCard);

      // Tokyo Street / Little Tokyo GPS Destination
      const tokyoCard = document.createElement('div');
      tokyoCard.style.cssText = 'background: rgba(255, 0, 127, 0.12); border: 1px solid rgba(255, 0, 127, 0.45); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      tokyoCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#ff007f;">🏮 LITTLE TOKYO · 新宿通り</div>
          <div style="font-size:11px; color:#ddd;">Tokyo Street Life · Ramen · Izakaya · Neon Torii</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="warp-tokyo-btn" style="padding:8px 10px; border-radius:8px; border:none; background:#c2185b; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
            WARP
          </button>
          <button id="visit-tokyo-btn" style="padding:8px 10px; border-radius:8px; border:none; background:linear-gradient(135deg, #ff007f, #bd00ff); color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
            GPS
          </button>
        </div>
      `;
      tokyoCard.querySelector('#warp-tokyo-btn').onclick = (e) => {
        e.stopPropagation();
        if (typeof window !== 'undefined') {
          if (window.__warp) window.__warp(2351.5, 1356.0, -Math.PI / 2 - 0.03);
          if (window.hud?.flash) window.hud.flash('WARPED TO LITTLE TOKYO 🏮');
        }
        this.toggle(false);
      };
      tokyoCard.querySelector('#visit-tokyo-btn').onclick = (e) => {
        e.stopPropagation();
        if (typeof window !== 'undefined') {
          if (window.__setWaypoint) {
            window.__setWaypoint(2356, 1400, 'LITTLE TOKYO · 新宿通り');
          }
          if (window.hud?.flash) window.hud.flash('GPS DESTINATION · LITTLE TOKYO 🏮');
        }
        this.toggle(false);
      };
      this.content.appendChild(tokyoCard);

      // Halstead Lift Bridge GPS & Test Run
      const bridgeCard = document.createElement('div');
      bridgeCard.style.cssText = 'background: rgba(52, 152, 219, 0.12); border: 1px solid rgba(52, 152, 219, 0.45); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      bridgeCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#3498db;">🌉 HALSTEAD LIFT BRIDGE</div>
          <div style="font-size:11px; color:#ddd;">Smooth 7.6m River Span · Solid Parapet Walls · Ramped Approaches</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="warp-bridge-btn" style="padding:8px 10px; border-radius:8px; border:none; background:#2980b9; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
            WARP
          </button>
          <button id="visit-bridge-btn" style="padding:8px 10px; border-radius:8px; border:none; background:linear-gradient(135deg, #3498db, #2980b9); color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
            GPS
          </button>
        </div>
      `;
      bridgeCard.querySelector('#warp-bridge-btn').onclick = (e) => {
        e.stopPropagation();
        if (typeof window !== 'undefined') {
          if (window.__warp) window.__warp(1938, 2275, 0.06);
          if (window.hud?.flash) window.hud.flash('WARPED TO HALSTEAD LIFT BRIDGE 🌉');
        }
        this.toggle(false);
      };
      bridgeCard.querySelector('#visit-bridge-btn').onclick = (e) => {
        e.stopPropagation();
        if (typeof window !== 'undefined') {
          if (window.__setWaypoint) window.__setWaypoint(1938, 2275, 'HALSTEAD LIFT BRIDGE');
          if (window.hud?.flash) window.hud.flash('GPS DESTINATION · HALSTEAD LIFT BRIDGE 🌉');
        }
        this.toggle(false);
      };
      this.content.appendChild(bridgeCard);

      // Shooting range and hold-out (game/modes.js). window.__modes is set by main
      // once the scene exists; the cards read the player's position from onFoot/car.
      const modeCard = (title, sub, colour, onclick) => {
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
        card.innerHTML = `<div><div style="font-weight:800; font-size:13px; color:${colour};">${title}</div><div style="font-size:11px; color:#aaa;">${sub}</div></div>
          <button style="padding:8px 14px; border-radius:8px; border:none; background:${colour}; color:#fff; font-weight:800; cursor:pointer;">GO</button>`;
        card.querySelector('button').onclick = (e) => { e.stopPropagation(); onclick(); this.toggle(); };
        this.content.appendChild(card);
      };
      modeCard('SHOOTING RANGE', '60 s · six boards at 15 / 30 / 60 m · get out of the car first', '#e67e22', () => {
        const of = window.onFoot; const m = window.__modes; if (!m) return;
        if (of?.active) m.startRange(of.x, of.z, of.camYaw ?? 0); else m.hud.flash?.('RANGE · step out of the car first (F)');
      });
      modeCard('AMMU-NATION · SMG', '$1,200 · 30 rounds, sprays, close work', '#8e44ad', () => window.__buyWeapon?.('smg', 1200));
      modeCard('AMMU-NATION · RIFLE', '$3,000 · 30 rounds, tight, 120 m', '#8e44ad', () => window.__buyWeapon?.('rifle', 3000));
      modeCard('AMMU-NATION · GRENADES x3', '$600 · slot 5, E throws, 2.2 s fuse, 6 m blast', '#8e44ad', () => window.__buyGrenades?.(600));
      modeCard('AMMU-NATION · BODY ARMOUR', '$800 · soaks 60% of every hit until it is gone', '#8e44ad', () => window.__buyArmour?.(800));
      modeCard('AMMU-NATION · SHOTGUN', '$1,800 · 6 shells, eight pellets each', '#8e44ad', () => window.__buyWeapon?.('shotgun', 1800));
      modeCard('AMMU-NATION · SNIPER RIFLE', '$4,500 · key 6, 5 rounds, 240 m, a scope on right-click', '#8e44ad', () => window.__buyWeapon?.('sniper', 4500));
      modeCard('HOLD OUT', '3 minutes · wanted climbs every 40 s · officers down x50', '#c0392b', () => { window.__modes?.startHoldout(); });

      // Pegasus Helicopter Dispatch
      const heliCard = document.createElement('div');
      heliCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      heliCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#3498db;">PEGASUS HELI DISPATCH</div>
          <div style="font-size:11px; color:#aaa;">$2,500 · Direct delivery to nearest rooftop/clearing</div>
        </div>
        <button id="dispatch-heli-btn" style="padding:8px 14px; border-radius:8px; border:none; background:#2980b9; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
          CALL HELI
        </button>
      `;
      heliCard.querySelector('#dispatch-heli-btn').onclick = (e) => {
        e.stopPropagation();
        if (this.dispatch) {
          const pos = this.#getPlayerPos();
          this.dispatch.dispatchHelicopter(pos);
          this.toggle(false);
        }
      };
      this.content.appendChild(heliCard);

      // Warstock Rhino Tank Drop
      const tankCard = document.createElement('div');
      tankCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      tankCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#27ae60;">WARSTOCK RHINO TANK</div>
          <div style="font-size:11px; color:#aaa;">$12,000 / 3★ · 55T armor & 120mm smoothbore cannon</div>
        </div>
        <button id="dispatch-tank-btn" style="padding:8px 14px; border-radius:8px; border:none; background:#27ae60; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
          DROP TANK
        </button>
      `;
      tankCard.querySelector('#dispatch-tank-btn').onclick = (e) => {
        e.stopPropagation();
        if (this.dispatch) {
          const pos = this.#getPlayerPos();
          this.dispatch.dispatchTank(pos, this.traffic?.wanted || 0);
          this.toggle(false);
        }
      };
      this.content.appendChild(tankCard);

      // Pay'n'Spray / Heat Clear
      const sprayCard = document.createElement('div');
      sprayCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display:flex; justify-content:space-between; align-items:center;';
      sprayCard.innerHTML = `
        <div>
          <div style="font-weight:800; font-size:13px; color:#e74c3c;">PAY 'N' SPRAY HOTLINE</div>
          <div style="font-size:11px; color:#aaa;">$500 · Repaint chassis & wipe all wanted heat</div>
        </div>
        <button id="spray-btn" style="padding:8px 14px; border-radius:8px; border:none; background:#c0392b; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
          WIPE HEAT
        </button>
      `;
      sprayCard.querySelector('#spray-btn').onclick = (e) => {
        e.stopPropagation();
        this.garage.payAndSpray(this.hero);
        this.#render();
      };
      this.content.appendChild(sprayCard);
    } else if (this.tab === 'intel') {
      // 1. Astra Tactical AI Scanner Card
      const scannerCard = document.createElement('div');
      scannerCard.style.cssText = 'background: rgba(0, 229, 255, 0.06); border: 1px solid rgba(0, 229, 255, 0.3); border-radius: 12px; padding: 12px; display:flex; flex-direction:column; gap:8px;';
      const isScannerActive = !!this.intel?.active;
      scannerCard.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:800; font-size:12px; color:#00e5ff; letter-spacing:1px;">🛰️ ASTRA 5.1 // TACTICAL RECON</div>
            <div style="font-size:11px; color:#aaa;">Multimodal AR scanner · Chop values, police threat & safehouses</div>
          </div>
          <button id="scanner-toggle-btn" style="padding:8px 14px; border-radius:8px; border:none; background:${isScannerActive ? '#e74c3c' : '#00a8ff'}; color:#fff; font-weight:800; font-size:11px; cursor:pointer;">
            ${isScannerActive ? 'DEACTIVATE' : 'ACTIVATE (Z)'}
          </button>
        </div>
      `;
      scannerCard.querySelector('#scanner-toggle-btn').onclick = (e) => {
        e.stopPropagation();
        this.intel?.toggle();
        this.#render();
      };
      this.content.appendChild(scannerCard);

      // 2. Hero Morality & Alignment Card (Fable System)
      if (this.reputation) {
        const repCard = document.createElement('div');
        repCard.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display:flex; flex-direction:column; gap:6px;';
        const score = this.reputation.score;
        const normPct = Math.round(((score + 1000) / 2000) * 100);
        const title = this.reputation.title;
        const align = this.reputation.alignmentName;
        const color = align === 'OUTLAW' ? '#e74c3c' : align === 'VIGILANTE' ? '#3498db' : '#f1c40f';

        repCard.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11px; color:#888; font-weight:700;">HERO NOTORIETY</div>
            <div style="font-size:12px; font-weight:800; color:${color};">${title}</div>
          </div>
          <div style="background:rgba(0,0,0,0.5); border-radius:6px; height:8px; position:relative; overflow:hidden; margin:4px 0;">
            <div style="position:absolute; left:0; top:0; bottom:0; width:100%; background:linear-gradient(90deg, #e74c3c 0%, #7f8c8d 50%, #3498db 100%); opacity:0.35;"></div>
            <div style="position:absolute; top:0; bottom:0; left:${normPct}%; width:4px; transform:translateX(-50%); background:#fff; box-shadow:0 0 8px #fff;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:10px; color:#aaa;">
            <span>OUTLAW (-1000)</span>
            <span style="font-weight:700; color:#fff;">SCORE: ${score > 0 ? '+' : ''}${score}</span>
            <span>VIGILANTE (+1000)</span>
          </div>
          <div style="margin-top:6px; border-top:1px solid rgba(255,255,255,0.06); padding-top:6px;">
            <div style="font-size:10px; font-weight:700; color:#888; margin-bottom:4px;">ACTIVE PERKS:</div>
            ${this.reputation.perks.map(p => `<div style="font-size:11px; color:#ddd; margin-bottom:2px;">• <span style="font-weight:700; color:${color};">${p.name}</span>: ${p.desc}</div>`).join('')}
          </div>
        `;
        this.content.appendChild(repCard);

        // 3. Safehouse Network (Fable Asset Ownership)
        const shTitle = document.createElement('div');
        shTitle.style.cssText = 'font-weight:800; font-size:12px; color:#9b59b6; margin-top:4px; letter-spacing:0.5px;';
        shTitle.textContent = 'HALSTEAD REFUGE SAFENETWORK';
        this.content.appendChild(shTitle);

        for (const house of this.reputation.safehouses) {
          const owned = this.reputation.isOwned(house.id);
          const hCard = document.createElement('div');
          hCard.style.cssText = `background: rgba(255,255,255,0.05); border: 1px solid ${owned ? 'rgba(46, 204, 113, 0.4)' : 'rgba(255,255,255,0.1)'}; border-radius: 12px; padding: 10px; display:flex; justify-content:space-between; align-items:center;`;
          hCard.innerHTML = `
            <div style="flex:1; padding-right:8px;">
              <div style="font-weight:800; font-size:12px; color:${owned ? '#2ecc71' : '#fff'};">${house.icon} ${house.name}</div>
              <div style="font-size:10px; color:#aaa; margin-top:2px;">${house.district} · ${house.description}</div>
              <div style="font-size:11px; font-weight:700; color:${owned ? '#2ecc71' : '#f1c40f'}; margin-top:4px;">${owned ? '✓ OWNED' : `$${house.cost.toLocaleString()}`}</div>
            </div>
            <button class="safehouse-action-btn" style="padding:6px 12px; border-radius:6px; border:none; background:${owned ? '#2980b9' : '#27ae60'}; color:#fff; font-weight:700; font-size:11px; cursor:pointer; white-space:nowrap;">
              ${owned ? 'GPS ROUTE' : 'BUY'}
            </button>
          `;
          hCard.querySelector('.safehouse-action-btn').onclick = (e) => {
            e.stopPropagation();
            if (owned) {
              if (this.navigation) {
                this.navigation.setWaypoint(house.x, house.z);
                this.toggle(false);
              }
            } else {
              this.reputation.buySafehouse(house.id);
              this.#render();
            }
          };
          this.content.appendChild(hCard);
        }
      }
    }
  }

  #getPlayerPos() {
    const src = (window._activeVehicle && Number.isFinite(window._activeVehicle.x))
      ? window._activeVehicle
      : (this.car && Number.isFinite(this.car.x))
        ? this.car
        : (this.hero?.position ? { x: this.hero.position.x, y: this.hero.position.y, z: this.hero.position.z, yaw: this.hero.rotation?.y || 0 } : null);
    return {
      x: src?.x ?? 0,
      y: src?.y ?? 0,
      z: src?.z ?? 0,
      yaw: src?.yaw ?? 0,
    };
  }

  toggle(force) {
    this.open = force !== undefined ? force : !this.open;
    this.el.style.bottom = this.open ? '28px' : '-640px';
    if (this.open) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock();
      }
      this.#render();
    }
  }
}
