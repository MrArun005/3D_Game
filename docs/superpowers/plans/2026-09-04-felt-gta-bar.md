# Felt GTA Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Halstead Bay *feel* like its own bar — “GTA IV-era geometry under modern lighting” — on this 8 GB M2, without adding new game systems.

**Architecture:** Work in the existing three.js / WebGPU / TSL stack. Do not add clustered lights, SSR, probes, motion blur, new districts, or new mission types. Sequence is reliability → driving feel → look, because lighting/art authored on a hitchy or 37 fps machine is a lie.

**Tech Stack:** three r185 `WebGPURenderer`, TSL post in `src/core/grade.js`, district streamer `src/world/districtWorld.js`, traffic `src/game/traffic.js`, facades `src/world/facades.js`.

**Out of scope (YAGNI until this plan is done):** ROADMAP 1.4 clustered lights, 1.5 irradiance probes, SSR, 3.1b Blender kit bake of 91 assets, 3.3 10× clutter, new story missions.

---

## What is already true (do not rebuild)

| Piece | Where | Status |
| --- | --- | --- |
| WebGPU + TSL, no `onBeforeCompile` | `src/core/renderer.js`, CLAUDE.md | Done |
| GTAO + bloom + SMAA + in-canvas grade | `src/core/grade.js` | Done |
| CSM (3 cascades, far = shells only) | `src/core/renderer.js` `GatedCSM` | Done |
| F3 stats vs `docs/BUDGETS.md` | `src/ui/stats.js` | Done |
| Chunk work sliced ~4 ms | `src/world/districtWorld.js` | Done (verify, do not rewrite) |
| `?lite` (no GTAO, fewer crowd/people) | `src/main.js` | Exists, **opt-in only** |
| Painted window “interiors” | `src/world/facades.js` `interior()` | 2D canvas, not parallax |

The remaining gap is not “more renderer.” It is boot that stalls, resolution that does not actually adapt, traffic that reads as hovering blobs, and facades that go flat inside 30 m.

---

## File map

| File | Role in this plan |
| --- | --- |
| `src/main.js` | Boot progress, yield between phases, auto-`lite` on 8 GB, keep 12 s overlay cap honest |
| `src/core/renderer.js` | Restore `autoResolution()` (currently a no-op) |
| `src/core/grade.js` | Only if SMAA still crawls: TAA; wet-road is weather uniforms, not a new pipeline |
| `src/game/traffic.js` | Sit-on-road offset; variety already uses `BODY_TYPES` |
| `src/world/vendorCars.js` / parked emit in `districtWorld.js` | Separate wheels or a measured Y offset so tyres meet tarmac |
| `src/world/facades.js` | Interior-mapping TSL node on existing window UVs |
| `src/world/textures.js` / `src/world/assets.js` | Wet roughness from weather; ground wear atlas |
| `src/world/weather.js` | Drive road wetness (ROADMAP 2.4) |
| `src/game/input.js` | Title-screen arming (REVIEW item 9) — only if still flaky after boot fix |
| `docs/BUDGETS.md` | Streaming note is stale vs districtWorld slicer; update when verifying |
| `test/*.test.js` | Node tests for offsets, wetness mapping, boot helpers that are pure |

---

## Sequence (one plan, three phases)

1. **Reliability** — machine can boot and hold 60 fps at 1440×860 (or the lite path).
2. **Feel** — driving does not hitch; other cars sit on the road.
3. **Look** — windows have depth, streets are not identically clean, rain changes the road.

Do not start phase 3 until F3 shows median ≤ 16.6 ms and 1% low not destroyed by chunk builds.

---

### Task 1: Stop lying about boot

**Files:**
- Modify: `src/main.js` (boot block ~73–114)
- Test: `test/boot-progress.test.js` (pure helper if you extract `setBootProgress` / `yieldToPaint`)

`await renderer.init()` is the 25% “Starting the renderer…” stall. The overlay is static HTML; if the main thread does not yield, the bar never moves. The 12 s `boot.remove()` cap can drop the overlay while the GPU is still compiling, which feels like a frozen black canvas.

- [ ] **Step 1: Add a paint yield that the boot path can await**

```js
// src/main.js — next to setBootProgress
const yieldToPaint = () => new Promise((r) => requestAnimationFrame(() => r()));

const setBootProgress = async (pct, m) => {
  if (bootMsg) bootMsg.textContent = m;
  if (bootProgress) bootProgress.style.width = `${pct}%`;
  if (bootPercent) bootPercent.textContent = `${pct}%`;
  await yieldToPaint();
};
```

Call sites that are currently sync `setBootProgress(25, …)` must `await setBootProgress(25, …)` before `await renderer.init()`.

- [ ] **Step 2: Bound `renderer.init()` so failure is visible**

```js
await setBootProgress(25, 'Starting the renderer…');
const INIT_MS = 20000;
const init = renderer.init();
const timed = new Promise((_, rej) =>
  setTimeout(() => rej(new Error(`renderer.init() exceeded ${INIT_MS}ms`)), INIT_MS),
);
try {
  await Promise.race([init, timed]);
} catch (e) {
  console.warn(e);
  location.replace(location.pathname + '?lite=1&nopost=1');
  return;
}
```

If `?lite` / `?nopost` is already on, do not redirect in a loop — fall through and keep the overlay message.

- [ ] **Step 3: Manual check (do not add a browser harness)**

Chrome on this Mac: cold load `http://localhost:5173/`. Overlay must leave 10% → 25% → 45% before first frame. If `renderer.init` exceeds 20 s, URL becomes `?lite=1&nopost=1` once.

- [ ] **Step 4: Commit** only if the user asked for commits.

```bash
git add src/main.js
git commit -m "fix: yield boot overlay and fail open to lite if renderer.init hangs"
```

---

### Task 2: Auto-lite on 8 GB, restore adaptive resolution

**Files:**
- Modify: `src/main.js` (`isLite` ~102)
- Modify: `src/core/renderer.js` `autoResolution` ~108–110 (empty function today)
- Modify: `docs/BUDGETS.md` frame-budget “Current” after a real F3 read

The comment in `renderer.js` already states the fact: DPR 2 on this panel is 6.7 MP and the M2 drops to ~37 fps; 1.25 locks 60. `autoResolution` currently returns `() => {}`. That is why “the Mac can do 3D” and “the game holds 60” are different sentences.

- [ ] **Step 1: Detect unified memory once at boot**

```js
const gb = (navigator.deviceMemory || 8);
const isLite = new URLSearchParams(location.search).has('lite')
  || (gb <= 8 && !new URLSearchParams(location.search).has('full'));
```

`?full` is the escape hatch for screenshots / cinematic. Default on this Air is lite (no GTAO, 160 crowd, 8 skinned people — already wired).

- [ ] **Step 2: Implement `autoResolution` for real**

```js
export function autoResolution(renderer) {
  let dpr = Math.min(1.25, window.devicePixelRatio || 1);
  let ema = 16.6;
  renderer.setPixelRatio(dpr);
  return (dtMs) => {
    ema = ema * 0.9 + dtMs * 0.1;
    if (ema > 18 && dpr > 1.0) {
      dpr = Math.max(1.0, dpr - 0.05);
      renderer.setPixelRatio(dpr);
    } else if (ema < 14 && dpr < 1.25) {
      dpr = Math.min(1.25, dpr + 0.025);
      renderer.setPixelRatio(dpr);
    }
  };
}
```

Hook the returned function from the existing frame loop in `src/main.js` (search `requestAnimationFrame` / `frame(`). Pass `dt * 1000`. After `setPixelRatio`, call existing `grade.resize(...)`.

- [ ] **Step 3: Verify with F3, not vibes**

Acceptance: at spawn `kingsway-corner`, F3 median ≤ 16.6 ms in `?lite` (default here). `?full` may dip; that is documented, not a bug.

- [ ] **Step 4: Commit** if asked.

```bash
git commit -m "perf: default lite on 8GB and restore adaptive pixel ratio"
```

---

### Task 3: Prove streaming is already sliced (feel, no rewrite)

**Files:**
- Read: `src/world/districtWorld.js` (4 ms comments ~1316)
- Modify: `docs/BUDGETS.md` streaming section (still says “fully synchronous… five chunks in one frame” — stale vs PROFILE-2026-09)
- Use: F3 `worstChunkMs` / `reportChunkTotal`

- [ ] **Step 1: Drive across 3 chunk boundaries with F3 on**

Acceptance: no `reportChunkBuild` sample > 8 ms (2× budget is a hitch; 4 ms is the target). If worst is already ≤ 8 ms, **do not** re-architect the generator.

- [ ] **Step 2: If worst > 8 ms**

Find the slice in `districtWorld.js` that still does a full `dressRoofs` / kit emit in one tick. Split that function the same way existing “sliced” comments do: `performance.now()` budget 4.0, yield to next frame. Do not add a worker.

- [ ] **Step 3: Fix BUDGETS.md streaming paragraph** to match the slicer so the next session does not “fix” a solved problem.

---

### Task 4: Traffic sits on the road

**Files:**
- Modify: `src/game/traffic.js` `#place` ~489–503
- Modify: parked-car emit in `src/world/districtWorld.js` (search parked / `BODY_TYPES`)
- Test: `test/traffic-ground.test.js`

REVIEW: traffic bodies are merged blobs; tyres baked in; they hover. Full Kenney rebuild is ROADMAP 3.4 — **out of this phase**. This task is the sit-height fix only.

- [ ] **Step 1: Failing test for ground Y**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

/** Wheel radius of the merged traffic mesh; keep in sync with traffic.js */
export const TRAFFIC_WHEEL_R = 0.32;

export function trafficMeshY(groundY, wheelR = TRAFFIC_WHEEL_R) {
  return groundY + wheelR;
}

test('traffic mesh origin sits one wheel radius above tarmac', () => {
  assert.equal(trafficMeshY(0), 0.32);
  assert.equal(trafficMeshY(7.6), 7.92);
});
```

- [ ] **Step 2: Run** `node --test test/traffic-ground.test.js` — fail until `traffic.js` imports the helper.

- [ ] **Step 3: Use it in `#place`**

```js
import { trafficMeshY, TRAFFIC_WHEEL_R } from '../../test/traffic-ground.test.js';
```

Do **not** import from test. Put the helper in `src/game/trafficGround.js` and import from both test and `traffic.js`.

```js
car.mesh.position.set(car.x, trafficMeshY(groundHeightAt(car.x, car.z), TRAFFIC_WHEEL_R), car.z);
```

Tune `TRAFFIC_WHEEL_R` against one screenshot at spawn until the tyre meets asphalt. Parked cars: same helper at emit.

- [ ] **Step 4: Commit** if asked.

```bash
git commit -m "fix: sit traffic and parked cars on tarmac"
```

Variety (`BODY_TYPES` already referenced in `traffic.js:166`) is **not** this task. Separate wheels is ROADMAP 3.4, later.

---

### Task 5: Input arming after overlay drop

**Files:**
- Modify: `src/game/input.js`
- Modify: `src/main.js` where overlay is removed (`frame()` first rendered frame + 12 s cap)

REVIEW item 9: first clicks/keys swallowed.

- [ ] **Step 1: Arm input only after `boot` is null**

In the key/mouse listeners, if `document.getElementById('boot')` exists, return. When `boot.remove()` runs, call `input.arm()` (add a one-liner `armed = true` if missing).

- [ ] **Step 2: Click-to-start on the canvas** after overlay is gone, not during 25% init.

Acceptance: first W after load throttles. No retry loop.

---

### Task 6: Interior mapping (highest look payoff)

**Files:**
- Modify: `src/world/facades.js` (window UVs already exist; `interior()` paints furniture silhouettes into the albedo)
- Modify: facade `*NodeMaterial` bind site (`src/world/city.js` comment already says “Parallax room interior”)
- Follow CLAUDE.md: no `ShaderMaterial`, no `onBeforeCompile`; TSL only; pin `materialReference` with the material as third arg (shadow-pass crash lesson)

This is ROADMAP 2.2. Building stays one box / one draw. Fake room in the window.

- [ ] **Step 1: Add a TSL interior node, not a new mesh**

Use box-interior mapping: given window UV in 0–1 of each pane, intersect a view ray with a unit room, sample a tiny packed room atlas (existing `interior()` canvas can be the atlas).

Sketch (TSL, attach as `colorNode` on the **Node** facade material, not `MeshStandardMaterial`):

```js
// world/interiorMap.js — new, single responsibility
import { Fn, uv, cameraPosition, positionWorld, normalWorld, texture } from 'three/tsl';

export function interiorColorNode(roomMap, material) {
  return Fn(() => {
    // roomMap: existing facade emissive/albedo atlas, pane UVs already in uv()
    // parallax: offset uv by view vector vs normalWorld, cheap 2-tap
    const V = cameraPosition.sub(positionWorld).normalize();
    const n = normalWorld;
    const para = V.xy.mul(0.08); // tune; not a second room mesh
    return texture(roomMap, uv().add(para));
  })();
}
```

Pin every `materialReference` with `material` as third argument.

- [ ] **Step 2: Night screenshot acceptance**

Drive past a tower at night: window contents shift with camera (parallax), not a sticker. Draw calls unchanged (F3). If draw calls rise, revert — the point is zero extra draws.

- [ ] **Step 3: Daytime**

Keep `daylightAssets()` dimming emissive; interior mapping must not relight noon windows as lamps.

---

### Task 7: Wet road + wear (streets stop looking identically clean)

**Files:**
- Modify: `src/world/assets.js` road material roughness (REVIEW / ROADMAP 2.4: roughness never changes in rain)
- Modify: `src/world/weather.js` to set a `wet` uniform 0–1
- Modify: `src/world/textures.js` — one extra canvas atlas: stains/cracks, applied as a second UV or vertex-coloured multiply on road/pavement **inside existing road draw**, not a deferred decal engine

Skip “screen-space deferred decals” (ROADMAP 2.3 full). One atlas + existing road mesh is enough for “not identically clean.”

- [ ] **Step 1: `wet` uniform**

```js
road.roughness = 0.42 - 0.28 * weather.wet; // dry 0.42, rain ~0.14
road.envMapIntensity = 0.35 + 0.45 * weather.wet;
```

Use `materialReference('roughness', 'float', road)` if roughness is a node material, or the rain will bake.

- [ ] **Step 2: Wear atlas**

Stamp 4–8 crack/stain tiles in `textures.js`, multiply into road albedo in the same `toTex()` pass so anisotropy stays correct (do not bypass `toTex()`).

Acceptance: two adjacent blocks do not look cloned-clean; rain visibly tightens specular on tarmac. F3 draws unchanged.

---

### Task 8: Aliasing — measure before replacing SMAA

**Files:**
- Read: `src/core/grade.js` ~134–141 (`smaa` already in the stack)
- Only then: TAA from three TSL if still crawling

REVIEW called thin-edge crawl OPEN before SMAA landed in this file. Do not stack TAA on SMAA.

- [ ] **Step 1: Still of mullions / lamp posts at noon, SMAA on vs `?noaa`**

If SMAA already kills crawl, **stop**. If not, swap SMAA for three’s TAA node in the same slot (`withAA` path). Keep grain after AA.

Acceptance: no new 10 Hz GTAO strobe (denoise stays until TAA is proven). 60 fps floor holds in lite.

---

## Self-review

| Spec / source | Task |
| --- | --- |
| 8 GB M2 boot / 60 fps | 1, 2 |
| Chunk hitch (REVIEW #1, BUDGETS stale) | 3 |
| Traffic hover (REVIEW §2, ROADMAP 3.4 reduced) | 4 |
| Input swallow (REVIEW #9) | 5 |
| Interior mapping (ROADMAP 2.2, REVIEW §3) | 6 |
| Clean streets / wet road (2.3 light, 2.4) | 7 |
| Aliasing (REVIEW #2, SMAA already present) | 8 |
| Clustered lights / SSR / probes / new missions | Explicitly out |

No TBD sections. Later ROADMAP 3.4 (real traffic LODs + spinning wheels) is the upgrade after Task 4’s offset looks wrong on purpose (blob still blob, just grounded).
