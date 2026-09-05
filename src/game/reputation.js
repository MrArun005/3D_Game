/**
 * Fable-style Morality, Notoriety & Hero Alignment System + Safehouse Network.
 *
 * Tracks player alignment from -1000 (Halstead Kingpin / Outlaw) to
 * +1000 (Apex Vigilante / Guardian). Modulates gameplay perks, shop economy,
 * and police heat dissipation. Manages player-owned safehouses across
 * Halstead Bay for heat shedding and vehicle repair.
 */

export const SAFENETWORK = [
  {
    id: 'marina_loft',
    name: 'Marina Cove Hideout',
    district: 'Marina',
    cost: 15000,
    x: 2150,
    z: 980,
    icon: '🏠',
    description: 'Secluded waterfront loft with private alley parking. Perfect for shedding maritime heat.',
  },
  {
    id: 'steelgate_bunker',
    name: 'Steelgate Industrial Bunker',
    district: 'Steelgate',
    cost: 28000,
    x: 3620,
    z: 1250,
    icon: '🏭',
    description: 'Reinforced warehouse with heavy steel shutters and chop-shop tools.',
  },
  {
    id: 'downtown_penthouse',
    name: 'Halstead Heights Penthouse',
    district: 'Downtown',
    cost: 65000,
    x: 1050,
    z: 850,
    icon: '🏢',
    description: 'Luxury high-rise penthouse overlooking the city. Supreme prestige and total immunity.',
  },
];

export class ReputationSystem {
  constructor(garage, audio = null, hud = null) {
    this.garage = garage;
    this.audio = audio;
    this.hud = hud;

    // Load saved state or default
    this.score = 0; // -1000 to +1000
    this.ownedSafehouses = new Set();
    this.safehouses = SAFENETWORK.map(s => ({ ...s }));
    this.#load();

    this.lastSafehouseCooldown = 0;
    this.cleanDrivingTimer = 0;
  }

  #load() {
    try {
      if (typeof localStorage !== 'undefined') {
        const savedScore = localStorage.getItem('halstead_reputation');
        if (savedScore !== null) this.score = Math.max(-1000, Math.min(1000, Number(savedScore) || 0));

        const savedHouses = localStorage.getItem('halstead_safehouses');
        if (savedHouses) {
          const ids = JSON.parse(savedHouses);
          if (Array.isArray(ids)) {
            for (const id of ids) this.ownedSafehouses.add(id);
          }
        }
      }
    } catch {
      // LocalStorage unavailable in sandbox or private mode
    }
  }

  #save() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('halstead_reputation', String(this.score));
        localStorage.setItem('halstead_safehouses', JSON.stringify([...this.ownedSafehouses]));
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Adjust alignment by delta (- for Outlaw, + for Vigilante).
   */
  adjust(delta, reason = '') {
    const prevTitle = this.title;
    this.score = Math.max(-1000, Math.min(1000, this.score + delta));
    this.#save();

    if (this.hud && reason) {
      const tag = delta < 0 ? `OUTLAW ${delta}` : `VIGILANTE +${delta}`;
      const color = delta < 0 ? '#e74c3c' : '#3498db';
      this.hud.flash(`${reason} · ${tag}`);
    }

    if (this.title !== prevTitle && this.hud) {
      this.hud.flash(`⭐ ALIGNMENT RANK: ${this.title} ⭐`);
      if (this.audio?.cash) this.audio.cash();
    }
  }

  get title() {
    if (this.score <= -750) return 'HALSTEAD KINGPIN';
    if (this.score <= -300) return 'STREET SYNDICATE';
    if (this.score <= -80)  return 'WANTED OUTLAW';
    if (this.score < 80)    return 'STREET DRIVER';
    if (this.score < 300)   return 'CIVIL GUARDIAN';
    if (this.score < 750)   return 'CRIME HUNTER';
    return 'APEX VIGILANTE';
  }

  get alignmentName() {
    if (this.score < -80) return 'OUTLAW';
    if (this.score > 80) return 'VIGILANTE';
    return 'NEUTRAL';
  }

  /**
   * Returns current perks based on reputation score.
   */
  get perks() {
    const perks = [];
    if (this.score <= -80) {
      perks.push({ name: 'Chop Shop Bonus', desc: '+20% Black Market vehicle payouts' });
    }
    if (this.score <= -300) {
      perks.push({ name: 'Street Intimidation', desc: 'Civilian traffic yields quickly to aggressive driving' });
    }
    if (this.score <= -750) {
      perks.push({ name: 'Underworld Network', desc: 'Police radar detection time doubled' });
    }

    if (this.score >= 80) {
      perks.push({ name: 'Bounty License', desc: '+25% cash on contract jobs and rogue stops' });
    }
    if (this.score >= 300) {
      perks.push({ name: 'Guardian Armor', desc: '25% reduced vehicle damage taken' });
    }
    if (this.score >= 750) {
      perks.push({ name: 'Civic Priority', desc: 'Heat level drops 50% faster in alleyways' });
    }

    if (!perks.length) {
      perks.push({ name: 'Rookie Hustle', desc: 'Choose Outlaw or Vigilante path through city actions' });
    }
    return perks;
  }

  isOwned(safehouseId) {
    return this.ownedSafehouses.has(safehouseId);
  }

  buySafehouse(safehouseId) {
    const house = this.safehouses.find(s => s.id === safehouseId);
    if (!house || this.isOwned(safehouseId)) return false;

    if (typeof this.garage.spendCash === 'function' && !this.garage.spendCash(house.cost)) {
      if (this.hud) this.hud.flash(`INSUFFICIENT FUNDS · NEED $${house.cost.toLocaleString()}`);
      return false;
    }

    this.ownedSafehouses.add(safehouseId);
    this.#save();
    if (this.audio?.cash) this.audio.cash();
    if (this.hud) this.hud.flash(`🏠 PURCHASED: ${house.name}! REFUGE UNLOCKED.`);
    return true;
  }

  /**
   * Called in main update loop to check safehouse proximity & clean driving.
   */
  update(dt, playerX, playerZ, traffic, car, damageModel) {
    const now = performance.now();

    // Check safehouse entry (within 22m of any owned safehouse)
    if (now > this.lastSafehouseCooldown) {
      for (const house of this.safehouses) {
        if (!this.isOwned(house.id)) continue;
        const d = Math.hypot(playerX - house.x, playerZ - house.z);
        if (d < 22) {
          this.lastSafehouseCooldown = now + 8000; // 8s cooldown before re-triggering

          let healed = false;
          if (traffic && traffic.wanted > 0) {
            traffic.wanted = 0;
            healed = true;
          }
          if (damageModel && typeof damageModel.repair === 'function') {
            damageModel.repair();
            if (car) car.hp = 100;
            healed = true;
          }

          if (this.hud) {
            this.hud.flash(`🏠 ${house.name} · HEAT CLEARED · VEHICLE REPAIRED!`);
          }
          if (this.audio?.cash) this.audio.cash();
          break;
        }
      }
    }

    // Clean driving passive vigilance tracker
    if (car && Math.hypot(car.vx || 0, car.vz || 0) > 10 && (!traffic || traffic.wanted === 0)) {
      this.cleanDrivingTimer += dt;
      if (this.cleanDrivingTimer > 45) {
        this.cleanDrivingTimer = 0;
        this.adjust(10, 'CLEAN DRIVING MILESTONE');
      }
    } else {
      this.cleanDrivingTimer = Math.max(0, this.cleanDrivingTimer - dt * 0.5);
    }
  }
}
