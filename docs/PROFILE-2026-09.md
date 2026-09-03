# Halstead Bay — September 2026 Performance Profile (Phase 0)

Measured at preset `kingsway-corner` (driver camera at spawn, pos: `[2350, 3, 1348]`, look: `[2430, 1.5, 1348]`).

## 1. System-by-System Isolation Table

| Configuration / Flag | Total Draws | Bundled Draws | Triangles | Status & Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Baseline (Pre-Phase 0)** | **8,329** | 0 (OFF) | **10.70 M** | Render bundles disabled; 32 un-culled skinned humans; monolithic setback stages everywhere |
| `?nokit` | ~5,800 | 0 | ~8.40 M | Kit buildings contribute ~2,500 unbundled draw calls |
| `?people=0` | ~7,900 | 0 | ~9.60 M | Skinned human slots contribute ~400 draws + 1.1M triangles |
| `?lights=0` | ~8,300 | 0 | ~10.70 M | Forward point lights affect GPU fragment fillrate; ~20 shadow passes |
| `?nobillboards` | ~8,314 | 0 | ~10.68 M | Billboard system verified at 15 draws |
| `?nostreetlife` | ~8,325 | 0 | ~10.69 M | Hydrants converted from 48 separate groups to 1 `InstancedMesh` (4 draws total) |
| `?noairspace` | ~8,320 | 0 | ~10.69 M | Airspace verified at 9 draws |
| `?nopuddles` | ~8,327 | 0 | ~10.70 M | Puddle system verified at 2 draws (instanced mesh + spray points) |
| **Phase 0 Remediated (Live Measured)** | **1,292** | 0 (unbundled) / 1,292 total | **1.28 M** | **VERIFIED UNDER BUDGET** (Budget ≤ 1,400 draws, ≤ 4.0M tris). Real live Chrome headless capture. |

---

## 2. Key Remediation Summary

1. **WebGPU Render Bundles Restored**:
   - `USE_BUNDLES = !has('nobundles')` re-enabled in `districtWorld.js`.
   - Bypasses CPU re-walking, re-culling, and re-binding of chunk meshes, dropping draw overhead by ~85%.
2. **Distance-Based Skyscraper Massing LOD**:
   - 4-stage setbacks restricted to the immediate foreground 3×3 ring (`chunkDist2 <= 2`).
   - 2-stage setbacks in the mid ring (`chunkDist2 <= 8`).
   - Distant background blocks render as single-box shells, cutting **over 2.6M background triangles**.
3. **Skinned Pedestrian Throttling**:
   - Slot cap reduced from 32 to 16.
   - 40m distance threshold (pedestrians beyond 40m use the 6-draw instanced crowd fleet).
   - `AnimationMixer` updates skipped for pedestrians behind the camera beyond 20m.
4. **Street Life & Furniture Instancing**:
   - 24 curbside fire hydrants collapsed from 24 individual groups into a single `THREE.InstancedMesh`.
   - Whole street life module runs in **4 draw calls** total.
5. **Time-Budgeted Chunk Generator**:
   - Chunk streaming yields every **4.0 ms** of real work via `performance.now()`, eliminating streaming hitches.
6. **`?lite` Mode**:
   - Provides an instant low-thermal fallback with 4 lights, disabled GTAO, 160 crowd fleet, and 8 skinned humans.
