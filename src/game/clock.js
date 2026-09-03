import * as THREE from 'three';

/**
 * 24-minute real-world day-night clock with smooth dynamic celestial cycle,
 * dynamic solar vector, lighting states (Day, Sunset, Night, Dawn),
 * and weather transitions.
 */
export class GameClock {
  constructor({ startHour = 19.5, speed = 1.0 } = {}) {
    this.hour = startHour; // 0.0 - 24.0
    this.timeScale = speed; // 1 real min = 1 game hr (1 sec = 1 game min)
    this.weather = 'CLEAR'; // CLEAR, OVERCAST, RAIN, STORM
    this.weatherTimer = 0;

    this.sunPosition = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.fogColor = new THREE.Color();
  }

  update(dt, { sun, hemi, scene, grade, lightPool, heroLights, weatherSystem } = {}) {
    // 24 minutes real time = 24 game hours => dt / 60 hours per second
    this.hour = (this.hour + (dt / 60) * this.timeScale) % 24;

    // Solar angle: 6h = 0 (sunrise), 12h = PI/2 (noon), 18h = PI (sunset), 24h/0h = -PI/2 (midnight)
    const sunAngle = ((this.hour - 6) / 24) * Math.PI * 2;
    const sinH = Math.sin(sunAngle);
    const cosH = Math.cos(sunAngle);

    // Dynamic solar arc from east to west
    const sunDist = 420;
    this.sunPosition.set(-cosH * sunDist, Math.max(-50, sinH * sunDist), 120 * Math.cos(sunAngle * 0.5));

    // Determine diurnal phase weights
    const isNight = this.hour >= 20.5 || this.hour < 5.2;
    const isDusk = this.hour >= 18.0 && this.hour < 20.5;
    const isDawn = this.hour >= 5.2 && this.hour < 7.2;
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
      this.sunColor.setRGB(0.18, 0.28, 0.45);
      this.hemiSky.setRGB(0.08, 0.12, 0.20);
      this.hemiGround.setRGB(0.04, 0.06, 0.09);
      this.fogColor.setRGB(0.06, 0.08, 0.14);
      sunIntensity = 0.42; // Soft moon key
      hemiIntensity = 0.22;
    }

    // Apply to scene lights if provided
    if (sun) {
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
      // Task 2.4: Sky radiance & HDRI environment intensity follows the solar cycle
      scene.environmentIntensity = isDay ? 1.15 : (isDusk || isDawn) ? 0.85 : 0.45;
    }

    // Task 2.3: Staggered dusk switch-on for streetlamps, signs, windows (18.2 - 19.8)
    const duskProgress = Math.max(0, Math.min(1, (this.hour - 18.0) / 1.8));
    const dawnProgress = Math.max(0, Math.min(1, 1 - (this.hour - 5.4) / 1.6));
    const nightFactor = isNight ? 1 : isDusk ? duskProgress : isDawn ? dawnProgress : 0;

    if (assets) {
      // Stagger 1: Street lamps & sodium pools turn on at 35% dusk
      const lampOn = nightFactor > 0.35;
      if (assets.mat?.pool) assets.mat.pool.opacity = lampOn ? 0.88 * Math.min(1, (nightFactor - 0.35) / 0.3) : 0;
      if (assets.mat?.lampGlow) assets.mat.lampGlow.emissiveIntensity = lampOn ? 0.15 + 2.0 * nightFactor : 0.15;

      // Stagger 2: Commercial neon signs ignite at 20% dusk
      const signOn = nightFactor > 0.20;
      if (assets.mat?.sign) assets.mat.sign.emissiveIntensity = signOn ? 0.06 + 1.6 * nightFactor : 0.06;
      if (assets.mat?.beacon) assets.mat.beacon.emissiveIntensity = signOn ? 0.6 + 1.8 * nightFactor : 0.6;

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
    }

    // Night lighting state: headlights active at night & dusk
    const lightsActive = this.hour >= 18.2 || this.hour < 6.4;
    if (heroLights) heroLights.visible = lightsActive;

    // Tune post bloom per hour (Task 2.5): subtle during the day, radiant at dusk/night
    if (grade?.setNight) {
      grade.setNight(lightsActive);
    }

    // Dynamic weather cycle (Task 2.6)
    this.weatherTimer += dt;
    if (this.weatherTimer > 360) {
      this.weatherTimer = 0;
      const weathers = ['CLEAR', 'OVERCAST', 'RAIN', 'STORM'];
      this.weather = weathers[Math.floor(Math.random() * weathers.length)];
    }
  }

  get formattedTime() {
    const totalMinutes = Math.floor(this.hour * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
