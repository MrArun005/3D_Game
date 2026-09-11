import * as THREE from 'three';

// Diurnal color grade anchor profiles
const DIURNAL_PROFILES = {
  DAY: {
    sat: 1.05,
    vibrance: 0.05,
    contrast: 0.34,
    split: 0.50,
    shadowTint: [0.93, 0.98, 1.05],
    midTint: [1.0, 1.0, 1.0],
    highTint: [1.06, 1.01, 0.95],
    slope: [1.0, 1.0, 1.0],
    offset: [0.0, 0.0, 0.0],
    power: [1.0, 1.0, 1.0],
    bloomStrength: 0.55,
    bloomRadius: 0.35,
    bloomThreshold: 0.25,
    vignette: 0.35,
    grain: 0.015,
    filmic: 0.0,
  },
  DUSK: {
    sat: 1.20,
    vibrance: 0.18,
    contrast: 0.32,
    split: 0.85,
    shadowTint: [0.89, 0.91, 1.08],
    midTint: [1.03, 1.0, 0.98],
    highTint: [1.14, 1.01, 0.88],
    slope: [1.03, 1.01, 0.97],
    offset: [0.0, 0.0, 0.0],
    power: [1.01, 1.01, 1.03],
    bloomStrength: 0.85,
    bloomRadius: 0.50,
    bloomThreshold: 0.45,
    vignette: 0.50,
    grain: 0.024,
    filmic: 0.0,
  },
  NIGHT: {
    sat: 1.32,
    vibrance: 0.22,
    contrast: 0.24,
    split: 1.0,
    shadowTint: [0.92, 0.93, 1.06],
    midTint: [0.98, 0.98, 1.02],
    highTint: [1.08, 0.97, 1.05],
    slope: [1.01, 1.0, 1.04],
    offset: [-0.01, -0.01, -0.005],
    power: [1.03, 1.03, 1.02],
    bloomStrength: 0.95,
    bloomRadius: 0.55,
    bloomThreshold: 0.85,
    vignette: 0.62,
    grain: 0.030,
    filmic: 1.0,   // per-channel Hable tone map (grade.js): neon keeps its chroma
  },
  DAWN: {
    sat: 0.98,
    vibrance: 0.02,
    contrast: 0.28,
    split: 0.50,
    shadowTint: [0.95, 0.97, 1.04],
    midTint: [1.0, 1.0, 1.0],
    highTint: [1.08, 1.03, 0.98],
    slope: [1.0, 1.0, 1.0],
    offset: [0.01, 0.01, 0.01],
    power: [0.98, 0.98, 0.98],
    bloomStrength: 0.60,
    bloomRadius: 0.38,
    bloomThreshold: 0.30,
    vignette: 0.40,
    grain: 0.020,
    filmic: 0.0,
  },
};

export function interpolateGradeProfile(hour, weather) {
  let wNight = 0, wDawn = 0, wDay = 0, wDusk = 0;

  if (hour < 5.0 || hour >= 21.0) {
    wNight = 1.0;
  } else if (hour >= 5.0 && hour < 7.5) {
    const t = (hour - 5.0) / 2.5;
    wNight = 1.0 - t;
    wDawn = t;
  } else if (hour >= 7.5 && hour < 9.5) {
    const t = (hour - 7.5) / 2.0;
    wDawn = 1.0 - t;
    wDay = t;
  } else if (hour >= 9.5 && hour < 17.0) {
    wDay = 1.0;
  } else if (hour >= 17.0 && hour < 19.5) {
    const t = (hour - 17.0) / 2.5;
    wDay = 1.0 - t;
    wDusk = t;
  } else if (hour >= 19.5 && hour < 21.0) {
    const t = (hour - 19.5) / 1.5;
    wDusk = 1.0 - t;
    wNight = t;
  }

  const pDay = DIURNAL_PROFILES.DAY;
  const pDusk = DIURNAL_PROFILES.DUSK;
  const pNight = DIURNAL_PROFILES.NIGHT;
  const pDawn = DIURNAL_PROFILES.DAWN;

  const blendVal = (k) => pDay[k] * wDay + pDusk[k] * wDusk + pNight[k] * wNight + pDawn[k] * wDawn;
  const blendVec = (k) => [
    pDay[k][0] * wDay + pDusk[k][0] * wDusk + pNight[k][0] * wNight + pDawn[k][0] * wDawn,
    pDay[k][1] * wDay + pDusk[k][1] * wDusk + pNight[k][1] * wNight + pDawn[k][1] * wDawn,
    pDay[k][2] * wDay + pDusk[k][2] * wDusk + pNight[k][2] * wNight + pDawn[k][2] * wDawn,
  ];

  let sat = blendVal('sat');
  let vibrance = blendVal('vibrance');
  let contrast = blendVal('contrast');
  let split = blendVal('split');
  let vignette = blendVal('vignette');
  let grain = blendVal('grain');
  let bloomStrength = blendVal('bloomStrength');
  let bloomRadius = blendVal('bloomRadius');
  let bloomThreshold = blendVal('bloomThreshold');
  const filmic = blendVal('filmic');

  let shadowTint = blendVec('shadowTint');
  let midTint = blendVec('midTint');
  let highTint = blendVec('highTint');
  let slope = blendVec('slope');
  let offset = blendVec('offset');
  let power = blendVec('power');

  // Atmospheric weather adjustments
  if (weather === 'OVERCAST') {
    sat *= 0.86;
    contrast *= 0.90;
    vignette += 0.05;
    shadowTint = [shadowTint[0] * 0.96, shadowTint[1] * 0.98, shadowTint[2] * 1.02];
  } else if (weather === 'RAIN') {
    sat *= 0.92;
    contrast += 0.04;
    vignette += 0.08;
    grain += 0.005;
  } else if (weather === 'STORM') {
    sat *= 0.88;
    contrast += 0.06;
    vignette += 0.14;
    grain += 0.010;
  }

  return {
    sat, vibrance, contrast, split, vignette, grain,
    bloomStrength, bloomRadius, bloomThreshold, filmic,
    shadowTint, midTint, highTint,
    slope, offset, power,
  };
}

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

  update(dt, { sun, hemi, scene, grade, lightPool, heroLights, weatherSystem, assets, player, dome, stars } = {}) {
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
      if (assets.mat?.sign) assets.mat.sign.emissiveIntensity = signOn ? 0.06 + 2.4 * nightFactor : 0.06;   // neon that blooms (grade.setNight threshold 0.85 via bloomThresholdFor)
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

    // Night lighting state: headlights default active at night & dusk if not manually toggled
    const lightsActive = this.hour >= 18.2 || this.hour < 6.4;

    // Continuous Diurnal & Weather Color Grade Profile
    // the one writer of the grade's look uniforms; grade.setNight() delegates back here
    grade?.setGradeProfile?.(interpolateGradeProfile(this.hour, this.weather));

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
