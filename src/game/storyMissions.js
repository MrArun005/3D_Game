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
  constructor(mission, traffic, hud, garage, audio = null, navigation = null) {
    this.mission = mission;
    this.traffic = traffic;
    this.hud = hud;
    this.garage = garage;
    this.audio = audio;
    this.navigation = navigation;

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
      if (this.hud?.showVictoryBanner) {
        this.hud.showVictoryBanner(this.active.title, this.active.subtitle, reward);
      } else if (this.hud?.flash) {
        this.hud.flash(`MISSION COMPLETE! +$${reward.toLocaleString()}`);
      }
      if (this.audio?.victoryFanfare) {
        this.audio.victoryFanfare();
      }
      if (this.mission) this.mission.stop(`PASSED · +$${reward}`);
      if (this.navigation) this.navigation.clearWaypoint();
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
    // Auto-map navigation GPS route directly to challenge target
    if (this.navigation && step.target) {
      this.navigation.setWaypoint(step.target.x, step.target.z);
      this.navigation.lastTarget = null;
    }
  }

  update(car, dt) {
    if (!this.active) return;
    const step = this.active.steps[this.stepIdx];
    if (!step) return;

    // Check distance to target and speed
    const dist = Math.hypot(car.x - step.target.x, car.z - step.target.z);
    const speed = Math.abs(car.fwdSpeed ?? car.speed ?? 0);
    const radius = step.radius || 24;
    const inRange = dist < radius;

    // Visual marker & guidance for zero-heat requirements
    if (step.needZeroHeat) {
      const wanted = this.traffic?.wanted || 0;
      if (wanted > 0) {
        if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0xff3b30); // RED
        this._heatWarn = (this._heatWarn || 0) + dt;
        if (this._heatWarn > 2.0 && (inRange || dist < 65)) {
          this._heatWarn = 0;
          this.hud?.flash(`🚨 DROP LOCKED (${Math.ceil(wanted)}★ HEAT)! EVADE COPS OR CALL PAY 'N' SPRAY [PHONE M]`);
        }
        return;
      } else {
        if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0x2ecc71); // GREEN
      }
    } else {
      if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0xffc23c); // GOLD
    }

    if (inRange) {
      // If player is flying through at high speed, prompt them to come to a stop
      if (speed > 6.5) {
        this._stopWarn = (this._stopWarn || 0) + dt;
        if (this._stopWarn > 1.2) {
          this._stopWarn = 0;
          this.hud?.flash('🛑 COME TO A STOP IN ZONE TO SECURE OBJECTIVE');
        }
        return;
      }
      // Step complete!
      this.stepIdx++;
      if (this.audio?.cash) this.audio.cash();
      this.hud?.flash(`OBJECTIVE SECURED · STEP ${this.stepIdx}/${this.active.steps.length}`);
      this.#advanceStep(car);
    }
  }

  abandon() {
    if (this.active) {
      if (this.mission) this.mission.stop('MISSION ABANDONED');
      if (this.navigation) this.navigation.clearWaypoint();
      this.active = null;
      this.stepIdx = 0;
    }
  }
}
