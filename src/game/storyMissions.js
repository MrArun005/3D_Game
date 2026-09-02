export const STORY_MISSIONS = [
  {
    id: 'heist_1',
    type: 'heist',
    title: 'HEIST I: THE HARBOUR JEWEL',
    subtitle: 'Steal the rare Camaro SS from the docks',
    payout: 7500,
    heat: 2,
    steps: [
      { text: 'DRIVE TO HARBOUR POINT DEPOT', target: { x: 380, z: -140 }, radius: 18 },
      { text: 'CONTAINER BREACHED · LOSE 2-STAR HEAT', target: { x: 120, z: 240 }, radius: 24, needZeroHeat: true },
      { text: 'DELIVER THE CAMARO TO SAFEHOUSE', target: { x: -80, z: 60 }, radius: 15 }
    ]
  },
  {
    id: 'heist_2',
    type: 'heist',
    title: 'HEIST II: SCHNEIDER\'S WEAPONS RAID',
    subtitle: 'Ambush military convoy outside gun shop',
    payout: 20000,
    heat: 3,
    steps: [
      { text: 'MEET THE CREW AT OLD QUARTER GUN SHOP', target: { x: -210, z: 180 }, radius: 20 },
      { text: 'CARGO SECURED · SHAKE 3-STAR TACTICAL PURSUIT', target: { x: 40, z: -320 }, radius: 25, needZeroHeat: true },
      { text: 'STASH WEAPONS AT STEELGATE WAREHOUSE', target: { x: -350, z: -180 }, radius: 18 }
    ]
  },
  {
    id: 'heist_3',
    type: 'heist',
    title: 'HEIST III: KINGSWAY FEDERAL VAULT',
    subtitle: 'The Grand Score: Crack the downtown vault',
    payout: 60000,
    heat: 4,
    steps: [
      { text: 'BREACH THE KINGSWAY VAULT PLAZA', target: { x: 20, z: -15 }, radius: 22 },
      { text: 'VAULT CRACKED · EVADE 4-STAR SWAT & CHOPPER', target: { x: 420, z: 350 }, radius: 30, needZeroHeat: true },
      { text: 'FINAL DROP: JETTY GETAWAY BOAT', target: { x: 580, z: -80 }, radius: 20 }
    ]
  },
  {
    id: 'bounty_1',
    type: 'bounty',
    title: 'HITMAN: THE SYNDICATE ENFORCER',
    subtitle: 'Take down the crime boss cruiser',
    payout: 12000,
    heat: 1,
    steps: [
      { text: 'LOCATE TARGET VEHICLE IN THE FLATS', target: { x: -160, z: -90 }, radius: 25 },
      { text: 'RAM OR ELIMINATE THE TARGET ENFORCER', target: { x: -140, z: 40 }, radius: 30 },
      { text: 'DROP TO GROUND ZERO AND LAY LOW', target: { x: 60, z: 120 }, radius: 20, needZeroHeat: true }
    ]
  },
  {
    id: 'race_1',
    type: 'race',
    title: 'MIDNIGHT TOKYO CIRCUIT',
    subtitle: 'High-speed street race through downtown',
    payout: 15000,
    heat: 0,
    steps: [
      { text: 'CHECKPOINT 1: COAST HIGHWAY', target: { x: 180, z: -200 }, radius: 25 },
      { text: 'CHECKPOINT 2: TUNNEL ENTRANCE', target: { x: 320, z: 10 }, radius: 25 },
      { text: 'CHECKPOINT 3: KINGSWAY OVERPASS', target: { x: 80, z: 220 }, radius: 25 },
      { text: 'FINAL SPRINT: FINISH LINE', target: { x: 24, z: 6 }, radius: 20 }
    ]
  }
];

export class StoryManager {
  constructor(mission, traffic, hud, garage) {
    this.mission = mission;
    this.traffic = traffic;
    this.hud = hud;
    this.garage = garage;

    this.active = null;
    this.stepIdx = 0;
  }

  startMission(missionId, car) {
    const def = STORY_MISSIONS.find((m) => m.id === missionId);
    if (!def) return false;
    this.active = def;
    this.stepIdx = 0;
    this.#advanceStep(car);
    if (this.hud?.flash) {
      this.hud.flash(`${def.title} STARTED`);
    }
    return true;
  }

  #advanceStep(car) {
    if (!this.active) return;
    if (this.stepIdx >= this.active.steps.length) {
      // Completed!
      const reward = this.active.payout;
      this.garage.addCash(reward, 'MISSION PASSED');
      this.hud.flash(`MISSION COMPLETE! +$${reward.toLocaleString()}`);
      if (this.mission) this.mission.stop(`PASSED · +$${reward}`);
      this.active = null;
      this.stepIdx = 0;
      return;
    }

    const step = this.active.steps[this.stepIdx];
    // Escalate heat if step specifies
    if (this.stepIdx === 1 && this.active.heat > 0 && this.traffic) {
      this.traffic.wanted = Math.max(this.traffic.wanted, this.active.heat);
    }
    // Route mission marker to target
    if (this.mission && step.target) {
      this.mission.route([step.target], step.text);
    }
  }

  update(car, dt) {
    if (!this.active) return;
    const step = this.active.steps[this.stepIdx];
    if (!step) return;

    // Check distance to target
    const dist = Math.hypot(car.x - step.target.x, car.z - step.target.z);
    if (dist < (step.radius || 20)) {
      if (step.needZeroHeat && this.traffic?.wanted > 0) {
        if (Math.random() < 0.05) this.hud.flash('COPS ARE STILL ON YOU · LOSE THE HEAT!');
        return;
      }
      // Step complete!
      this.stepIdx++;
      this.#advanceStep(car);
    }
  }

  abandon() {
    if (this.active) {
      if (this.mission) this.mission.stop('MISSION ABANDONED');
      this.active = null;
      this.stepIdx = 0;
    }
  }
}
