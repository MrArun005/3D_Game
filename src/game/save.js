/**
 * Halstead Bay - Unified Player Save Slot
 * Manages persistent state in localStorage under 'hb.save_slot'
 */

const SAVE_KEY = 'hb.save_slot';

export class SaveManager {
  static defaultState() {
    return {
      version: 1,
      name: 'LEO VANCE',
      tier: 1,
      tierTitle: 'STREET ROOKIE',
      cash: 2500,
      completedMissions: [],
      ownedBodies: ['q-sports'],
      fittedBody: 'q-sports',
      tuneStage: 1,
      hasNos: false,
      bestLap: null,
      stats: {
        distanceKm: 0,
        copsEvaded: 0,
        heistsCompleted: 0,
        propsSmashed: 0
      }
    };
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this.defaultState();
      const data = JSON.parse(raw);
      return { ...this.defaultState(), ...data };
    } catch (e) {
      console.warn('SaveManager: load failed, using defaults', e.message);
      return this.defaultState();
    }
  }

  static save(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('SaveManager: save failed', e.message);
    }
  }

  static getTier(completedCount) {
    if (completedCount >= 6) return { tier: 3, title: 'DOWNTOWN KINGPIN' };
    if (completedCount >= 3) return { tier: 2, title: 'SYNDICATE DRIVER' };
    return { tier: 1, title: 'STREET ROOKIE' };
  }
}
