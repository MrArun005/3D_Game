import * as THREE from 'three';
import { HelicopterVehicle } from './flight.js';
import { TankVehicle } from './tank.js';

/**
 * Pegasus & Warstock Vehicle Dispatch Service.
 * 
 * - HELI LIFT ($2,500): Dispatches an executive helicopter to the nearest rooftop
 *   helipad or open street tarmac.
 * - RHINO DROP ($12,000): Heavy cargo drop delivering a 55t Rhino tank.
 */
export class DispatchService {
  constructor(scene, world, garage, traffic, debris, hud, audio, navigation = null) {
    this.scene = scene;
    this.world = world;
    this.garage = garage;
    this.traffic = traffic;
    this.debris = debris;
    this.hud = hud;
    this.audio = audio;
    this.navigation = navigation;

    this.dispatchedVehicles = [];
    this.blips = []; // for minimap / radar
  }

  /**
   * Dispatches a helicopter to the nearest rooftop helipad or clear street.
   */
  dispatchHelicopter(playerPos) {
    const cost = 2500;
    if (this.garage.cash < cost) {
      this.hud?.flash?.('INSUFFICIENT FUNDS — $2,500 REQUIRED FOR HELI LIFT');
      return null;
    }
    if (this.garage.spendCash) {
      this.garage.spendCash(cost);
    } else {
      this.garage.cash -= cost;
    }

    const pad = this.#findHeliPad(playerPos.x, playerPos.z, playerPos.y || 0, playerPos.yaw || 0);
    const heli = new HelicopterVehicle(this.scene, this.world, {
      x: pad.x,
      y: pad.y + 1.25,
      z: pad.z,
      yaw: pad.yaw || 0,
      running: true,
    });

    this.dispatchedVehicles.push(heli);
    const locationText = pad.isRoof ? 'ROOFTOP HELIPAD' : 'STREET CLEARING';
    this.hud?.flash?.(`🚁 PEGASUS: HELICOPTER DELIVERED TO ${locationText} · PRESS F TO ENTER`);
    this.audio?.horn?.(0, 0);

    // Auto-map GPS route directly to the delivered helicopter
    if (this.navigation) {
      this.navigation.setWaypoint(pad.x, pad.z);
      this.navigation.lastTarget = null;
    }

    return heli;
  }

  /**
   * Dispatches a 55-tonne Rhino Tank via heavy cargo drop.
   */
  dispatchTank(playerPos, wantedLevel = 0) {
    const cost = 12000;
    const canAfford = this.garage.cash >= cost;
    const hasWanted = wantedLevel >= 3;

    if (!canAfford && !hasWanted) {
      this.hud?.flash?.('WARSTOCK LOCKED — REQUIRES $12,000 OR 3-STAR WANTED LEVEL');
      return null;
    }

    if (canAfford) {
      if (this.garage.spendCash) {
        this.garage.spendCash(cost);
      } else {
        this.garage.cash -= cost;
      }
    }

    // Find clear street tarmac ahead of player
    const dropSite = this.#findStreetDrop(playerPos.x, playerPos.z, playerPos.yaw || 0);
    const tank = new TankVehicle(this.scene, this.world, this.traffic, this.debris, {
      x: dropSite.x,
      y: dropSite.y,
      z: dropSite.z,
      yaw: dropSite.yaw,
    });

    this.dispatchedVehicles.push(tank);
    this.hud?.flash?.('🛡️ WARSTOCK: 55T RHINO TANK DROPPED IN YOUR SECTOR · PRESS F TO ENTER');
    this.audio?.horn?.(0, 0);

    // Auto-map GPS route directly to the delivered tank
    if (this.navigation) {
      this.navigation.setWaypoint(dropSite.x, dropSite.z);
      this.navigation.lastTarget = null;
    }

    return tank;
  }

  #findHeliPad(px, pz, py = 0, yaw = 0) {
    // 1. If player is high on a skyscraper / rooftop (> 15m), find rooftop helipad
    if (py > 15) {
      const buildings = this.world?.nearbyBuildings ? this.world.nearbyBuildings(px, pz) : [];
      let bestRoof = null;
      let bestDist = Infinity;

      for (const b of buildings) {
        if ((b.hw * 2) >= 16 && (b.hd * 2) >= 16 && b.height >= 18) {
          const dist = Math.hypot(b.x - px, b.z - pz);
          if (dist < bestDist && dist > 15) {
            bestDist = dist;
            bestRoof = {
              x: b.x,
              y: b.height,
              z: b.z,
              yaw: b.angle || 0,
              isRoof: true,
            };
          }
        }
      }

      if (bestRoof && bestDist < 180) {
        return bestRoof;
      }
    }

    // 2. Default: Clear street drop ahead of player for direct street-level boarding
    return this.#findStreetDrop(px, pz, yaw);
  }

  #findStreetDrop(px, pz, yaw) {
    const d = this.world?.district;
    // Walk forward along road
    for (let r = 24; r <= 80; r += 14) {
      for (const angleOffset of [0, 0.4, -0.4, 0.8, -0.8]) {
        const a = yaw + angleOffset;
        const tx = px + Math.cos(a) * r;
        const tz = pz - Math.sin(a) * r;

        if (d && d.tarmacDepth && d.tarmacDepth(tx, tz) > 1.8) {
          const gy = d.elevationAt ? d.elevationAt(tx, tz) : 0;
          return { x: tx, y: gy, z: tz, yaw: a, isRoof: false };
        }
      }
    }

    // Default 30m ahead
    const gy = d?.elevationAt ? d.elevationAt(px + 30, pz) : 0;
    return { x: px + 30, y: gy, z: pz, yaw: 0, isRoof: false };
  }

  update(dt, activeVehicle, chase) {
    for (const v of this.dispatchedVehicles) {
      // If vehicle is not currently active, keep it updated (idle physics)
      if (v !== activeVehicle) {
        v.update(null, dt, { chase });
      }
    }
  }
}
