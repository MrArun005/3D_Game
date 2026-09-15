/**
 * In-game slash command and sandbox cheat engine.
 *
 * All state mutations are handled via explicit system context setters passed
 * from main.js, honoring the 'Money comes from work only' design rule by gating
 * economy cheats behind ?debug.
 */

const LANDMARKS = {
  downtown: { x: 2350, z: 1350, yaw: 0, name: 'Downtown Kingsway' },
  harbour:  { x: 1850, z: 2150, yaw: Math.PI / 2, name: 'Harbour Point' },
  bridge:   { x: 2600, z: 800, yaw: -Math.PI / 4, name: 'Halstead Suspension Bridge' },
  airport:  { x: 1200, z: 1100, yaw: 0, name: 'Airport District' },
  north:    { x: 2350, z: 450, yaw: Math.PI, name: 'North Bay Overlook' },
  marrow:   { x: 499, z: 1391, yaw: 0, name: 'Marrow Hill' },              // the suburb: gable roofs (photo preset marrow-hill)
  steelgate: { x: 3662, z: 1221, yaw: 0, name: 'Steelgate Chop Shop' },
  tokyo:    { x: 2160, z: 1540, yaw: Math.PI / 2, name: 'Little Tokyo Neon Boulevard' },
  track:    { x: 3560, z: 2457, yaw: 0, name: 'Halstead International Raceway' }
};

export class CommandEngine {
  constructor(ctx) {
    this.ctx = ctx; // { car, traffic, garage, clock, damageModel, grade, chat, hud, teleport }
  }

  /**
   * Execute a command line.
   * Returns true if handled as a command, false if plain chat.
   */
  execute(line) {
    if (!line.startsWith('/')) return false;

    const parts = line.slice(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const { chat } = this.ctx;

    switch (cmd) {
      case 'help':
      case 'commands': {
        chat.post('SYSTEM', 'Available Commands:');
        chat.post('SYSTEM', '· /track — HALSTEAD RACEWAY dedicated circuit (also Shift+T)');
        chat.post('SYSTEM', '· /mile — THE HALSTEAD MILE scenic route (also Shift+R)');
        chat.post('SYSTEM', '· /wanted <0-5> or /clearheat — Police pursuit level');
        chat.post('SYSTEM', '· /nos — Equip & refill Nitrous Oxide');
        chat.post('SYSTEM', '· /repair — Fix all bodywork & damage');
        chat.post('SYSTEM', '· /tp <downtown|harbour|bridge|airport|track> — Teleport');
        chat.post('SYSTEM', '· /time <0-23|day|night|dusk> — Set city clock');
        chat.post('SYSTEM', '· /weather <clear|rain> — Set road precipitation');
        chat.post('SYSTEM', '· /car <zr1|patrol|c6r> — Spawn vehicle');
        chat.post('SYSTEM', '· /grade <preset|list|cycle> — Cinematic color grade');
        chat.post('SYSTEM', '· /quality <lite|full|status> — Switch quality profile');
        chat.post('SYSTEM', '· /perf — Live frame time & GPU performance stats');
        chat.post('SYSTEM', '· /cash <amount> — (Gated behind ?debug)');
        break;
      }

      case 'wanted': {
        const lvl = parseInt(args[0], 10);
        if (isNaN(lvl) || lvl < 0 || lvl > 5) {
          chat.post('SYSTEM', 'Usage: /wanted <0-5>');
        } else {
          this.ctx.setWanted(lvl);
          chat.post('SYSTEM', `Wanted level set to ${lvl} star${lvl === 1 ? '' : 's'}.`);
        }
        break;
      }

      case 'clearheat':
      case 'clear': {
        this.ctx.setWanted(0);
        chat.post('SYSTEM', 'Wanted heat cleared. All patrol units standing down.');
        break;
      }

      case 'nos':
      case 'boost': {
        if (this.ctx.garage) {
          // installNos() would charge $3,000 and refuse when broke; mirror
          // its state writes instead so the cheat also survives a reload.
          this.ctx.garage.hasNos = true;
          this.ctx.garage.nosGauge = 1.0;
          try { localStorage.setItem('hb.has_nos', 'true'); } catch { /* private mode */ }
          chat.post('SYSTEM', '🚀 Nitrous Oxide (NOS) installed. Hold SHIFT to boost.');
        }
        break;
      }

      case 'repair':
      case 'fix': {
        if (this.ctx.damageModel) {
          this.ctx.damageModel.repair();
        }
        this.ctx.car.impact = 0;
        this.ctx.setHealth(1.0);
        chat.post('SYSTEM', '🔧 Vehicle fully repaired. Chassis & bodywork restored.');
        break;
      }

      case 'track':
      case 'circuit':
      case 'raceway': {
        // Halstead International Raceway -- also Shift+T.
        this.ctx.startTrackRace?.();
        chat.post('SYSTEM', '🏎️ HALSTEAD INTERNATIONAL RACEWAY: 2.34 km circuit. Staging 3-lap race…');
        break;
      }

      case 'mile':
      case 'route':
      case 'scenic': {
        // THE HALSTEAD MILE -- also Shift+R. See game/scenicRoute.js.
        this.ctx.mile?.();
        chat.post('SYSTEM', 'THE HALSTEAD MILE: 5.7 km, 8 marks. Old Quarter, the river, the lift bridge at golden hour, the bay.');
        break;
      }

      case 'tp':
      case 'teleport': {
        const targetKey = (args[0] || '').toLowerCase();
        const spot = LANDMARKS[targetKey];
        if (spot) {
          this.ctx.teleport(spot.x, spot.z, spot.yaw);
          chat.post('SYSTEM', `Teleported to ${spot.name}.`);
        } else {
          chat.post('SYSTEM', `Unknown landmark. Options: ${Object.keys(LANDMARKS).join(', ')}`);
        }
        break;
      }

      case 'time': {
        const val = (args[0] || '').toLowerCase();
        let hour = 0;
        if (val === 'day' || val === 'noon') hour = 12;
        else if (val === 'night' || val === 'midnight') hour = 0;
        else if (val === 'dusk' || val === 'sunset') hour = 19;
        else if (val === 'dawn' || val === 'sunrise') hour = 6;
        else hour = parseFloat(val);

        if (!isNaN(hour) && hour >= 0 && hour <= 24) {
          this.ctx.setTime(hour);
          chat.post('SYSTEM', `City clock set to ${hour.toFixed(1)}:00.`);
        } else {
          chat.post('SYSTEM', 'Usage: /time <0-24 | day | night | dusk | dawn>');
        }
        break;
      }

      case 'weather': {
        const w = (args[0] || '').toLowerCase();
        if (w === 'rain' || w === 'storm') {
          if (this.ctx.grade) this.ctx.grade.setDrops(0.85);
          chat.post('SYSTEM', 'Weather updated: Heavy precipitation active.');
        } else if (w === 'clear' || w === 'dry') {
          if (this.ctx.grade) this.ctx.grade.setDrops(0.0);
          chat.post('SYSTEM', 'Weather updated: Clear skies.');
        } else {
          chat.post('SYSTEM', 'Usage: /weather <clear|rain>');
        }
        break;
      }

      case 'cash': {
        const isDebug = typeof location !== 'undefined' && location.search.includes('debug');
        if (!isDebug) {
          chat.post('SYSTEM', '🔒 /cash is locked. Money comes from work only. Add ?debug to URL to enable.');
          break;
        }
        const amt = parseInt(args[0], 10);
        if (isNaN(amt) || amt <= 0) {
          chat.post('SYSTEM', 'Usage: /cash <amount>');
        } else {
          if (this.ctx.garage) {
            // cash is a getter over jobs.cash -- assigning it throws. addCash
            // is the real setter and persists + flashes for us.
            this.ctx.garage.addCash(amt, 'DEBUG');
            chat.post('SYSTEM', `Debug: Added ${amt.toLocaleString()} to account.`);
          }
        }
        break;
      }

      case 'car':
      case 'spawn': {
        const model = (args[0] || '').toLowerCase();
        const aliasMap = {
          'zr1': 's-corvette-zr1',
          'corvette': 's-corvette-zr1',
          'patrol': 's-camaro-patrol',
          'camaro': 's-camaro-patrol',
          'c6r': 's-corvette-c6r',
          'race': 's-corvette-c6r'
        };
        const carId = aliasMap[model] || model;
        if (this.ctx.switchCar && this.ctx.switchCar(carId)) {
          chat.post('SYSTEM', `Spawned vehicle: ${model.toUpperCase()}`);
        } else {
          chat.post('SYSTEM', `Available cars: zr1, patrol, c6r`);
        }
        break;
      }

      case 'grade':
      case 'lut': {
        const { grade } = this.ctx;
        if (!grade) {
          chat.post('SYSTEM', 'Color grade system is unavailable.');
          break;
        }
        const sub = (args[0] || '').toUpperCase();
        if (!sub || sub === 'LIST') {
          const list = Object.keys(grade.presets || {}).join(', ');
          chat.post('SYSTEM', `Current grade: ${grade.currentPreset}. Available: ${list}`);
          chat.post('SYSTEM', 'Usage: /grade <preset_name> or /grade cycle');
        } else if (sub === 'CYCLE' || sub === 'NEXT') {
          const next = grade.cyclePreset(1);
          chat.post('SYSTEM', `Color grade swapped to: ${grade.presetDetails?.name || next}`);
        } else if (grade.presets && grade.presets[sub]) {
          grade.setPreset(sub);
          chat.post('SYSTEM', `Color grade set to: ${grade.presetDetails?.name || sub}`);
        } else if (sub === 'DEFAULT' || sub === 'RESET') {
          grade.setPreset('DEFAULT');
          chat.post('SYSTEM', 'Color grade restored to Dynamic Timecycle.');
        } else {
          chat.post('SYSTEM', `Unknown grade preset '${args[0]}'. Use '/grade list'.`);
        }
        break;
      }

      case 'quality': {
        const mode = (args[0] || '').toLowerCase();
        if (mode === 'lite' || mode === 'full') {
          chat.post('SYSTEM', `Setting quality to ${mode.toUpperCase()}... (reloading engine)`);
          this.ctx.setQuality?.(mode);
        } else if (mode === 'auto' || mode === 'default' || mode === 'reset') {
          chat.post('SYSTEM', 'Resetting quality to auto hardware detection... (reloading engine)');
          this.ctx.setQuality?.('auto');
        } else {
          const current = this.ctx.isLite ? 'LITE' : 'FULL';
          const gpu = this.ctx.gpuInfo?.gpuDesc || 'unknown';
          chat.post('SYSTEM', `Current quality: ${current} (GPU: ${gpu})`);
          chat.post('SYSTEM', 'Usage: /quality lite | /quality full | /quality auto');
        }
        break;
      }

      case 'perf':
      case 'fps': {
        const stats = this.ctx.stats;
        const renderer = this.ctx.renderer;
        if (!stats) {
          chat.post('SYSTEM', 'Performance monitor unavailable.');
          break;
        }
        const sorted = [...stats.samples].sort((a, b) => a.ms - b.ms);
        const n = sorted.length;
        const median = n ? (sorted[n >> 1]?.ms || 0).toFixed(1) : '-';
        const p95 = n ? (sorted[Math.min(n - 1, Math.floor(n * 0.95))]?.ms || 0).toFixed(1) : '-';
        const worst = n ? (sorted[n - 1]?.ms || 0).toFixed(1) : '-';
        const draws = (stats.snapshot.draws || 0) + (stats.snapshot.bundledDraws || 0);
        const mTris = (((stats.snapshot.tris || 0) + (stats.snapshot.bundledTris || 0)) / 1e6).toFixed(2);
        const liveChunks = this.ctx.world?.chunks?.size ?? '-';
        const pxRatio = renderer?.getPixelRatio ? renderer.getPixelRatio().toFixed(2) : '-';
        const quality = this.ctx.isLite ? 'LITE' : 'FULL';

        chat.post('SYSTEM', `[PERF] Mode: ${quality} | Frame Med: ${median}ms | 95th: ${p95}ms | Worst: ${worst}ms`);
        chat.post('SYSTEM', `[PERF] Draws: ${draws} | Tris: ${mTris}M | Chunks: ${liveChunks} | DPR: ${pxRatio}`);
        break;
      }

      default:
        chat.post('SYSTEM', `Unknown command: /${cmd}. Type /help for list.`);
        break;
    }

    return true;
  }
}
