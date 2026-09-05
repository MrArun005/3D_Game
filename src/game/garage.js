import { loadHeroSkin } from '../world/vendorCars.js';

export const CATALOGUE = [
  { file: 'q-sports',     name: 'SPORTS COUPE',  price: 0 },
  { file: 'q-normal1',    name: 'SALOON',        price: 500 },
  { file: 'q-normal2',    name: 'COMPACT',       price: 700 },
  { file: 'k-hatch',      name: 'HOT HATCH',     price: 900 },
  { file: 'q-taxi',       name: 'TAXI',          price: 1000 },
  { file: 'k-van',        name: 'VAN',           price: 1200 },
  { file: 'k-truck',      name: 'PICKUP',        price: 1500 },
  { file: 'q-suv',        name: 'SUV',           price: 1800 },
  { file: 'k-suv-luxury', name: 'LUXURY SUV',    price: 2600 },
  { file: 'q-sports2',    name: 'SUPERCAR',      price: 3800 },
  { file: 'q-cop',        name: 'CRUISER',       price: 4000 },
  // owner-supplied Sketchfab bodies: real PBR, hero-only
  { file: 's-camaro-jewel',  name: "'67 CAMARO SS",     price: 6500 },
  { file: 's-camaro-350',    name: "'67 CAMARO 350",    price: 7500 },
  { file: 's-corvette-c6r',  name: 'C6.R GT2',          price: 9000 },
  { file: 's-camaro-patrol', name: 'CAMARO PATROL',     price: 9500 },
  { file: 's-corvette-zr1',  name: 'CORVETTE ZR1',      price: 14000 },
  { file: 's-monza',         name: 'MONZA',             price: 12000 },
];
const REPAIR = 150;

export class Garage {
  constructor(jobs, assets, hero, damage, hud) {
    this.jobs = jobs;
    this.assets = assets;
    this.hero = hero;
    this.damage = damage;
    this.hud = hud;

    this.owned = new Set(JSON.parse(localStorage.getItem('hb.garage') || '["q-sports"]'));
    this.fitted = localStorage.getItem('hb.body') || 'q-sports';
    if (!CATALOGUE.some((c) => c.file === this.fitted)) this.fitted = 'q-sports';
    this.cursor = CATALOGUE.findIndex((c) => c.file === this.fitted);
    this.browsing = false;

    // Performance & NOS Tuning
    this.stage = Number(localStorage.getItem('hb.tune_stage') || 1);
    this.hasNos = localStorage.getItem('hb.has_nos') === 'true';
    this.nosGauge = 1.0;
    this.nosActive = false;
  }

  get ownedCars() {
    return Array.from(this.owned);
  }

  async buyCar(carId, hero = null, cost = 0) {
    if (this.owned.has(carId)) {
      await this.#fit(carId);
      this.hud?.flash?.(`${carId.toUpperCase()} DELIVERED & FITTED`);
      return true;
    }
    if (!this.spendCash(cost)) {
      this.hud?.flash?.(`NEED $${cost.toLocaleString()} TO BUY`);
      return false;
    }
    this.owned.add(carId);
    await this.#fit(carId);
    this.hud?.flash?.(`BOUGHT & DELIVERED ${carId.toUpperCase()} -$${cost.toLocaleString()}`);
    return true;
  }

  get cash() {
    return this.jobs?.cash ?? 0;
  }

  set cash(val) {
    if (this.jobs) {
      this.jobs.cash = val;
      this.jobs.persist();
    }
  }

  addCash(amount, reason = '') {
    if (this.jobs) {
      this.jobs.cash += amount;
      this.jobs.persist();
      if (this.hud?.flash) {
        this.hud.flash(`+$${amount.toLocaleString()} ${reason ? '· ' + reason : ''}`);
      }
    }
  }

  spendCash(amount) {
    if (!this.jobs || this.jobs.cash < amount) return false;
    this.jobs.cash -= amount;
    this.jobs.persist();
    return true;
  }

  /** Fit the persisted body at start-up (the default is already on). */
  async restore() {
    if (this.fitted !== 'q-sports') await this.#fit(this.fitted);
  }

  browse() {
    this.cursor = (this.cursor + 1) % CATALOGUE.length;
    this.browsing = true;
    const c = CATALOGUE[this.cursor];
    const tag = c.file === this.fitted ? 'FITTED' : this.owned.has(c.file) ? 'OWNED · N TO FIT' : `$${c.price} · N TO BUY`;
    this.hud.flash(`GARAGE · ${c.name} · ${tag}   (B next)`);
  }

  async act() {
    const c = CATALOGUE[this.cursor];
    if (!this.browsing || c.file === this.fitted) {
      // repair -- and a respray: below three stars the garage also loses the police (GTA's Pay 'n' Spray; main wires onRepair)
      const heat = this.heat?.() ?? 0;
      if (this.damage?.value <= 0.02 && heat <= 0) { this.hud.flash('NOTHING TO REPAIR'); return; }
      if (!this.spendCash(REPAIR)) { this.hud.flash(`REPAIR $${REPAIR} · NOT ENOUGH CASH`); return; }
      this.damage?.repair();
      const cleared = this.onRepair?.();
      this.hud.flash(cleared ? `RESPRAYED · HEAT GONE · -$${REPAIR}` : `REPAIRED · -$${REPAIR}`);
      return;
    }
    if (!this.owned.has(c.file)) {
      if (!this.spendCash(c.price)) { this.hud.flash(`${c.name} · $${c.price} · NOT ENOUGH CASH`); return; }
      this.owned.add(c.file);
    }
    await this.#fit(c.file);
    this.hud.flash(`${c.name} FITTED`);
  }

  /** Drive what you stole: fit a body without buying it. */
  async wear(file) {
    if (file && file !== this.fitted) await this.#fit(file);
  }

  async #fit(file) {
    const u = this.hero.userData;
    if (u.skin) { u.skin.parent?.remove(u.skin); u.skin = null; }
    const ok = await loadHeroSkin(this.assets, this.hero, file);
    if (!ok) { this.hud.flash('GARAGE CLOSED'); return; }
    this.fitted = file;
    this.damage?.attach(this.hero);
    try {
      localStorage.setItem('hb.body', file);
      localStorage.setItem('hb.garage', JSON.stringify([...this.owned]));
    } catch { /* private mode */ }
    this.browsing = false;
  }

  /** Hold Shift to trigger nitrous boost */
  setNos(active) {
    if (!this.hasNos) return false;
    this.nosActive = active && this.nosGauge > 0.05;
    return this.nosActive;
  }

  /** Update NOS recharge and speed boost */
  update(dt, car) {
    if (this.nosActive && this.nosGauge > 0) {
      this.nosGauge = Math.max(0, this.nosGauge - dt * 0.28);
      if (Math.abs(car.fwdSpeed) > 2) {
        car.vx += Math.cos(car.yaw) * 26 * dt;
        car.vz -= Math.sin(car.yaw) * 26 * dt;
      }
      if (this.nosGauge <= 0) this.nosActive = false;
    } else {
      this.nosGauge = Math.min(1.0, this.nosGauge + dt * 0.08);
    }
  }

  /** Pay'n'Spray: Respray car and wipe police heat immediately */
  payAndSpray(traffic) {
    if (!this.spendCash(500)) {
      this.hud.flash('NEED $500 FOR RESPLAY');
      return false;
    }
    if (traffic) traffic.standDown();
    const colors = [0x991111, 0x113399, 0x111111, 0xd0c020, 0x157733, 0xee5500, 0x882288];
    const newColor = colors[Math.floor(Math.random() * colors.length)];
    if (this.hero?.userData?.hull?.material) {
      this.hero.userData.hull.material.color.setHex(newColor);
    }
    this.hud.flash('PAY\'N\'SPRAY: POLICE HEAT WIPED! -$500');
    return true;
  }

  /** Buy NOS */
  installNos() {
    if (this.hasNos) return false;
    if (!this.spendCash(3000)) {
      this.hud.flash('NEED $3,000 FOR NITROUS OXIDE');
      return false;
    }
    this.hasNos = true;
    this.nosGauge = 1.0;
    localStorage.setItem('hb.has_nos', 'true');
    this.hud.flash('NITROUS OXIDE INSTALLED! HOLD SHIFT TO BOOST');
    return true;
  }

  /** Upgrade Engine */
  tuneEngine() {
    if (this.stage >= 3) {
      this.hud.flash('ENGINE AT MAX TUNE (STAGE 3)');
      return false;
    }
    const cost = this.stage === 1 ? 4000 : 8000;
    if (!this.spendCash(cost)) {
      this.hud.flash(`NEED $${cost.toLocaleString()} FOR STAGE ${this.stage + 1} TUNE`);
      return false;
    }
    this.stage++;
    localStorage.setItem('hb.tune_stage', String(this.stage));
    this.hud.flash(`STAGE ${this.stage} TURBO TUNE INSTALLED!`);
    return true;
  }
}
