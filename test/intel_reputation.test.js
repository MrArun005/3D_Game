import test from 'node:test';
import assert from 'node:assert/strict';
import { ReputationSystem, SAFENETWORK } from '../src/game/reputation.js';
import { IntelScanner } from '../src/game/intel.js';
import { createGrade } from '../src/core/grade.js';

test('ReputationSystem initializes with baseline neutral score and default safehouses', () => {
  const fakeGarage = { cash: 50000, spendCash(amt) { if (this.cash >= amt) { this.cash -= amt; return true; } return false; } };
  const rep = new ReputationSystem(fakeGarage);

  assert.equal(typeof rep.score, 'number');
  assert.equal(rep.safehouses.length, SAFENETWORK.length);
  assert.equal(rep.alignmentName, 'NEUTRAL');
});

test('ReputationSystem bounds score between -1000 and +1000 and calculates ranks correctly', () => {
  const fakeGarage = { cash: 100000, spendCash() { return true; } };
  const rep = new ReputationSystem(fakeGarage);

  rep.adjust(-2000);
  assert.equal(rep.score, -1000);
  assert.equal(rep.title, 'HALSTEAD KINGPIN');
  assert.equal(rep.alignmentName, 'OUTLAW');

  rep.adjust(1500);
  assert.equal(rep.score, 500);
  assert.equal(rep.title, 'CRIME HUNTER');
  assert.equal(rep.alignmentName, 'VIGILANTE');

  rep.adjust(1000);
  assert.equal(rep.score, 1000);
  assert.equal(rep.title, 'APEX VIGILANTE');
});

test('ReputationSystem unlocks perks dynamically based on alignment', () => {
  const fakeGarage = { cash: 50000 };
  const rep = new ReputationSystem(fakeGarage);

  rep.score = -800;
  const outlawPerks = rep.perks;
  assert.ok(outlawPerks.some(p => p.name === 'Underworld Network'));
  assert.ok(outlawPerks.some(p => p.name === 'Chop Shop Bonus'));

  rep.score = 800;
  const vigilantePerks = rep.perks;
  assert.ok(vigilantePerks.some(p => p.name === 'Civic Priority'));
  assert.ok(vigilantePerks.some(p => p.name === 'Guardian Armor'));
  assert.ok(vigilantePerks.some(p => p.name === 'Bounty License'));
});

test('ReputationSystem safehouse purchasing and proximity refuge healing', () => {
  let cashSpent = 0;
  const fakeGarage = {
    cash: 50000,
    spendCash(amt) {
      if (this.cash >= amt) {
        this.cash -= amt;
        cashSpent += amt;
        return true;
      }
      return false;
    }
  };
  const rep = new ReputationSystem(fakeGarage);
  const house = rep.safehouses[0];

  assert.equal(rep.isOwned(house.id), false);
  const bought = rep.buySafehouse(house.id);
  assert.equal(bought, true);
  assert.equal(rep.isOwned(house.id), true);
  assert.equal(cashSpent, house.cost);

  // Test proximity refuge (clears heat, repairs car)
  const fakeTraffic = { wanted: 4 };
  const fakeCar = { hp: 20 };
  let repaired = false;
  const fakeDamageModel = { repair() { repaired = true; } };

  // Far from safehouse: no repair
  rep.update(0.016, house.x + 100, house.z + 100, fakeTraffic, fakeCar, fakeDamageModel);
  assert.equal(fakeTraffic.wanted, 4);
  assert.equal(repaired, false);

  // Inside safehouse radius (within 22m)
  rep.lastSafehouseCooldown = 0;
  rep.update(0.016, house.x + 5, house.z + 5, fakeTraffic, fakeCar, fakeDamageModel);
  assert.equal(fakeTraffic.wanted, 0);
  assert.equal(fakeCar.hp, 100);
  assert.equal(repaired, true);
});

test('IntelScanner instantiates safely in headless environment and toggles state', () => {
  const scanner = new IntelScanner();
  assert.equal(scanner.active, false);

  const active = scanner.toggle();
  assert.equal(active, true);
  assert.equal(scanner.active, true);

  scanner.toggle();
  assert.equal(scanner.active, false);
});

test('createGrade no-post fallback has setSpeed and setHurt methods', () => {
  const gradeNoPost = createGrade(null, null, null, { post: false });
  assert.equal(typeof gradeNoPost.setSpeed, 'function');
  assert.equal(typeof gradeNoPost.setHurt, 'function');
  assert.doesNotThrow(() => {
    gradeNoPost.setSpeed(0.8);
    gradeNoPost.setHurt(0.5);
  });
});
