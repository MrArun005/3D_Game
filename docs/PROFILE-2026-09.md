# Halstead Bay — September 2026 Performance Profile (Phase 0)

Measured at preset `kingsway-corner` (driver camera at spawn, pos: `[2350, 3, 1348]`, look: `[2430, 1.5, 1348]`).

## 1. System-by-System Isolation Table

| Configuration / Flag | Total Draws | Bundled Draws | Triangles | Status & Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Baseline (Pre-Phase 0)** | **8,329** | 0 (OFF) | **10.70 M** | Render bundles disabled; 32 un-culled skinned humans; monolithic setback stages everywhere |
| **Unbundled Bloat Identified** | **7,075** | 737 | **8.27 M** | 32 metro carriages cloned raw `train_ride.glb` (~60 un-culled meshes each, drawing 4 shadow cascades = ~7,680 unbundled draws). Crowd limb segments had 10 radial / 8 rings. |
| **Pre-Roadmap Measured State** | **1,404** (661 direct) | 743 bundled | **3.95 M** (1.34 M direct) | At ceiling (Budget: ≤ 1,400 draws, ≤ 4.0M tris). 28.7 ms med, 50.0 ms 1% low. |
| **Phase A3 Headroom Target** | **≤ 1,150** (≤ 400 direct) | ~750 bundled | **≤ 3.20 M** | Metro LOD (swap >150m, cull >400m), KTX2 textures, unbundled audit. Creates 250-draw headroom for tank & heli. |

---

## 2. Key Remediation Summary

1. **Elevated Metro Carriages Merged (`metro.js`)**:
   - Merged dozens of carriage submeshes by material into 3-4 meshes per car with `frustumCulled = true`.
   - Capped elevated arterial lines to the 2 longest arterials.
   - Slashed over **5,600 unbundled draw calls** in a single fix.
2. **Crowd Fleet Geometry Streamlining (`figure.js`)**:
   - Streamlined limb segments (`cylAt`, `sphereAt`, `eggAt`) to 6 radial segments and 4-5 rings.
   - Saved **~900,000 triangles** across the 560 crowd instances.
3. **Surrounds, Water & Clutter Geometry Tuning**:
   - Mountain ring grid tuned ($N=120$), fence posts spaced at 6.2m, and water curve segments set to 6.
   - Saved **~350,000 background triangles**.
4. **WebGPU Render Bundles Restored**:
   - `USE_BUNDLES = !has('nobundles')` re-enabled in `districtWorld.js`.
   - Bypasses CPU re-walking, re-culling, and re-binding of chunk meshes.
5. **Skinned Pedestrian Throttling**:
   - Cap at 16 with 40m distance threshold.
6. **Time-Budgeted Chunk Generator**:
   - Chunk streaming yields every **4.0 ms** of real work via `performance.now()`, eliminating streaming hitches.
7. **`?lite` Mode**:
   - Provides a low-thermal fallback with 4 lights, disabled GTAO, 160 crowd fleet, and 8 skinned humans.

