import * as THREE from 'three';


/** Phase edges, in hours. Night 20.5-5.2, dusk 18-20.5, dawn 5.2-7.2, day otherwise. */
export const NIGHT_FROM = 20.5, NIGHT_TO = 5.2, DUSK_FROM = 18.0, DAWN_TO = 7.2;

/**
 * How far into the night the hour is, 0 (day) .. 1 (deep night). Pure, so it
 * is testable and so every consumer -- the lamp stagger, LightPool, traffic
 * headlamps, Tokyo neon, glare, exposure, the grade -- reads the SAME curve.
 * Dusk climbs 18.0 -> 19.8 and holds 1 through the night; dawn falls 5.4 -> 7.0.
 */
export function nightFactor(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= NIGHT_FROM || h < NIGHT_TO) return 1;
  if (h >= DUSK_FROM) return Math.max(0, Math.min(1, (h - DUSK_FROM) / 1.8));
  if (h < DAWN_TO) return Math.max(0, Math.min(1, 1 - (h - 5.4) / 1.6));
  return 0;
}
// update() names its local `nightFactor` after the curve; this alias keeps the call unshadowed
const nightFactorFn = nightFactor;

/**
 * 24-minute real-world day-night clock with smooth dynamic celestial cycle,
 * dynamic solar vector and lighting states (Day, Sunset, Night, Dawn).
 * ONE rig: the day sun + CSM, the hemisphere, the day dome and the day asset
 * palette (main.js daylightAssets) are what exist, and this drives every
 * night-only quantity from `nightFactor` -- `?night` is just a start hour.
 * Weather is world/weather.js's business (rainSpell); the clock does not roll it.
 */
export class GameClock {
  constructor({ startHour = 19.5, speed = 1.0 } = {}) {
    this.hour = startHour; // 0.0 - 24.0
    this.timeScale = speed; // 1 real min = 1 game hr (1 sec = 1 game min)
    this.nightFactor = nightFactor(startHour);

    this.sunPosition = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.fogColor = new THREE.Color();
  }

  update(dt, { sun, hemi, scene, grade, renderer, lightPool, traffic, assets, player, dome, stars } = {}) {
    // 24 minutes real time = 24 game hours => dt / 60 hours per second
    this.hour = (this.hour + (dt / 60) * this.timeScale) % 24;

    // Solar angle: 6h = 0 (sunrise), 12h = PI/2 (noon), 18h = PI (sunset), 24h/0h = -PI/2 (midnight)
    const sunAngle = ((this.hour - 6) / 24) * Math.PI * 2;
    const sinH = Math.sin(sunAngle);
    const cosH = Math.cos(sunAngle);

    // Dynamic solar arc from east to west, centered around player location (Defect 4 fix)
    const px = player?.x ?? 2350;
    const pz = player?.z ?? 1350;
    const sunDist = 420;
    this.sunPosition.set(px - cosH * sunDist, Math.max(30, sinH * sunDist), pz + 120 * Math.cos(sunAngle * 0.5));

    // Determine diurnal phase weights
    const isNight = this.hour >= NIGHT_FROM || this.hour < NIGHT_TO;
    const isDusk = this.hour >= DUSK_FROM && this.hour < NIGHT_FROM;
    const isDawn = this.hour >= NIGHT_TO && this.hour < DAWN_TO;
    const isDay = !isNight && !isDusk && !isDawn;

    let sunIntensity = 0;
    let hemiIntensity = 0.5;

    if (isDay) {
      const dayFactor = Math.min(1, Math.max(0, sinH));
      this.sunColor.setRGB(1.0, 0.95, 0.86);
      this.hemiSky.setRGB(0.66, 0.77, 0.88);
      this.hemiGround.setRGB(0.56, 0.53, 0.45);
      this.fogColor.setRGB(0.72, 0.79, 0.87);
      sunIntensity = 2.8 + dayFactor * 0.8;
      hemiIntensity = 0.55;
    } else if (isDusk) {
      const t = (this.hour - 18.0) / 2.5; // 0 to 1
      this.sunColor.setRGB(1.0, 0.52 - t * 0.2, 0.25);
      this.hemiSky.setRGB(0.48 - t * 0.3, 0.38 - t * 0.25, 0.55 - t * 0.3);
      this.hemiGround.setRGB(0.42 - t * 0.3, 0.30 - t * 0.2, 0.24 - t * 0.15);
      this.fogColor.setRGB(0.78 - t * 0.55, 0.52 - t * 0.38, 0.42 - t * 0.28);
      sunIntensity = Math.max(0.2, 3.0 * (1 - t * 0.85));
      hemiIntensity = 0.45 - t * 0.22;
    } else if (isDawn) {
      const t = (this.hour - 5.2) / 2.0; // 0 to 1
      this.sunColor.setRGB(1.0, 0.75 + t * 0.2, 0.55 + t * 0.3);
      this.hemiSky.setRGB(0.35 + t * 0.3, 0.48 + t * 0.3, 0.68 + t * 0.2);
      this.hemiGround.setRGB(0.25 + t * 0.3, 0.28 + t * 0.25, 0.26 + t * 0.2);
      this.fogColor.setRGB(0.55 + t * 0.2, 0.65 + t * 0.15, 0.78 + t * 0.1);
      sunIntensity = 1.0 + t * 1.8;
      hemiIntensity = 0.32 + t * 0.23;
    } else {
      // Deep Night (Moonlight)
      this.sunColor.setRGB(0.16, 0.24, 0.42);
      this.hemiSky.setRGB(0.06, 0.09, 0.16);
      this.hemiGround.setRGB(0.03, 0.045, 0.07);
      this.fogColor.setRGB(0.022, 0.028, 0.06);   // darker than the dome, or fogged silhouettes (the far hills) stand out pale against the sky
      sunIntensity = 0.30; // Soft moon key -- the pale far mountains were lit like dusk at 0.42
      hemiIntensity = 0.17;
    }

    // Apply to scene lights if provided
    if (sun) {
      if (sun.target) {
        sun.target.position.set(px, 0, pz);
        sun.target.updateMatrixWorld();
      }
      sun.position.copy(this.sunPosition);
      sun.color.copy(this.sunColor);
      sun.intensity = sunIntensity;
    }
    if (hemi) {
      hemi.color.copy(this.hemiSky);
      hemi.groundColor.copy(this.hemiGround);
      hemi.intensity = hemiIntensity;
    }
    if (scene) {
      if (scene.fog) {
        scene.fog.color.copy(this.fogColor);
        scene.fog.density = isNight ? 0.0028 : isDusk ? 0.00028 : 0.00018;
      }
      // Phase 2 ownership: Sky radiance & HDRI environment intensity follows solar cycle
      scene.environmentIntensity = isDay ? 1.15 : (isDusk || isDawn) ? 0.80 : 0.24;   // night: the cover art is ink, not slate
    }

    // Phase 2 ownership: synchronize sky dome rotation & tint and stars visibility
    if (dome) {
      dome.rotation.y = sunAngle;
      if (dome.material) {
        if (isDay) dome.material.color.setRGB(1.0, 1.0, 1.0);
        else if (isDusk) {
          const t = (this.hour - 18.0) / 2.5;
          dome.material.color.setRGB(1.0, Math.max(0.2, 0.95 - t * 0.65), Math.max(0.15, 0.90 - t * 0.70));
        } else if (isDawn) {
          const t = (this.hour - 5.2) / 2.0;
          dome.material.color.setRGB(0.55 + t * 0.45, 0.45 + t * 0.55, 0.60 + t * 0.40);
        } else {
          dome.material.color.setRGB(0.03, 0.035, 0.075);   // ink; the day dome tinted to 0.12 read as mid-blue, 0.045 still as evening
        }
      }
    }
    if (stars && stars.material) {
      stars.material.opacity = isNight ? 0.75 : isDusk ? ((this.hour - 18.0) / 2.5) * 0.4 : 0.0;
      stars.visible = stars.material.opacity > 0.02;
    }

    // Task 2.3: Staggered dusk switch-on for streetlamps, signs, windows (18.0 - 19.8)
    const nightFactor = this.nightFactor = nightFactorFn(this.hour);

    if (assets) {
      // Stagger 1: Street lamps & sodium pools turn on at 35% dusk
      const lampOn = nightFactor > 0.35;
      if (assets.mat?.pool) assets.mat.pool.opacity = lampOn ? 0.88 * Math.min(1, (nightFactor - 0.35) / 0.3) : 0;
      if (assets.mat?.lampGlow) assets.mat.lampGlow.emissiveIntensity = lampOn ? 0.15 + 2.0 * nightFactor : 0.15;

      // Stagger 2: Commercial neon signs ignite at 20% dusk
      const signOn = nightFactor > 0.20;
      if (assets.mat?.sign) assets.mat.sign.emissiveIntensity = signOn ? 0.06 + 2.4 * nightFactor : 0.06;   // neon that blooms (grade.setNight threshold 0.72)
      if (assets.mat?.beacon) assets.mat.beacon.emissiveIntensity = signOn ? 0.6 + 1.8 * nightFactor : 0.6;

      /* Window quads (signs.js buildWindowMaterial, emissiveIntensity through a
         materialReference so this write reaches the shader) and the podium
         bases (facades.js buildBaseMaterials, classic material: a uniform, no
         bake). daylightAssets() zeroes both at boot; nothing restored them
         until now, so a day boot that ran into the night had dark windows. */
      if (assets.mat?.windowQuad) assets.mat.windowQuad.emissiveIntensity = nightFactor > 0.45 ? 0.9 * Math.min(1, (nightFactor - 0.45) / 0.3) : 0;
      if (assets.base?.materials) for (const m of assets.base.materials) m.emissiveIntensity = 0.05 + 0.85 * (nightFactor > 0.5 ? Math.min(1, (nightFactor - 0.5) / 0.3) : 0);

      // Stagger 3: Tower & residential window illumination staggers between 40% and 85% dusk
      if (assets.facades) {
        let idx = 0;
        for (const k of Object.keys(assets.facades)) {
          const threshold = 0.35 + ((idx * 0.13) % 0.50); // staggered per facade group
          const on = nightFactor > threshold;
          const factor = on ? Math.min(1, (nightFactor - threshold) / 0.25) : 0;
          for (const m of assets.facades[k]) {
            m.emissiveIntensity = 0.04 + 0.96 * factor;
          }
          idx++;
        }
      }

      // Stagger 4: 3D Kit building window illumination illuminates as twilight falls
      if (assets.kitBuildings) {
        for (const k of Object.keys(assets.kitBuildings)) {
          const mat = assets.kitBuildings[k]?.mat;
          if (mat && mat.emissiveMap) {
            mat.emissiveIntensity = 0.05 + 1.25 * nightFactor;
          }
        }
      }
    }

    // Tune post bloom per hour (Task 2.5): subtle during the day, radiant at dusk/night (grade.setNight lerps on a 0..1)
    if (grade?.setNight) grade.setNight(nightFactor);
    /* Night ran too dark away from lit facades -- silhouettes on a horizon
       glow. 1.15 at night lifts the mid-tones without touching the emissive
       windows (already past the bloom knee); noon stays at 1.0. */
    if (renderer) renderer.toneMappingExposure = 1.0 + 0.15 * nightFactor;
    // the real lamp lights and the fleet's headlamps come up with the same curve
    if (lightPool) lightPool.night = nightFactor;
    if (traffic?.setNight) traffic.setNight(nightFactor);
  }

  get formattedTime() {
    const totalMinutes = Math.floor(this.hour * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
