/**
 * Quality presets: Low / Medium / High, plus Auto (pick by GPU tier).
 *
 * Owner's policy (2026-09-22): protect frame time before fidelity. Every knob
 * here is sized from the census on the M2 Air (integrated, auto-LITE):
 *   - shadows are 48% of all triangles (3.27M -> 1.71M with ?noshadow) and
 *     ~300 draws, so the shadow TIER is the biggest single lever;
 *   - the render submit is 74-95% of frame CPU, so DENSITY (traffic, far
 *     traffic) is the cheapest runtime lever -- no reallocation, no pipeline;
 *   - fill: 0.78 MP 16.6 ms vs 8.29 MP 40.6 ms at the same draws, so the
 *     pixel budget is the second runtime lever.
 *
 * BOOT-TIME knobs (WebGPU trap, CLAUDE.md: toggling castShadow / shadowMap /
 * post passes at runtime invalidates pipelines -> black frames or a ~2 s
 * stall): shadows, bloom, aa, blur, streamRadius, and the CONSTRUCTED counts.
 * RUNTIME-SAFE knobs: pixel ratio, traffic live count, farTraffic count.
 */

export const QUALITY_NAMES = ['auto', 'mobile', 'low', 'balanced', 'medium', 'high'];   // the title-card cycle order
export const STORAGE_KEY = 'hb.quality';                          // shared with core/gpu.js ('lite' | 'full' live there too)

export const PRESETS = {
  /* Mobile (2026-09-24, Arun: "make a mobile version too, iPhone 15"): Auto's
     pick on a touch device. A phone GPU is a quarter of a laptop's and the
     panel is DPR 3 (2556x1179 on an iPhone 15): 0.35 MP drawn and upscaled,
     no shadows, the night glow kept at a quarter resolution, one real light,
     a thin fleet and crowd. Unmeasured on a device. */
  mobile: {
    shadows: 'off',
    bloom: true,
    aa: false,
    blur: false,
    pixelBudget: 780 * 450,   // ~0.35 MP
    streamRadius: 1,
    traffic: 8,
    crowd: 30,
    farTraffic: 30,
    lights: 1,
    bloomScale: 0.25,
  },
  low: {
    shadows: 'off',           // -48% triangles, -~300 draws (census)
    bloom: false,             // ~12 passes
    aa: false,                // SMAA, 3 passes
    blur: false,
    pixelBudget: 960 * 573,   // ~0.55 MP: 30% fewer pixels than LITE's 0.78 MP
    streamRadius: 1,          // 3x3 chunks, what LITE ships today
    traffic: 14,
    crowd: 80,
    farTraffic: 60,
    lights: 2,              // real night point lights (game/lighting.js LightPool); the rest glow as sprites
    bloomScale: 0.5,          // bloom mip chain resolution (1 = full)
  },
  /* Balanced (2026-09-22): Auto's pick on an integrated GPU. Medium was sized
     on the M2 Air and the owner still called it "very sad" there -- a fanless
     machine throttles its GPU after a few minutes, so a preset measured cold
     runs slow warm. Keeps what makes the city read (near shadows under the car
     and lamps, the night bloom), drops SMAA, renders 0.55 MP (-30% pixels vs
     medium), and runs lighter traffic and crowds (the submit is 74-95% of
     frame CPU). Explicit Medium / High are unchanged. */
  /* 2026-09-24 (Arun: "remove them"): Balanced also runs 3 real night lights
     (was 6) and bloom at a QUARTER resolution (was a half: the glow softens a
     little, its mip chain costs a quarter). */
  balanced: {
    shadows: 'near',
    bloom: true,
    aa: false,
    blur: false,
    pixelBudget: 960 * 573,
    streamRadius: 1,
    traffic: 18,
    crowd: 110,
    farTraffic: 80,
    lights: 3,              // real night point lights (game/lighting.js LightPool); the rest glow as sprites
    bloomScale: 0.25,          // bloom mip chain resolution (1 = full)
  },
  medium: {
    shadows: 'near',          // 1 cascade, 1024 map, 160 m: the near ring only (cascade 0 is 0-52 m today; 160 m keeps street shadows under the car and lamps)
    bloom: true,
    aa: false,
    blur: false,
    pixelBudget: 1152 * 680,  // 0.78 MP, LITE's budget (renderer.js RENDER_BUDGET_PX_LITE)
    /* 1, not 2: the auto pick on the target machine is medium, and LITE runs a
       3x3 ring there today (districtWorld.js:192). 5x5 is 25/9 the chunk work
       with no measurement behind it; radius is a boot-time knob, so the safe
       side is the measured one. High gets the 5x5. */
    streamRadius: 1,
    traffic: 26,
    crowd: 160,
    farTraffic: 120,
    lights: 4,              // real night point lights (game/lighting.js LightPool); the rest glow as sprites
    bloomScale: 0.5,          // bloom mip chain resolution (1 = full)
  },
  high: {
    shadows: 'full',          // whatever the GPU tier already runs: 2x1024/320 m LITE, 3x2048/520 m FULL
    bloom: true,
    aa: true,
    blur: true,
    pixelBudget: 1440 * 860,  // 1.24 MP, the 60 fps floor (renderer.js RENDER_BUDGET_PX)
    streamRadius: 2,          // 5x5
    traffic: 36,
    trafficNight: 40,         // main.js: DAY ? 36 : 40, kept
    crowd: 320,
    farTraffic: 220,
    lights: 6,              // real night point lights (game/lighting.js LightPool); the rest glow as sprites
    bloomScale: 0.5,          // bloom mip chain resolution (1 = full)
  },
};

export const FIELDS = Object.keys(PRESETS.low);   // the required set; high's trafficNight is optional

/** The preset one step down, or null at the bottom. */
export function nextLower(name) {
  return name === 'high' ? 'medium' : name === 'medium' ? 'balanced' : name === 'balanced' ? 'low' : null;
}

/**
 * ?quality=low|medium|high|auto  >  localStorage hb.quality  >  'auto'.
 * Auto picks medium on an integrated / LITE GPU, high otherwise (the tier
 * comes from core/gpu.js: resolveQualityMode already honours ?lite / ?full).
 * `hb.quality` may also hold 'lite' | 'full' (gpu.js's tier override) -- those
 * are not preset names, so they fall through to auto, and the tier they set
 * decides the auto pick. One key, two vocabularies, no mapping table.
 */
export function resolveQuality({ isLite = false, mobile = false, search = null, storage = null } = {}) {
  const q = new URLSearchParams(search ?? (typeof location !== 'undefined' ? location.search : ''));
  let name = (q.get('quality') || '').toLowerCase();
  let source = 'url';
  if (!QUALITY_NAMES.includes(name)) {
    name = '';
    try {
      const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
      const saved = (store?.getItem(STORAGE_KEY) || '').toLowerCase();
      if (PRESETS[saved]) { name = saved; source = 'saved'; }
    } catch { /* private mode */ }
  }
  if (!name || name === 'auto') {
    if (mobile) { name = 'mobile'; source = 'auto, touch device'; }
    else { name = isLite ? 'balanced' : 'high'; source = `auto, ${isLite ? 'integrated' : 'discrete'} GPU`; }
  }
  return { name, source, preset: PRESETS[name] };
}

/** The one boot line: 'quality: MEDIUM (auto, integrated GPU) shadows near, bloom on, aa off, 0.78 MP, radius 1, traffic 26, crowd 0'. */
export function describeQuality(name, source, p, { traffic = p.traffic, crowd = p.crowd } = {}) {
  const on = (b) => (b ? 'on' : 'off');
  return `quality: ${name.toUpperCase()} (${source}) shadows ${p.shadows}, bloom ${on(p.bloom)}, aa ${on(p.aa)}, ${(p.pixelBudget / 1e6).toFixed(2)} MP, radius ${p.streamRadius}, traffic ${traffic}, crowd ${crowd}`;
}

/* Runtime density ladder. Step 0 is the preset; each step keeps this fraction
   of the civilian and far-traffic counts. Two steps before resolution moves:
   the render submit is 74-95% of frame CPU and a hidden car is a draw that
   never happens, while a resolution step reallocates every render target. */
export const DENSITY_STEPS = [1, 0.6, 0.35];

/**
 * Cap the live civilian fleet WITHOUT touching traffic.js: cars past `n` are
 * spliced off `traffic.cars` into `traffic._spare` and hidden, so the update
 * loop (traffic.js:1078 respawns every !live car) never sees them. Restoring
 * pushes them back; their meshes were compiled at boot, so unhiding is free.
 * ponytail: `_losBlockers` (traffic.js:1407) is a cached spread of `cars`
 * and can hold a hidden car until the parked set changes -- a stale, invisible
 * LOS blocker for a few seconds, not a crash.
 */
export function limitTraffic(traffic, n) {
  if (!traffic?.cars) return 0;
  traffic._spare ??= [];
  while (traffic.cars.length > n) {
    const c = traffic.cars.pop();
    c.live = false; if (c.mesh) c.mesh.visible = false;
    traffic._spare.push(c);
  }
  while (traffic.cars.length < n && traffic._spare.length) traffic.cars.push(traffic._spare.pop());
  return traffic.cars.length;
}

/** farTraffic.n sizes its loops and the sprite count; the buffers were sized at boot, so only ever lower it below that. */
export function limitFarTraffic(far, n) {
  if (!far) return 0;
  far._n0 ??= far.n;
  far.n = Math.max(0, Math.min(far._n0, Math.round(n)));
  return far.n;
}
