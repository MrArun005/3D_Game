import { STORY_MISSIONS } from '../game/storyMissions.js';

export class Phone {
  constructor(storyManager, garage, hero, traffic, dispatchService = null) {
    this.story = storyManager;
    this.garage = garage;
    this.hero = hero;
    this.traffic = traffic;
    this.dispatch = dispatchService;

    this.open = false;
    this.tab = 'missions'; // 'missions' | 'garage' | 'contacts'
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
      <div style="font-weight: 700; font-size: 13px; color: #5bc0be;">iFRUIT OS 5.0</div>
      <div id="phone-cash" style="font-weight: 800; font-size: 15px; color: #2ecc71;">$${this.garage.cash.toLocaleString()}</div>
    `;
    el.appendChild(header);

    // App Navigation Tabs
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex; background:rgba(0,0,0,0.35); border-bottom:1px solid rgba(255,255,255,0.06);';
    nav.innerHTML = `
      <button id="tab-missions" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#fff; font-weight:700; font-size:11px; cursor:pointer; border-bottom: 2px solid #3498db;">HEISTS</button>
      <button id="tab-garage" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#888; font-weight:700; font-size:11px; cursor:pointer;">TUNING</button>
      <button id="tab-contacts" style="flex:1; padding:10px 4px; border:none; background:transparent; color:#888; font-weight:700; font-size:11px; cursor:pointer;">SERVICES</button>
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
            <div style="font-weight:800; color:#2ecc71; font-size:12px;">+$${m.payout.toLocaleString()}</div>
            <button class="start-mission-btn" style="padding: 5px 12px; border-radius: 6px; border:none; background:${isCurrent ? '#e74c3c' : '#27ae60'}; color:#fff; font-weight:700; font-size:11px; cursor:pointer;">
              ${isCurrent ? 'ABANDON' : 'START HEIST'}
            </button>
          </div>
        `;
        card.querySelector('.start-mission-btn').onclick = () => {
          if (isCurrent) {
            this.story.abandon();
          } else {
            this.story.startMission(m.id, this.hero.userData?.car);
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
        const owned = this.garage.ownedCars.includes(c.id);
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
      heliCard.querySelector('#dispatch-heli-btn').onclick = () => {
        if (this.dispatch) {
          const car = this.hero.userData?.car || { x: 0, z: 0 };
          this.dispatch.dispatchHelicopter(car);
          this.toggle(false);
          this.#render();
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
      tankCard.querySelector('#dispatch-tank-btn').onclick = () => {
        if (this.dispatch) {
          const car = this.hero.userData?.car || { x: 0, z: 0 };
          this.dispatch.dispatchTank(car, this.traffic?.wanted || 0);
          this.toggle(false);
          this.#render();
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
      sprayCard.querySelector('#spray-btn').onclick = () => {
        this.garage.payAndSpray(this.hero);
        this.#render();
      };
      this.content.appendChild(sprayCard);
    }
  }

  toggle(force) {
    this.open = force !== undefined ? force : !this.open;
    this.el.style.bottom = this.open ? '28px' : '-640px';
    if (this.open) this.#render();
  }
}
