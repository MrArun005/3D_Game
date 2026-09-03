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
  north:    { x: 2350, z: 450, yaw: Math.PI, name: 'North Bay Overlook' }
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
        chat.post('SYSTEM', '· /wanted <0-5> or /clearheat — Police pursuit level');
        chat.post('SYSTEM', '· /nos — Equip & refill Nitrous Oxide');
        chat.post('SYSTEM', '· /repair — Fix all bodywork & damage');
        chat.post('SYSTEM', '· /tp <downtown|harbour|bridge|airport> — Teleport');
        chat.post('SYSTEM', '· /time <0-23|day|night|dusk> — Set city clock');
        chat.post('SYSTEM', '· /weather <clear|rain> — Set road precipitation');
        chat.post('SYSTEM', '· /car <zr1|patrol|c6r> — Spawn vehicle');
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

      default:
        chat.post('SYSTEM', `Unknown command: /${cmd}. Type /help for list.`);
        break;
    }

    return true;
  }
}
