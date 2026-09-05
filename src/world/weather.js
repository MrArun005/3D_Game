import * as THREE from 'three';
import { mrt, vec4 } from 'three/tsl';

/* The post stack's scene pass carries a normal MRT target, and blending
   applies to every target at once — additive rain smeared its sprite normals
   over everything behind it and GTAO read the wreckage as occlusion: dark
   speckles across the whole night frame, sky included. A zero normal is the
   additive identity, so the pixels underneath keep the normals they had. */
const NO_NORMAL = mrt({ normal: vec4(0) });

/** Vertical dash used as a rain streak. */
function streakMap() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 48;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(4, 0, 4, 48);
  gr.addColorStop(0, 'rgba(190,210,240,0)');
  gr.addColorStop(0.35, 'rgba(210,225,250,0.95)');
  gr.addColorStop(1, 'rgba(190,210,240,0)');
  g.fillStyle = gr;
  g.fillRect(3, 0, 2, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function sprayMap() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, 'rgba(210,220,230,0.55)');
  gr.addColorStop(1, 'rgba(210,220,230,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const RAIN_N = 5200;
const RAIN_BOX = 36;
const RAIN_H = 24;
const SPRAY_N = 220;

/**
 * Rain that rides with the camera, plus a tyre-spray puff behind the car.
 * Cheap: two point clouds, no lights.
 */
import { newState as newLightning, step as lightningStep } from './lightning.js';

/**
 * `hemi` is the night rig's hemisphere light: a strike multiplies it for a
 * few frames and the rain sheet brightens with it. `onStrike(delay)` is
 * called once per strike for the thunder. Both optional.
 */
/**
 * Does it rain at time t (seconds)? Spells, not a constant: one slow sine, so
 * a night has dry hours and wet hours (about 40% wet, spells of ~20 min on a
 * ~50 min cycle). Pure; tested. main gates it with the clock's night.
 */
export function rainSpell(t) {
  return Math.sin(t * 0.0021 + 1.0) > 0.2;
}

export function createWeather(scene, { hemi = null, onStrike = null, dome = null } = {}) {
  const domeOf = () => (typeof dome === 'function' ? dome() : dome);   // a getter, because the dome may be built after the weather
  const storm = newLightning();
  let hemiBase = null;
  /* The rain is not a constant. `amount` breathes 0.35..1.0 over about ten
     minutes (two slow sines so it does not read as a metronome); the sheet's
     density, fall speed and opacity follow it, and lightning only comes when
     it is above 0.7 -- a drizzle has no thunder in it. main reads .amount for
     the rain audio. */
  let wt = 0;
  const api = {
    amount: 1, enabled: true,
    /** Off: the sheet and spray are hidden and amount reads 0 (dry grip, dry audio, matte road). Fades are the caller's business. */
    setEnabled(on) { if (on === api.enabled) return; api.enabled = on; rain.visible = on; spray.visible = on; if (!on) api.amount = 0; },
  };
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * RAIN_BOX;
    rainPos[i * 3 + 1] = Math.random() * RAIN_H;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    map: streakMap(), size: 0.55, transparent: true, opacity: 0.55,
    depthWrite: false, fog: true, sizeAttenuation: true,
    blending: THREE.AdditiveBlending, color: 0xc5d6ee,
  }));
  rain.material.mrtNode = NO_NORMAL;
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  scene.add(rain);

  const sprayGeo = new THREE.BufferGeometry();
  const sprayPos = new Float32Array(SPRAY_N * 3);
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({
    map: sprayMap(), size: 0.85, transparent: true, opacity: 0.0,
    depthWrite: false, fog: true, sizeAttenuation: true,
    blending: THREE.AdditiveBlending, color: 0xb8c4d2,
  }));
  spray.material.mrtNode = NO_NORMAL;
  spray.frustumCulled = false;
  spray.renderOrder = 5;
  scene.add(spray);

  const wrap = (v, c, half) => {
    const span = half * 2;
    let d = v - c;
    if (d > half) v -= span;
    else if (d < -half) v += span;
    return v;
  };

  Object.assign(api, {
    rain, spray,
    update(camera, car, dt) {
      if (!api.enabled) { api.amount = 0; return; }
      wt += dt;
      const amount = 0.675 + 0.325 * (0.6 * Math.sin(wt * 0.0105) + 0.4 * Math.sin(wt * 0.0037 + 1.7));
      api.amount = amount;
      const cx = camera.position.x, cz = camera.position.z;
      const fall = (13 + car.speed * 0.22) * dt * (0.7 + 0.3 * amount);
      const pos = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN_N; i++) {
        const i3 = i * 3;
        pos[i3] -= car.vx * dt * 0.35;
        pos[i3 + 1] -= fall;
        pos[i3 + 2] -= car.vz * dt * 0.35;
        if (pos[i3 + 1] < -0.4) pos[i3 + 1] += RAIN_H;
        pos[i3] = wrap(pos[i3], cx, RAIN_BOX * 0.5);
        pos[i3 + 2] = wrap(pos[i3 + 2], cz, RAIN_BOX * 0.5);
      }
      rainGeo.attributes.position.needsUpdate = true;

      const wet = Math.min(1, car.speed / 18);
      // Additive sprites STACK where they overlap, and the spray is a tight
      // cluster behind the wheels — at 0.5 each, four overlapping puffs clip to
      // white. Keep any single particle faint and let the density do the work.
      spray.material.opacity = (0.035 + wet * 0.10 + car.slip * 0.08) * (0.4 + 0.6 * amount);   // less spray in a drizzle
      spray.material.size = 0.6 + wet * 0.45;
      const fy = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
      const rx = Math.sin(car.yaw), rz = Math.cos(car.yaw);
      const sPos = sprayGeo.attributes.position.array;
      for (let i = 0; i < SPRAY_N; i++) {
        const i3 = i * 3;
        const back = -1.6 - Math.random() * 3.4;
        const side = (Math.random() - 0.5) * 1.5;
        sPos[i3] = car.x + fy * back + rx * side;
        sPos[i3 + 1] = 0.05 + Math.random() * (0.35 + wet * 0.7);
        sPos[i3 + 2] = car.z + fz * back + rz * side;
      }
      sprayGeo.attributes.position.needsUpdate = true;

      // lightning (world/lightning.js): the sky goes white in stutters, the rain shows for a moment, thunder follows
      const flash = amount > 0.7 ? lightningStep(storm, dt) : 0;   // no thunder in a drizzle
      if (flash > 0 && storm.strike && onStrike) onStrike(storm.strike.delay);
      if (hemi) {
        if (flash > 0) { if (hemiBase === null) hemiBase = hemi.intensity; hemi.intensity = hemiBase * (1 + 7 * flash) + 1.2 * flash; }
        else if (hemiBase !== null) { hemi.intensity = hemiBase; hemiBase = null; }
      }
      rain.material.opacity = (0.25 + 0.30 * amount) + 0.4 * flash;
      // the sky under rain: the dome (tinted per frame by the clock, so multiplying never accumulates) darkens with the rain and whites out with the flash
      const d = domeOf();
      if (d?.material?.color) d.material.color.multiplyScalar(1 - 0.45 * amount).addScalar(0.7 * flash);
      if (scene.fog?.color) scene.fog.color.multiplyScalar(1 - 0.45 * amount).addScalar(0.5 * flash);   // the haze darkens with the sky, so fogged silhouettes do not float pale in front of it
    },
  });
  return api;
}
