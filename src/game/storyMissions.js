import { remapMission } from '../world/playArea.js';

export const STORY_MISSIONS = [
  {
    id: 'heist_1',
    type: 'heist',
    title: 'HEIST I: THE HARBOUR JEWEL',
    subtitle: 'Steal the rare Camaro SS from the docks',
    payout: 7500,
    heat: 2,
    steps: [
      { text: 'DRIVE TO HARBOUR POINT DEPOT', target: { x: 2156, z: 2436 }, radius: 24 },
      { text: 'CONTAINER BREACHED · LOSE 2-STAR HEAT', target: { x: 1163, z: 1864 }, radius: 28, needZeroHeat: true },
      { text: 'DELIVER THE CAMARO TO SAFEHOUSE', target: { x: 1387, z: 1092 }, radius: 22 }
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
      { text: 'MEET THE CREW AT OLD QUARTER GUN SHOP', target: { x: 1387, z: 1092 }, radius: 24 },
      { text: 'CARGO SECURED · SHAKE 3-STAR TACTICAL PURSUIT', target: { x: 2167, z: 469 }, radius: 32, needZeroHeat: true },
      { text: 'STASH WEAPONS AT STEELGATE WAREHOUSE', target: { x: 3662, z: 1221 }, radius: 26 }
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
      { text: 'BREACH THE KINGSWAY VAULT PLAZA', target: { x: 2196, z: 1300 }, radius: 26 },
      { text: 'VAULT CRACKED · EVADE 4-STAR SWAT & CHOPPER', target: { x: 773, z: 539 }, radius: 34, needZeroHeat: true },
      { text: 'FINAL DROP: JETTY GETAWAY BOAT', target: { x: 2300, z: 2550 }, radius: 26 }
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
      { text: 'LOCATE TARGET VEHICLE IN THE FLATS', target: { x: 500, z: 1851 }, radius: 28 },
      { text: 'ELIMINATE THE ENFORCER AND HIS TWO GUARDS', target: { x: 1163, z: 1864 }, radius: 32, needDowned: 3 },
      { text: 'DROP TO GROUND ZERO AND LAY LOW', target: { x: 2350, z: 1350 }, radius: 25, needZeroHeat: true }
    ]
  },
  {
    id: 'tokyo_1',
    type: 'bounty',
    title: 'LITTLE TOKYO: THE YOKOCHO DEBT',
    subtitle: 'Collect at the ramen alley; the syndicate will not let it go quietly',
    payout: 9000,
    heat: 2,
    steps: [
      { text: 'MEET THE COOK AT RAMEN YOKOCHO', target: { x: 2320, z: 1410 }, radius: 22 },
      { text: 'THE SYNDICATE CALLED IT IN · HOLD KABUKICHO · THREE DOWN', target: { x: 2450, z: 1405 }, radius: 36, needDowned: 3 },
      { text: 'LOSE THE HEAT · LIE LOW AT THE CAPSULE HOTEL', target: { x: 2285, z: 1510 }, radius: 24, needZeroHeat: true },
    ],
  },
  {
    id: 'standoff_1',
    type: 'bounty',
    title: 'DEPOT STAND-OFF',
    giver: 'Sgt. Vale',
    pay: 6500,
    brief: 'Vale wants a rival crew gone from the Harbour Point depot. They will call it in. Hold the ground until four are down, then get clear.',
    steps: [
      { text: 'GET TO THE HARBOUR POINT DEPOT', target: { x: 2156, z: 2436 }, radius: 26 },
      { text: 'HOLD THE DEPOT · FOUR DOWN', target: { x: 2156, z: 2436 }, radius: 40, needDowned: 4 },
      { text: 'GET CLEAR · LOSE THE HEAT', target: { x: 2350, z: 1350 }, radius: 26, needZeroHeat: true },
    ],
  },
  {
    id: 'race_1',
    type: 'race',
    title: 'MIDNIGHT TOKYO CIRCUIT',
    subtitle: 'High-speed street race through downtown',
    payout: 15000,
    heat: 0,
    steps: [
      { text: 'CHECKPOINT 1: KINGSWAY OVERPASS', target: { x: 2350, z: 1350 }, radius: 28 },
      { text: 'CHECKPOINT 2: HARBOUR POINT DOCKS', target: { x: 2156, z: 2436 }, radius: 28 },
      { text: 'CHECKPOINT 3: VELLERY ROW BOULEVARD', target: { x: 1163, z: 1864 }, radius: 28 },
      { text: 'CHECKPOINT 4: OLD QUARTER COMMERCE', target: { x: 1387, z: 1092 }, radius: 28 },
      { text: 'FINAL SPRINT: KINGSWAY PLAZA FINISH', target: { x: 2196, z: 1300 }, radius: 26 }
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
    this.area = null;    // the compact city (world/playArea.js), set by useArea
    this.nodes = null;
  }

  /**
   * The compact city: 15 of the 22 step targets above stand outside its wall
   * (the Harbour Point depot alone is 393 m out). Each mission then runs on a
   * copy whose outside targets are moved to the nearest junction >= 60 m
   * inside, 150 m clear of the step before (world/playArea.js remapMission);
   * this table is never edited, so ?fullmap plays the originals. `nodes` is
   * the compact gameplay graph's.
   */
  useArea(area, nodes) { this.area = area; this.nodes = nodes; }

  startMission(missionId, car) {
    const def = STORY_MISSIONS.find((m) => m.id === missionId);
    if (!def) return false;
    this.active = this.area && this.nodes ? remapMission(def, this.area, this.nodes) : def;
    this.stepIdx = 0;
    this.#advanceStep(car);
    if (this.hud?.flash) {
      this.hud.flash(`${def.title} STARTED`);
    }
    return true;
  }

  #advanceStep(car) {
    this.downed = 0;
    /* A firefight step brings the fight to you: the crew 'calls it in', so the
       wanted level jumps and cruisers arrive to deploy where you stand. Without
       this a stand-off at zero stars was an empty yard. */
    const next = this.active?.steps?.[this.stepIdx];
    if (next?.needDowned && this.traffic) {
      this.traffic.wanted = Math.max(this.traffic.wanted, 2.6);
      this.hud?.flash?.('THEY ARE CALLING IT IN · HOLD THE GROUND');
    }
    if (!this.active) return;
    if (this.stepIdx >= this.active.steps.length) {
      // Completed!
      const reward = this.active.payout ?? this.active.pay ?? 0;   // one mission entry says `pay`, not `payout`
      if (typeof window !== 'undefined' && window._reputation) {
        if (this.active.type === 'heist') {
          window._reputation.adjust(-85, 'HEIST MASTERMIND');
        } else {
          window._reputation.adjust(70, 'VIGILANTE BOUNTY SECURED');
        }
      }
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
    // Route mission marker to target with isStory = true so mission does not auto-terminate
    if (this.mission && step.target) {
      this.mission.route([step.target], step.text, true);
      if (this.mission.setRadius) this.mission.setRadius(step.radius || 24);
    }
    // Auto-map navigation GPS route directly to challenge target
    if (this.navigation && step.target) {
      this.navigation.setWaypoint(step.target.x, step.target.z);
      this.navigation.lastTarget = null;
    }
  }

  /** main calls this when an officer goes down; only firefight steps care. */
  onOfficerDown(x, z) {
    if (!this.active) return;
    // only officers dropped in or around the zone count; a fight three blocks away is not holding the depot
    const step = this.active.steps?.[this.stepIdx];
    if (x !== undefined && step?.target && Math.hypot(x - step.target.x, z - step.target.z) > (step.radius || 24) + 60) return;
    this.downed = (this.downed || 0) + 1;
  }

  update(car, dt) {
    if (!this.active) return;
    const step = this.active.steps[this.stepIdx];
    if (!step) return;

    // Check distance to target and speed across all vehicle types
    const dist = Math.hypot(car.x - step.target.x, car.z - step.target.z);
    const speed = Math.hypot(car.vx || 0, car.vz || 0) || Math.abs(car.fwdSpeed ?? car.speed ?? 0);
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

    /* A firefight step: `needDowned` officers must go down (main reports them
       through onOfficerDown) before the zone will close. The marker turns red
       and the HUD counts you in while it is outstanding. */
    if (step.needDowned && (this.downed || 0) < step.needDowned) {
      if (this.mission?.setMarkerColor) this.mission.setMarkerColor(0xff3b30);
      this._downWarn = (this._downWarn || 0) + dt;
      if (this._downWarn > 3.0 && dist < 80) { this._downWarn = 0; this.hud?.flash(`🎯 ${this.downed || 0}/${step.needDowned} DOWN · HOLD THE ZONE`); }
      return;
    }

    if (inRange) {
      const isRace = this.active.type === 'race';
      // In races, checkpoints trigger at full cruising speed without requiring stopping!
      if (!isRace && speed > 7.0) {
        this._stopWarn = (this._stopWarn || 0) + dt;
        if (this._stopWarn > 1.0) {
          this._stopWarn = 0;
          this.hud?.flash('🛑 COME TO A STOP IN ZONE TO SECURE OBJECTIVE');
        }
        return;
      }
      // Step complete!
      this.stepIdx++;
      this.downed = 0;   // the next step's count starts clean
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
