import { loadHeroSkin } from '../world/vendorCars.js';

/**
 * The garage: where the job money goes.
 *
 *   B  browse the next body (price shown; owned ones say so)
 *   N  buy and fit the shown body, or repair the current one for $150
 *
 * Bodies are the Kenney Car Kit files the fleet already ships; fitting one
 * re-skins the hero over the same physics hull (vendorCars.loadHeroSkin), so
 * handling never changes -- only what you look at. Owned bodies and the
 * fitted one persist in localStorage.
 */
const CATALOGUE = [
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
const REPAIR = 150;

export class Garage {
  constructor(jobs, assets, hero, damage, hud) {
    this.jobs = jobs; this.assets = assets; this.hero = hero; this.damage = damage; this.hud = hud;
    this.owned = new Set(JSON.parse(localStorage.getItem('hb.garage') || '["q-sports"]'));
    this.fitted = localStorage.getItem('hb.body') || 'q-sports';
    if (!CATALOGUE.some((c) => c.file === this.fitted)) this.fitted = 'q-sports';   // ids changed 2026-09-02
    this.cursor = CATALOGUE.findIndex((c) => c.file === this.fitted);
    this.browsing = false;
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
      // repair
      if (this.damage.value <= 0.02) { this.hud.flash('NOTHING TO REPAIR'); return; }
      if (this.jobs.cash < REPAIR) { this.hud.flash(`REPAIR $${REPAIR} · NOT ENOUGH CASH`); return; }
      this.jobs.cash -= REPAIR; this.jobs.persist(); this.damage.repair();
      this.hud.flash(`REPAIRED · -$${REPAIR}`); return;
    }
    if (!this.owned.has(c.file)) {
      if (this.jobs.cash < c.price) { this.hud.flash(`${c.name} · $${c.price} · NOT ENOUGH CASH`); return; }
      this.jobs.cash -= c.price; this.owned.add(c.file); this.jobs.persist();
    }
    await this.#fit(c.file);
    this.hud.flash(`${c.name} FITTED`);
  }

  /** Drive what you stole: fit a body without buying it. */
  async wear(file) { if (file && file !== this.fitted) await this.#fit(file); }

  async #fit(file) {
    const u = this.hero.userData;
    if (u.skin) { u.skin.parent?.remove(u.skin); u.skin = null; }
    const ok = await loadHeroSkin(this.assets, this.hero, file);
    if (!ok) { this.hud.flash('GARAGE CLOSED'); return; }
    this.fitted = file;
    this.damage.attach(this.hero);         // the new body is what dents now
    try { localStorage.setItem('hb.body', file); localStorage.setItem('hb.garage', JSON.stringify([...this.owned])); } catch { /* private mode */ }
    this.browsing = false;
  }
}
