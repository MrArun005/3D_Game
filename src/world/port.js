import * as THREE from 'three';
import { mergeGeos } from '../core/geometry.js';
import { InstanceBatch } from './catalogue.js';
import { SHADOW_FAR_LAYER } from '../core/renderer.js';
import { containerColour } from './dressing.js';

/**
 * Harbour Point's working waterfront: the container port.
 *
 * The docks district touches the bay along the first shore segment, and until
 * now that segment got the same sand ribbon as the rest of the coast while the
 * district's yards got a scatter of crates at 45% density. Neither reads as a
 * port. What does -- from any distance, in one glance -- is the GTA/Port of
 * Los Angeles silhouette: a hard quay wall with a drop to the water, a paved
 * apron, gantry cranes straddling it with their booms out over a moored
 * container ship, and dense, aligned container stacks behind, with sheds
 * behind those.
 *
 * Layout is procedural along the quay line (the coast segment inside the
 * district boundary); the repeated detail -- containers, quay copings,
 * mooring bollards -- comes from the asset catalogue through an InstanceBatch,
 * exactly as dressing.js places the same props on the district's yards, so
 * the port's stacks are the yard's stacks. The big forms that no kit carries
 * -- cranes, sheds, the ship's hull -- are merged boxes and one extruded hull
 * plan, a handful of draws in total.
 *
 * Coordinates: `u` runs along the quay from its start, `w` is metres LANDWARD
 * of the coastline (negative = out over the water). beach.js uses the same
 * landward-normal convention for its rows.
 */

const WATER_Y = -2.6;              // water.js
/* Top of the apron. The car's ground plane is y=0 everywhere -- beach.js keeps
   its sand under 0.18 for the same reason -- so every centimetre this stands
   proud is a centimetre the wheels sink into it. The wall below still gives a
   real 3 m drop to the water; the drop is the wall's job, not the slab's. */
const QUAY_Y = 0.12;
const APRON = 34;                  // metres of paved apron behind the wall
const CRANE_EVERY = 95;
const YARD_FROM = APRON + 6, YARD_TO = 118;

/** Point-in-polygon, ray cast. Polygons are [[x, z], ...]. */
function inside(x, z, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) ins = !ins;
  }
  return ins;
}

/** The coast segments (of the bay) whose midpoint lies inside the district polygon. */
export function quaySegments(district) {
  const data = district.data;
  const hp = (data.districts || []).find((d) => /HARBOUR/i.test(d.name || ''));
  const bay = data.water?.bay?.points || data.water?.bay;
  if (!hp?.boundary || !bay) return [];
  const cx = bay.reduce((s, p) => s + p[0], 0) / bay.length;
  const cz = bay.reduce((s, p) => s + p[1], 0) / bay.length;
  const out = [];
  for (let i = 0; i < bay.length - 1; i++) {
    const a = bay[i], b = bay[i + 1];
    if (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1) continue;   // map-border edges are not shore
    if (!inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, hp.boundary)) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    let nx = -dz / L, nz = dx / L;
    if (nx * (cx - (a[0] + b[0]) / 2) + nz * (cz - (a[1] + b[1]) / 2) > 0) { nx = -nx; nz = -nz; }   // landward
    /* Clip to the run of the segment that is actually inside the district.
       The midpoint test above passes for the docks' shore segment, but its
       START does not: the bay polygon's first vertex sits on the map's south
       edge at z=3060 and Harbour Point's boundary stops at z=3000. A clip that
       ran "from the start until the first outside sample" hit outside at u=0
       and returned a quay of length zero -- a port of nothing but a ship
       (2026-09-08). Scan for the first AND last inside sample, and start the
       quay at the first. */
    let uStart = -1, uEnd = -1;
    for (let u = 0; u <= L; u += 4) {
      if (inside(a[0] + dx / L * u, a[1] + dz / L * u, hp.boundary)) { if (uStart < 0) uStart = u; uEnd = u; }
    }
    if (uStart < 0 || uEnd - uStart < 40) continue;
    const start = [a[0] + dx / L * uStart, a[1] + dz / L * uStart];
    out.push({ a: start, ux: dx / L, uz: dz / L, nx, nz, L: uEnd - uStart });
  }
  return out;
}

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
function mat(x, y, z, yaw, sx = 1, sy = 1, sz = 1) {
  _e.set(0, yaw, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function buildPort(scene, district, catalogue, day = true) {
  const group = new THREE.Group();
  group.name = 'port';
  const segs = quaySegments(district);
  if (!segs.length) { scene.add(group); return { group, update() {} }; }

  const batch = catalogue ? new InstanceBatch(catalogue) : null;
  /* Library materials, the same ones the 91 kit props bind to, so the port is
     made of the city's own concrete, asphalt and galvanised steel rather than
     flat Lambert colour. A tint clones the material and sets .color, which
     multiplies the albedo map. Kit UVs are in METRES (PIPELINE.md), so every
     box here gets metre UVs too or a 64 m shed would stretch one texture
     across its whole side. Falls back to Lambert if the catalogue is absent. */
  const lib = (name, tint = null, fallback = 0x9a9a9a) => {
    const m = catalogue?.materials?.get?.(name);
    if (!m) return new THREE.MeshLambertMaterial({ color: tint ?? fallback });
    if (tint === null) return m;
    const c = m.clone(); c.color = new THREE.Color(tint); c.name = `${name}:${tint.toString(16)}`;
    return c;
  };
  const metreUVs = (g, lx, ly, lz) => {          // BoxGeometry, one segment: 6 faces x 4 verts, uv 0..1 per face
    const uv = g.attributes.uv, dims = [[lz, ly], [lz, ly], [lx, lz], [lx, lz], [lx, ly], [lx, ly]];
    for (let f = 0; f < 6; f++) for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    uv.needsUpdate = true;
    return g;
  };
  const solid = (parts, mat, shadow = true) => {
    if (!parts.length) return null;
    const m = new THREE.Mesh(mergeGeos(parts), mat);
    m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
    /* Beyond 52 m of the camera only SHADOW_FAR_LAYER casts (renderer.js GatedCSM):
       without this flag a 42 m crane throws no shadow from anywhere you can see
       the whole crane. */
    if (shadow) m.layers.enable(SHADOW_FAR_LAYER);
    group.add(m);
    return m;
  };
  const concrete = lib('asphalt');                          // a container apron is asphalt
  const wallMat = lib('concrete_precast');
  const craneMat = lib('metal_painted', 0xd8552a);           // the Port-of-LA red-orange
  const shedMat = lib('metal_galv');                         // corrugated galvanised sheds
  const shedRoof = lib('metal_galv', 0x6a7078);
  const hullMat = lib('metal_painted', 0x25313f);
  const bootMat = lib('metal_rust');                         // boot-topping: the rusted band at the waterline
  const superMat = lib('metal_painted', 0xf1efe8);
  const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

  for (const seg of segs) {
    const { a, ux, uz, nx, nz, L } = seg;
    // yaw that lays a box's local +X along the quay (u) -- forward = (cos yaw, -sin yaw)
    const yaw = Math.atan2(-uz, ux);
    const W = (u, w) => [a[0] + ux * u + nx * w, a[1] + uz * u + nz * w];
    const box = (list, u, w, y, lu, ly, lw) => {           // a box centred at (u, w, y), sized along u / y / w
      const [x, z] = W(u, w);
      const g = metreUVs(new THREE.BoxGeometry(lu, ly, lw), lu, ly, lw);
      g.applyMatrix4(mat(x, y, z, yaw));
      list.push(g);
    };

    /* --- the quay wall and the apron -------------------------------------- */
    const wall = [], apron = [];
    box(wall, L / 2, -1.2, (QUAY_Y + WATER_Y - 1.2) / 2, L, QUAY_Y - (WATER_Y - 1.2), 2.4);   // a real drop to the water
    box(apron, L / 2, APRON / 2, QUAY_Y - 0.1, L, 0.2, APRON);
    solid(wall, wallMat, false);
    solid(apron, concrete, false);
    if (batch) {
      for (let u = 2; u < L - 2; u += 4) { const [x, z] = W(u, 0.6); batch.add('props/quay_edge', mat(x, QUAY_Y, z, yaw)); }
      for (let u = 6; u < L - 6; u += 12) { const [x, z] = W(u, 1.4); batch.add('props/mooring_bollard', mat(x, QUAY_Y, z, yaw)); }
    }

    /* --- gantry cranes ----------------------------------------------------- */
    /* A ship-to-shore crane is a portal on four legs straddling the apron,
       with a boom out over the berth. 42 m to the portal beam, a 62 m boom:
       small for the real thing (they run 50/70), big enough that three of them
       own the skyline from the beach. */
    const crane = [];
    for (let u = CRANE_EVERY / 2; u < L - 20; u += CRANE_EVERY) {
      const gauge = 22, baseLen = 12, H = 42;
      const legsClear = [-baseLen / 2, baseLen / 2].every((du) =>
        [3, 3 + gauge].every((w) => { const [x, z] = W(u + du, w); return district.tarmacDepth(x, z) > 0.5; }));
      if (!legsClear) continue;                                                            // a crane leg in the carriageway is a wall
      for (const du of [-baseLen / 2, baseLen / 2]) for (const w of [3, 3 + gauge]) box(crane, u + du, w, H / 2, 2.0, H, 2.0);
      box(crane, u, 3 + gauge / 2, H + 1, baseLen + 2, 2.2, gauge + 4);                  // portal beam
      box(crane, u, 3 + gauge / 2, 4, baseLen + 2, 1.6, gauge + 4);                      // sill beam
      box(crane, u, 3 + gauge / 2 - 31, H + 4.5, 3.0, 2.6, 62);                          // the boom, out over the water
      box(crane, u, 3 + gauge / 2, H + 4.5, 3.0, 2.6, 30);                               // and back over the yard
      box(crane, u, 3 + gauge / 2 + 6, H + 9, 6, 6, 8);                                  // machinery house
      box(crane, u, 3 + gauge / 2 - 6, H + 14, 1.2, 16, 1.2);                            // A-frame mast
    }
    solid(crane, craneMat);

    /* --- the container yard ------------------------------------------------ */
    /* Dense and aligned. dressing.js scatters the same stacks at 45% on a
       rotated grid, which is a yard; a port stacks them in rows with lanes,
       and the eye reads the order before it reads any single box. */
    if (batch) {
      let n = 0;
      for (let w = YARD_FROM; w < YARD_TO; w += 4.6) {
        const row = Math.round((w - YARD_FROM) / 4.6);
        if (row % 4 === 3) continue;                                                     // a lane every fourth row
        for (let u = 8; u < L - 8; u += 3.4) {
          const col = Math.round((u - 8) / 3.4);
          if (col % 9 === 8) continue;                                                   // and a road every ninth column
          if (hash(u, w) > 0.86) continue;                                               // a few gaps, so it is a yard and not a wall
          const [x, z] = W(u, w);
          if (district.tarmacDepth(x, z) <= 0.5) continue;                                 // never on a street (CLAUDE.md placement rule)
          const asset = hash(w, u) < 0.72 ? 'props/container_stack' : 'props/container';
          batch.add(asset, mat(x, QUAY_Y, z, yaw), containerColour(x, z, asset));
          n++;
        }
      }
      group.userData.stacks = n;
    }

    /* --- sheds behind the yard -------------------------------------------- */
    const sheds = [], roofs = [];
    for (let u = 30; u < L - 40; u += 82) {
      // a shed straddling a street is worse than no shed: probe its centre and four corners
      const clear = [[0, 0], [-32, -15], [32, -15], [-32, 15], [32, 15]].every(([du, dw]) => {
        const [x, z] = W(u + du, YARD_TO + 22 + dw);
        return district.tarmacDepth(x, z) > 0.5;
      });
      if (!clear) continue;
      box(sheds, u, YARD_TO + 22, QUAY_Y + 6, 64, 12, 30);
      box(roofs, u, YARD_TO + 22, QUAY_Y + 12.6, 66, 1.2, 32);
    }
    solid(sheds, shedMat);
    solid(roofs, shedRoof);

    /* --- the moored container ship ---------------------------------------- */
    /* One hull plan extruded, so it has a bow. 168 m long, 26 m beam, sitting
       so the waterline crosses the boot-topping. Superstructure aft, deck
       stacked with the yard's own containers through the same batch. */
    {
      const LEN = 168, BEAM = 26, DEPTH = 15;
      const cu = L * 0.5, cw = -(2.4 + 8 + BEAM / 2);                                    // berthed 8 m off the wall
      const [cx0, cz0] = W(cu, cw);
      const plan = new THREE.Shape();                                                    // in (u, w) metres, centred
      plan.moveTo(-LEN / 2, -BEAM / 2);
      plan.lineTo(LEN / 2 - 26, -BEAM / 2);
      plan.quadraticCurveTo(LEN / 2, -BEAM * 0.15, LEN / 2, 0);                          // the bow
      plan.quadraticCurveTo(LEN / 2, BEAM * 0.15, LEN / 2 - 26, BEAM / 2);
      plan.lineTo(-LEN / 2, BEAM / 2);
      plan.lineTo(-LEN / 2, -BEAM / 2);
      const hullGeo = new THREE.ExtrudeGeometry(plan, { depth: DEPTH, bevelEnabled: false });
      // ExtrudeGeometry extrudes along +Z: stand it up so depth runs along Y, plan (x, y) -> world (u, w)
      hullGeo.rotateX(-Math.PI / 2);
      hullGeo.translate(0, WATER_Y - 6.5, 0);                                            // 6.5 m of hull under the water
      const boot = new THREE.ExtrudeGeometry(plan, { depth: 1.6, bevelEnabled: false });
      boot.rotateX(-Math.PI / 2); boot.scale(1.004, 1, 1.004); boot.translate(0, WATER_Y - 0.6, 0);
      const sup = [];
      const deckY = WATER_Y - 6.5 + DEPTH;
      const put = (list, du, dw, y, lu, ly, lw) => { const g = metreUVs(new THREE.BoxGeometry(lu, ly, lw), lu, ly, lw); g.translate(du, y, dw); list.push(g); };
      put(sup, -LEN / 2 + 22, 0, deckY + 9, 16, 18, BEAM - 2);                          // accommodation block
      put(sup, -LEN / 2 + 22, 0, deckY + 19.5, 20, 3, BEAM + 4);                         // bridge deck with wings
      const funnel = new THREE.CylinderGeometry(2.2, 2.6, 8, 12); funnel.translate(-LEN / 2 + 16, deckY + 22, 0); sup.push(funnel);
      put(sup, LEN / 2 - 8, 0, deckY + 1.5, 10, 3, 6);                                  // forecastle
      const shipMat4 = mat(cx0, 0, cz0, yaw);
      for (const g of [hullGeo, boot, ...sup]) g.applyMatrix4(shipMat4);
      solid([hullGeo], hullMat, false);
      solid([boot], bootMat, false);
      solid(sup, superMat);
      if (batch) {                                                                       // containers on deck
        for (let du = -LEN / 2 + 36; du < LEN / 2 - 20; du += 3.4) {
          for (let dw = -BEAM / 2 + 3; dw < BEAM / 2 - 2; dw += 4.2) {
            if (hash(du, dw) > 0.9) continue;
            const [x, z] = W(cu + du, cw + dw);
            batch.add('props/container_stack', mat(x, deckY, z, yaw), containerColour(x, z, 'props/container_stack'));
          }
        }
      }
    }
  }

  const props = new THREE.Group();
  props.name = 'port-props';
  group.add(props);
  if (batch) batch.emit(props, { lod: 1 }).then(() => { props.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); });

  scene.add(group);
  return {
    group,
    update() {
      /* No heave. The hull is three merged meshes but its deck cargo sits in
         the catalogue batch with the yard's containers, so a bobbing hull
         would slide under stationary boxes. A ship alongside a container berth
         is held still by its lines anyway. */
    },
  };
}
