import { loadHeroSkin, DEFAULT_BODY } from '../world/vendorCars.js';
import { getVehicleProfile } from '../vehicle/config.js';

/* The chop shop (2026-09-09). Drive a car you do not OWN -- a carjack or a
   break-in fits the victim's body without buying it -- to the Steelgate
   warehouse and press N inside 60 m: it pays 35% of the showroom price (a
   fifth more with the Chop Shop perk, reputation <= -80), costs 40
   reputation, and puts you back in the last body you actually owned. It is
   the heist_2 weapons stash, so the map's one criminal address stays one
   address. The AR scanner (intel.js) quotes the same number over traffic. */
export const CHOP_SHOP = { x: 3662, z: 1221, r: 60, name: 'STEELGATE CHOP SHOP' };
export function chopValue(file, outlaw = false) {
  const c = CATALOGUE.find((k) => k.file === file);
  const base = Math.max(200, Math.round((c?.price ?? 600) * 0.35));
  return outlaw ? Math.round(base * 1.2) : base;
}

export const CATALOGUE = [
  // Premier High-Poly PBR Hero Sports Cars
  { file: 's-corvette-zr1',  name: 'CORVETTE C8 ZR1',   price: 0 },
  { file: 's-monza',         name: 'MONZA SP1',         price: 4500 },
  { file: 's-corvette-c6r',  name: 'C6.R GT2',          price: 5000 },
  { file: 's-camaro-jewel',  name: "'67 CAMARO SS",     price: 3500 },
  { file: 's-camaro-350',    name: "'67 CAMARO 350",    price: 4000 },
  { file: 's-camaro-patrol', name: 'CAMARO PATROL',     price: 6000 },
  { file: 's-porsche-gt3r',  name: '992 GT3 R',         price: 7500 },
  { file: 's-f40-comp',      name: 'F40 COMPETIZIONE',  price: 9000 },
  // Procedural bodies (vehicle/waymo.js) — no vendor file, no licence
  { file: 'p-waymo',         name: 'WAYMO I-PACE',      price: 5200 },
  // Standard & Street Fleet
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
];
/* Repair is priced by the damage on the car, plus a respray when you are hot:
   a scuffed wing is $100, a wreck at 100% is $700, and the police pay-off is
   $200 on top. A flat $150 (2026-09-08 and before) made crashing free. */
const repairCost = (damage, hot) => Math.round(100 + 600 * Math.min(1, damage)) + (hot ? 200 : 0);

export class Garage {
  constructor(jobs, assets, hero, damage, hud, car = null) {
    this.jobs = jobs;
    this.assets = assets;
    this.hero = hero;
    this.damage = damage;
    this.hud = hud;
    this.car = car;

    const storedGarage = localStorage.getItem('hb.garage');
    /* The default body and premier race cars are owned by default for instant track readiness */
    this.owned = new Set(JSON.parse(storedGarage || JSON.stringify(['q-sports', DEFAULT_BODY, 's-porsche-gt3r', 's-corvette-c6r'])));
    this.fitted = localStorage.getItem('hb.body') || DEFAULT_BODY;   // ONE default: vendorCars.DEFAULT_BODY
    if (!CATALOGUE.some((c) => c.file === this.fitted)) this.fitted = DEFAULT_BODY;
    this.cursor = CATALOGUE.findIndex((c) => c.file === this.fitted);
    this.browsing = false;
    this.lastOwned = this.owned.has(this.fitted) ? this.fitted : 'q-sports';   // what the chop shop hands you back

    if (this.car) {
      this.car.profile = getVehicleProfile(this.fitted);
    }

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
      // a stolen body: the only thing N does with it is sell it, and only at the chop shop
      if (!this.owned.has(this.fitted)) {
        const at = this.where?.();
        const d = at ? Math.hypot(at.x - CHOP_SHOP.x, at.z - CHOP_SHOP.z) : Infinity;
        const rep = (typeof window !== 'undefined') ? window._reputation : null;
        const pay = chopValue(this.fitted, (rep?.score ?? 0) <= -80);
        const name = CATALOGUE.find((k) => k.file === this.fitted)?.name ?? this.fitted.toUpperCase();
        if (d > CHOP_SHOP.r) { this.hud.flash(`STOLEN ${name} · CHOP $${pay} AT ${CHOP_SHOP.name} (${Math.round(d)} m)`); return; }
        this.addCash(pay, `CHOP SHOP · ${name}`);
        rep?.adjust(-40, 'CHOP SHOP SALE');
        await this.wear(this.lastOwned);
        return;
      }
      // repair -- and a respray: below three stars the garage also loses the police (GTA's Pay 'n' Spray; main wires onRepair)
      const heat = this.heat?.() ?? 0;
      if (this.damage?.value <= 0.02 && heat <= 0) { this.hud.flash('NOTHING TO REPAIR'); return; }
      const REPAIR = repairCost(this.damage?.value ?? 0, heat > 0);
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
    if (!file || file === this.fitted) return;
    if (this.owned.has(this.fitted)) this.lastOwned = this.fitted;   // remember what to come back to
    await this.#fit(file);
  }

  async #fit(file) {
    const u = this.hero.userData;
    if (u.skin) { u.skin.parent?.remove(u.skin); u.skin = null; }
    const ok = await loadHeroSkin(this.assets, this.hero, file);
    if (!ok) { this.hud.flash('GARAGE CLOSED'); return; }
    this.fitted = file;
    if (this.car) {
      this.car.profile = getVehicleProfile(file);
    }
    this.damage?.attach(this.hero);
    try {
      localStorage.setItem('hb.body', file);
      localStorage.setItem('hb.garage', JSON.stringify([...this.owned]));
    } catch { /* private mode */ }
    this.browsing = false;
  }

  /** Immediately equip and fit a dedicated race car */
  async equipRaceCar(file = 's-porsche-gt3r') {
    this.owned.add(file);
    await this.#fit(file);
    return true;
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
