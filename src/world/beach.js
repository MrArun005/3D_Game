import * as THREE from 'three';
import { M4, mergeGeos } from '../core/geometry.js';
import { FigureFleet, FOOT_DROP } from './figure.js';
import { buildSpecies } from './props.js';
import { InstanceBatch } from './catalogue.js';
import { SHADOW_FAR_LAYER } from '../core/renderer.js';

/**
 * Halstead Sands, and the people on it.
 *
 * The bay polygon's landward edge is the coastline; the beach is a three-row
 * ribbon laid along it -- dry sand above the land plate, wet sand crossing the
 * waterline, and a submerged toe that the water hides. Nothing needs to be cut
 * out of anything: the rows simply pass through the water plane.
 *
 * The crowd is one instanced mesh whose matrices are rewritten each frame.
 * A few hundred people is nothing to the GPU, and a beach without them reads
 * as a sandpit.
 */

const DRY = 58;                    // metres of dry sand behind the waterline
const WET = 34;                    // and submerged toe in front of it
const CROWD = 160;

const WATER_TOP = -2.54;           // a hair above water.js's WATER_Y of -2.6

/** Height of the sand at `across` metres seaward of the coastline. */
function sandY(across) {
  return across >= 0 ? 0.06 + (across / DRY) * 0.12
                     : 0.06 + (across / WET) * 3.26;
}
/** Where the sand crosses the water plane -- the visible edge of the sea. */
const WATERLINE = ((-2.6 - 0.06) / 3.26) * WET;

const hash = (x, z) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

export function buildBeach(scene, district, day = true, catalogue = null) {
  const group = new THREE.Group();
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
  const bay = district.data.water.bay;

  // the coast is every bay edge that is not the map boundary
  const cx = bay.reduce((s, p) => s + p[0], 0) / bay.length;
  const cz = bay.reduce((s, p) => s + p[1], 0) / bay.length;
  /* The stretch of shore inside Harbour Point is the container port
     (world/port.js), with a quay wall where this file would lay sand. Ray-cast
     point-in-polygon on the district boundary; the one segment that lands
     inside is the docks' waterfront, the other four are Halstead Sands. */
  const hp = (district.data.districts || []).find((d) => /HARBOUR/i.test(d.name || ''));
  const inDocks = (x, z) => {
    const poly = hp?.boundary; if (!poly) return false;
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) ins = !ins;
    }
    return ins;
  };
  const coast = [];
  for (let i = 0; i < bay.length - 1; i++) {
    const a = bay[i], b = bay[i + 1];
    // the two edges that run along the map border are not shoreline
    if (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1) continue;
    if (inDocks((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
    coast.push([a, b]);
  }

  const pos = [], uv = [], nor = [];
  const surf = { pos: [], uv: [] };
  const strip = [];                // dry-sand band, for scattering people on
  for (const [a, b] of coast) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    let nx = -dz / L, nz = dx / L;
    // point the normal AWAY from the water
    if (nx * (cx - (a[0] + b[0]) / 2) + nz * (cz - (a[1] + b[1]) / 2) > 0) { nx = -nx; nz = -nz; }

    // three rows: dry (above the land), waterline, submerged toe
    /* Every row landward of the coastline must stay ABOVE the land plate at
       -0.06, and only drop once it is over the hole cut for the bay. Sloping
       down from the dune meant 50 of the beach's 58 dry metres were under the
       grass, leaving a tan stripe stranded inland of the sea. */
    /* Kept low on purpose. The car's ground plane is y=0 everywhere, so every
       centimetre the sand stands proud is a centimetre the wheels sink into
       it; 18cm at the dune and 6cm at the water is under the noise, while
       still clearing the land plate at -0.06 cleanly. */
    const rows = [[DRY, 0.18], [0, 0.06], [-WET, -3.2]];
    const P = rows.map(([o, y]) => [
      [a[0] + nx * o, y, a[1] + nz * o], [b[0] + nx * o, y, b[1] + nz * o],
    ]);
    for (let r = 0; r < 2; r++) {
      const [p0, p1] = P[r], [q0, q1] = P[r + 1];
      // wind each triangle so its face normal points UP -- see the material note
      for (const [A, B, C] of [[p0, p1, q1], [p0, q1, q0]]) {
        const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);   // y of (B-A) x (C-A)
        if (ny > 0) pos.push(...A, ...B, ...C); else pos.push(...A, ...C, ...B);
      }
      const v0 = r === 0 ? 0 : DRY / 9, v1 = r === 0 ? DRY / 9 : (DRY + WET) / 9;
      const u = L / 9;
      uv.push(0, v0, u, v0, u, v1, 0, v0, u, v1, 0, v1);
      for (let k = 0; k < 6; k++) nor.push(0, 1, 0);
    }
    // the surf band gets its own strip, from the waterline a little way up
    const sPos = [], sUv = [];
    /* Surf follows the ground, and the ground is what decides where the water
       actually is: the sand crosses the water plane at about 28m seaward, so
       a foam band sitting at +8 to -18 was breaking on dry sand 30m up the
       beach. Three rows -- wet sand, the waterline itself, then out onto the
       open water. */
    const surfRows = [[-11, sandY(-11) + 0.04], [WATERLINE, WATER_TOP], [-46, WATER_TOP]];
    const SP = surfRows.map(([o, y]) => [
      [a[0] + nx * o, y, a[1] + nz * o], [b[0] + nx * o, y, b[1] + nz * o],
    ]);
    for (let r = 0; r < 2; r++) {
      const [p0, p1] = SP[r], [q0, q1] = SP[r + 1];
      sPos.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
      const u = L / 26;
      const v0 = r === 0 ? 0 : 0.55, v1 = r === 0 ? 0.55 : 1;
      sUv.push(0, v0, u, v0, u, v1, 0, v0, u, v1, 0, v1);
    }
    surf.pos.push(...sPos); surf.uv.push(...sUv);

    strip.push({ a, nx, nz, dx: dx / L, dz: dz / L, L });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  /* This was DoubleSide, "because the coast polyline's winding depends on
     which way the bay polygon was authored, and a back-faced beach is an
     invisible one". True -- but DoubleSide does not just show the back face,
     it lights it with the normal FLIPPED, so a sand strip whose winding came
     out reversed was shaded as if it faced the ground: no sun, only the
     hemisphere's dark ground term. That is the near-black beach in the
     2026-09-08 survey shot. The triangles are now wound to face up above, so
     the material can be single-sided and lit properly; if the winding ever
     regresses the beach vanishes, which is a loud failure instead of a dark one. */
  const sand = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    map: sandTexture(), color: day ? 0xffffff : 0x6b6a63, side: THREE.FrontSide,
  }));
  sand.receiveShadow = true;
  sand.frustumCulled = false;
  group.add(sand);

  /* --- the surf ---
     Waves that break need two things a scrolling texture alone cannot give:
     motion ALONG the shore and a wash that runs up and back. The texture
     handles the first; the mesh's own V offset, driven by a slow sine in
     update(), handles the second. */
  const surfTex = foamTexture();
  const surfMat = new THREE.MeshBasicMaterial({
    map: surfTex, transparent: true, depthWrite: false, opacity: 0.9,
    // DoubleSide for the same reason the sand needs it: the coast polyline's
    // winding follows the bay polygon, and half of it faces down. Opaque
    // magenta rendered as nothing at all until this was set.
    side: THREE.DoubleSide,
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(surf.pos), 3));
  sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(surf.uv), 2));
  const surfMesh = new THREE.Mesh(sg, surfMat);
  surfMesh.frustumCulled = false;
  surfMesh.renderOrder = 3;
  group.add(surfMesh);

  /* --- parasols and towels, scattered along the dry band --- */
  const total = strip.reduce((s, r) => s + r.L, 0);
  const at = (t, across) => {                 // t along the whole coast, across the sand
    let run = t;
    for (const r of strip) {
      if (run > r.L) { run -= r.L; continue; }
      return [r.a[0] + r.dx * run + r.nx * across, r.a[1] + r.dz * run + r.nz * across];
    }
    const r = strip[strip.length - 1];
    return [r.a[0] + r.dx * r.L + r.nx * across, r.a[1] + r.dz * r.L + r.nz * across];
  };

  const poles = [], shades = [], towels = [], shadeCol = [], towelCol = [];
  const c = new THREE.Color();
  const SHADE = [0xe8503c, 0xf0b429, 0x2f9ed8, 0xe8e2d2, 0x35b57a];
  for (let i = 0; i < 46; i++) {
    const t = hash(i, 7) * total, across = 8 + hash(i, 13) * (DRY - 20);
    const [x, z] = at(t, across);
    const sy = 0.06 + (across / DRY) * 0.12;
    poles.push(M4(x, sy, z, 0, 0, 0, 0.07, 2.4, 0.07));
    shades.push(M4(x, sy + 2.05, z, 0, hash(i, 31) * 6.28, 0, 1, 1, 1));
    shadeCol.push(SHADE[i % SHADE.length]);
  }
  for (let i = 0; i < 90; i++) {
    const t = hash(i, 19) * total, across = 6 + hash(i, 23) * (DRY - 16);
    const [x, z] = at(t, across);
    towels.push(M4(x, 0.09 + (across / DRY) * 0.12, z, -Math.PI / 2, 0, hash(i, 29) * 6.28, 1.9, 0.95, 1));
    towelCol.push(SHADE[(i * 3) % SHADE.length]);
  }

  const inst = (geo, mat, list, colours, shadow) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.instanceMatrix.needsUpdate = true;
    if (colours) {
      colours.forEach((hex, i) => m.setColorAt(i, c.setHex(hex)));
      m.instanceColor.needsUpdate = true;
    }
    m.frustumCulled = false;
    m.castShadow = !!shadow;
    if (shadow) m.layers.enable(SHADOW_FAR_LAYER);   // palms and parasols: see the note on solid()
    group.add(m);
    return m;
  };

  const parasol = new THREE.ConeGeometry(1.5, 0.55, 10);
  inst(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }), poles);
  inst(parasol, new THREE.MeshLambertMaterial({ color: 0xffffff }), shades, shadeCol, true);
  inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({
    color: 0xffffff, side: THREE.DoubleSide,
  }), towels, towelCol);

  /* --- promenade, palms, pier, lifeguard towers ---
     A 58 m ribbon of sand with grass behind it is a sandpit. What makes a
     GTA beach read as a beach from any angle is the furniture behind the sand
     and one big silhouette over the water: a paved promenade with a palm row,
     a pier on piles with a pavilion at the end, lifeguard towers on stilts.
     Procedural boxes and cylinders merged per material -- the lot is under a
     dozen draws. Palm geometry is props.js's own species, so it matches the
     street palms. */
  const frameAt = (t) => {                    // the coast segment under arc length t
    let run = t;
    for (const r of strip) { if (run > r.L) { run -= r.L; continue; } return r; }
    return strip[strip.length - 1];
  };
  const tOf = (x, z) => {                     // arc length of the coast point nearest (x, z)
    let best = 0, bd = Infinity, acc = 0;
    for (const r of strip) {
      const u = Math.max(0, Math.min(r.L, (x - r.a[0]) * r.dx + (z - r.a[1]) * r.dz));
      const d = (r.a[0] + r.dx * u - x) ** 2 + (r.a[1] + r.dz * u - z) ** 2;
      if (d < bd) { bd = d; best = acc + u; }
      acc += r.L;
    }
    return best;
  };
  // yaw that lays a box's local +X along the SEAWARD normal of segment r
  const seawardYaw = (r) => Math.atan2(r.nz, -r.nx);
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
  // an upward-facing quad, wound like the sand
  const quadUp = (P, Nn, p0, p1, q1, q0) => {
    for (const [A, B, C] of [[p0, p1, q1], [p0, q1, q0]]) {
      const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
      if (ny > 0) P.push(...A, ...B, ...C); else P.push(...A, ...C, ...B);
      Nn.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  };

  // the promenade: a paved band just landward of the dune line
  {
    const P = [], Nn = [];
    for (const r of strip) {
      const o0 = DRY + 1, o1 = DRY + 11, y = 0.22;
      const b = [r.a[0] + r.dx * r.L, r.a[1] + r.dz * r.L];
      quadUp(P, Nn,
        [r.a[0] + r.nx * o0, y, r.a[1] + r.nz * o0], [b[0] + r.nx * o0, y, b[1] + r.nz * o0],
        [b[0] + r.nx * o1, y, b[1] + r.nz * o1], [r.a[0] + r.nx * o1, y, r.a[1] + r.nz * o1]);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    pg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nn), 3));
    // metre UVs: u along the coast, v across, so the slab texture tiles at its authored size
    {
      const U = [], r0 = strip[0];
      for (let i = 0; i < P.length; i += 3) {
        let best = null, bd = Infinity;
        for (const r of strip) { const u = (P[i] - r.a[0]) * r.dx + (P[i + 2] - r.a[1]) * r.dz; const v = (P[i] - r.a[0]) * r.nx + (P[i + 2] - r.a[1]) * r.nz; const d = Math.abs(v - (DRY + 6)); if (d < bd && u > -1 && u < r.L + 1) { bd = d; best = [u, v]; } }
        const [u, v] = best ?? [0, 0]; U.push(u, v);
      }
      pg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
    }
    const prom = new THREE.Mesh(pg, lib('pavement_slab', null, 0xcfc7b8));
    prom.receiveShadow = true; prom.frustumCulled = false;
    group.add(prom);
  }

  // palms along the promenade every 15 m, each leaning its own way
  {
    const palm = buildSpecies('palm');
    const trunks = [], fronds = [];
    for (let t = 8; t < total - 8; t += 15) {
      const [x, z] = at(t, DRY + 6);
      const sc = 0.9 + hash(t, 61) * 0.3, yaw = hash(t, 67) * 6.28;
      trunks.push(M4(x, 0.22, z, 0, yaw, 0, sc, sc, sc));
      fronds.push(M4(x, 0.22, z, 0, yaw, 0, sc, sc, sc));
    }
    inst(palm.trunk, new THREE.MeshLambertMaterial({ color: 0x7a5a3a }), trunks, null, true);
    inst(palm.canopy, new THREE.MeshLambertMaterial({ color: 0x2f6b32, side: THREE.DoubleSide }), fronds, null, true);
  }

  /* the pier: 120 m out over the water on piles, railed, a pavilion at the
     end, broad steps down to the promenade. Sited on the mid-shore segment so
     the 'beach' photo preset frames it. */
  const pierT = tOf(3260, 2606);
  {
    const r = frameAt(pierT), yaw = seawardYaw(r), root = at(pierT, 0);
    const W = (u, v) => [root[0] - r.nx * u + r.dx * v, root[1] - r.nz * u + r.dz * v];   // u seaward, v along the coast
    const timber = [], paint = [], white = [];
    const box = (list, u, y, v, lx, ly, lz) => {
      const [x, z] = W(u, v);
      const g2 = metreUVs(new THREE.BoxGeometry(lx, ly, lz), lx, ly, lz);
      g2.applyMatrix4(M4(x, y, z, 0, yaw, 0, 1, 1, 1));
      list.push(g2);
    };
    const DECK_Y = 3.4, LEN = 120, WID = 8;
    box(timber, LEN / 2 - 3, DECK_Y - 0.25, 0, LEN, 0.5, WID);                            // deck
    for (let u = 2; u < LEN; u += 8) for (const side of [-1, 1]) {                      // piles
      const [x, z] = W(u, side * (WID / 2 - 0.8));
      const pile = new THREE.CylinderGeometry(0.32, 0.36, 7.0, 8);
      pile.applyMatrix4(M4(x, -0.2, z));
      timber.push(pile);
    }
    for (const side of [-1, 1]) {                                                       // rails and posts
      const v = side * (WID / 2 - 0.1);
      box(white, LEN / 2 - 9, DECK_Y + 1.1, v, LEN - 12, 0.1, 0.1);
      box(white, LEN / 2 - 9, DECK_Y + 0.55, v, LEN - 12, 0.08, 0.08);
      for (let u = 0; u < LEN - 12; u += 4) box(white, u, DECK_Y + 0.6, v, 0.12, 1.2, 0.12);
    }
    box(paint, LEN - 9, DECK_Y + 2.1, 0, 12, 4.2, 9);                                   // pavilion
    box(timber, LEN - 9, DECK_Y + 4.35, 0, 13.5, 0.35, 10.5);                            // its roof
    for (let i = 0; i < 4; i++) box(timber, -4.5 - i * 3, 2.7 - i * 0.82, 0, 3, 0.35, 6.4); // steps down to the sand
    solid(timber, lib('timber_bare', null, 0x8a6a48));
    solid(white, lib('timber_painted', 0xf2efe6));
    solid(paint, lib('timber_painted', 0xd8cfc0));
  }

  // lifeguard towers every ~230 m on the dry sand, facing the sea, none in the pier's lap
  {
    const posts = [], huts = [], roofs = [];
    for (let t = 115; t < total - 60; t += 230) {
      if (Math.abs(t - pierT) < 70) continue;
      const r = frameAt(t), yaw = seawardYaw(r), [x, z] = at(t, 26);
      const put = (list, du, y, dv, lx, ly, lz) => {
        const g2 = metreUVs(new THREE.BoxGeometry(lx, ly, lz), lx, ly, lz);
        g2.applyMatrix4(M4(x - r.nx * du + r.dx * dv, y, z - r.nz * du + r.dz * dv, 0, yaw, 0, 1, 1, 1));
        list.push(g2);
      };
      for (const a of [-1, 1]) for (const b of [-1, 1]) put(posts, a * 1.2, 1.85, b * 1.2, 0.18, 3.4, 0.18);
      put(huts, 0, 4.75, 0, 3.0, 2.4, 3.0);
      put(roofs, 0, 6.1, 0, 3.7, 0.3, 3.7);
    }
    solid(posts, lib('timber_painted', 0xf2efe6));
    solid(huts, lib('timber_painted', 0xf7f3ea));
    solid(roofs, lib('metal_painted', 0x2f7dc0));
  }

  /* --- the Riviera promenade: the eight authored props (2026-09-14) ---
     These shipped as files and were placed by nothing, which is the same state
     `riviera_promenade_building` sat in. The promenade already exists -- a 10 m
     paved band from DRY+1 to DRY+11 with a palm row up its middle at DRY+6 --
     so the furniture goes on it: balustrade along the seaward lip, lamps and
     planters flanking the palms, cafe terraces set back on the landward side
     where a frontage would be, and the yachts moored out in the bay.

     Everything here is one InstanceBatch, so the whole promenade is a handful
     of draws however many pieces it places. Without a catalogue (the argument
     is optional and main.js passed nothing for a year) this block is skipped
     rather than falling back to boxes -- these are authored assets or nothing. */
  if (catalogue) {
    group.name = 'beach';
    const batch = new InstanceBatch(catalogue);
    const props = new THREE.Group();
    props.name = 'promenade';
    group.add(props);
    // place a prop at arc length t, `off` metres seaward, turned to face the sea
    const put = (name, t, off, turn = 0, sc = 1) => {
      const r = frameAt(t), [x, z] = at(t, off);
      batch.add(name, M4(x, 0.22, z, 0, seawardYaw(r) + turn, 0, sc, sc, sc));
    };

    /* The balustrade is the reason the promenade stops being a paving slab:
       it is the edge you cannot walk off. It tiles at exactly 3 m (cut faces
       verified identical in YZ at x = +/-1.500), so step it at 3 m and the run
       is seamless. Local +X runs along its length, and seawardYaw puts +X on
       the seaward normal, so it needs a quarter turn to lie ALONG the coast. */
    for (let t = 4; t < total - 4; t += 3) put('props/stone_balustrade_section', t, DRY + 1.2, Math.PI / 2);

    // classical lamps down the middle of the band, offset from the palms at DRY+6
    for (let t = 20; t < total - 20; t += 26) put('props/double_lantern_lamp', t, DRY + 3.2);

    // planters between the lamps, alternating side, breaking the long empty band
    for (let t = 33; t < total - 20; t += 26) {
      put('props/planter_trough_flowers', t, DRY + 2.4, Math.PI / 2);
      put('props/planter_trough_flowers', t + 9, DRY + 9.4, Math.PI / 2);
    }

    /* Cafe terraces in CLUSTERS, not a uniform row: three or four sets under
       their own parasols, then a gap. A promenade with evenly spaced furniture
       reads as a car park. Clusters bunch near the pier, which is where a
       seafront actually crowds -- the same rule beach.js already uses for its
       parasols and its crowd. */
    for (let c = 0; c < 14; c++) {
      const base = 40 + c * ((total - 90) / 14) + hash(c, 91) * 12;
      if (Math.abs(base - pierT) < 45) continue;
      const n = 3 + Math.floor(hash(c, 93) * 2);
      for (let i = 0; i < n; i++) {
        const t = base + i * 4.6 + hash(c * 7 + i, 95) * 0.8;
        const off = DRY + 7.6 + (hash(c + i, 97) - 0.5) * 1.6;
        put('props/cafe_terrace_set', t, off, hash(c + i, 99) * 6.28);
        if (i % 2 === 0) put('props/square_cafe_parasol', t + 0.3, off + 0.2, hash(c + i, 101) * 6.28);
      }
    }

    /* --- THE FRONTAGE: a building wall behind the promenade ---
       This is the corniche. There is no seafront road in the district file and
       no block within 300 m of the water, so the buildings stand on the land
       plate directly behind the promenade band (which ends at DRY+11) and face
       the sea. Sea -> balustrade -> furniture -> frontage is the whole
       composition; without the wall the promenade is a path in a field.

       FOUR OF THE FIVE ARE FACADE CARDS, measured: at mid-height their geometry
       spans 0.3-0.4 m of a declared 14-16 m depth and NOTHING sits on the back
       third. Only riviera_corner_hotel is solid (14.3 m of 18, 96 verts behind).
       So each card gets a plaster body built behind it here -- the same trick
       landmarks.js:assembleTenement uses for the Poly Haven tenement kit, which
       is also a facade with no building attached. Without it you see paper from
       any angle off the normal. */
    const FRONT = [
      // asset,                              w,    d,    solid
      ['buildings/riviera_corner_hotel',     14.0, 18.0, true],
      ['buildings/boutique_townhouse',        9.0, 14.0, false],
      ['buildings/luxury_promenade_building', 11.0, 16.0, false],
      ['buildings/belle_epoque_mansard',     10.0, 15.0, false],
      ['buildings/boutique_townhouse',        9.0, 14.0, false],
      ['buildings/cafe_arcade_building',     12.0, 16.0, false],
    ];
    const SET_BACK = DRY + 13;          // 2 m clear of the promenade's landward kerb
    const bodies = [];
    {
      let t = 30, i = 0;
      while (t < total - 40) {
        const [asset, w, d, isSolid] = FRONT[i % FRONT.length];
        // a gap every few plots: a seafront is not one continuous block, and the
        // gaps are where the sea shows through from the road behind
        if (hash(i, 131) < 0.16) { t += 9 + hash(i, 133) * 7; i++; continue; }
        const r = frameAt(t + w / 2), [x, z] = at(t + w / 2, SET_BACK);
        /* rotY(yaw) sends local +Z to (sin, cos). seawardYaw puts local +X on
           the seaward normal, so +PI/2 puts local +Z there instead -- which is
           the face these assets are modelled on (their ground floors sit at
           max +Z). Same turn the balustrade uses, one axis over. */
        const yaw = seawardYaw(r) + Math.PI / 2;
        batch.add(asset, M4(x, 0.22, z, 0, yaw, 0, 1, 1, 1));
        if (!isSolid) {
          /* The body: a plain block filling the depth the facade only claims.
             Held 0.15 m narrower so it never pokes through the facade's own
             reveals, and stopped 1.5 m short of the front so the card's window
             recesses still read. */
          const g = new THREE.BoxGeometry(w - 0.3, 17.0, d - 2.0);
          g.applyMatrix4(M4(x, 0.22 + 8.5, z, 0, yaw, 0, 1, 1, 1));
          g.translate(-Math.sin(yaw) * 1.5, 0, -Math.cos(yaw) * 1.5);
          bodies.push(g);
        }
        t += w + 0.6 + hash(i, 137) * 1.2;
        i++;
      }
      solid(bodies, lib('plaster_worn', 0xbfb4a4));
    }

    /* Yachts moored off the shore. The asset's origin is its WATERLINE, so it
       sits at water.js's plane (WATER_TOP) and not on the sand -- putting it at
       y = 0 would beach every boat in the bay. */
    for (let c = 0; c < 7; c++) {
      const t = 60 + c * ((total - 120) / 7) + hash(c, 103) * 30;
      if (Math.abs(t - pierT) < 60) continue;
      const r = frameAt(t), [x, z] = at(t, -(120 + hash(c, 105) * 190));
      batch.add('props/moored_motor_yacht',
        M4(x, WATER_TOP, z, 0, seawardYaw(r) + Math.PI / 2 + (hash(c, 107) - 0.5) * 0.5, 0, 1, 1, 1));
    }

    batch.emit(props, { lod: 0 }).then(() => {
      /* NOT frustumCulled = false: this group is not a render bundle, so culling is
         free, and the flag also defeated the shadow cameras' culling -- 613k tris of
         balustrade were cast into the cascades from 1.3 km away (census 2026-09-22). */
      props.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.geometry?.computeBoundingSphere?.(); } });
    });
  }

  /* --- the crowd --- */
  const SKIN = [0xf0c8a0, 0xd9a173, 0xa8724a, 0x7a4f33, 0x5a3a26];
  const WEAR = [0x2f6dff, 0xe8503c, 0xf0b429, 0xffffff, 0x35b57a, 0xd63cff, 0x1f2a36];
  const people = [];
  for (let i = 0; i < CROWD; i++) {
    // two in five set up within 80 m of the pier -- that is where a beach crowds
    const t = i % 5 < 2 ? Math.max(0, Math.min(total, pierT + (hash(i, 3) - 0.5) * 160)) : hash(i, 3) * total;
    // most on the dry sand, some paddling in the shallows
    const across = hash(i, 5) < 0.24 ? -4 - hash(i, 11) * 9 : 3 + hash(i, 11) * (DRY - 12);
    const [x, z] = at(t, across);
    people.push({
      x, z, y: across < 0 ? -1.0 : 0,
      home: [x, z], heading: hash(i, 17) * 6.28,
      speed: hash(i, 41) < 0.45 ? 0 : 0.5 + hash(i, 43) * 0.9,
      phase: hash(i, 47) * 6.28,
    });
  }
  const fleet = new FigureFleet(group, CROWD, { shadows: true });
  people.forEach((_, i) => fleet.colour(i, WEAR[i % WEAR.length], SKIN[(i * 7) % SKIN.length]));
  fleet.flush();

  scene.add(group);
  let clock = 0;
  return {
    group,
    update(dt) {
      clock += dt;
      // waves run along the beach, and the whole wash breathes up and back
      surfTex.offset.x = clock * 0.028;
      surfTex.offset.y = -0.16 + Math.sin(clock * 0.55) * 0.14;
      surfMat.opacity = 0.78 + Math.sin(clock * 0.55 + 1.1) * 0.2;
      for (let i = 0; i < CROWD; i++) {
        const p = people[i];
        if (p.speed) {
          // wander, but never far from where they set their towel down
          p.heading += Math.sin(clock * 0.4 + p.phase) * dt * 0.9;
          p.x += Math.cos(p.heading) * p.speed * dt;
          p.z += Math.sin(p.heading) * p.speed * dt;
          const dx = p.x - p.home[0], dz = p.z - p.home[1];
          if (dx * dx + dz * dz > 400) p.heading = Math.atan2(-dz, -dx);
        }
        p.phase += (p.speed || 0.55) * dt * 2.6;
        fleet.write(i, p.x, p.y + FOOT_DROP, p.z, -p.heading, p.phase, p.speed > 0.15 ? 1 : 0, 1);   // they walk (cos h, sin h); the fleet faces (cos yaw, -sin yaw)
      }
      fleet.flush();
    },
  };
}

/** Legs, torso, arms. Roughly 1.7m, roughly 90 triangles, no face. */
export function personGeometry() {
  const parts = [];
  for (const side of [-0.09, 0.09]) {
    const leg = new THREE.CylinderGeometry(0.055, 0.048, 0.82, 5);
    leg.applyMatrix4(M4(0, 0.41, side));
    parts.push(leg);
    const arm = new THREE.CylinderGeometry(0.042, 0.038, 0.62, 5);
    arm.applyMatrix4(M4(0, 1.08, side * 2.2, 0, 0, side * 1.6));
    parts.push(arm);
  }
  const torso = new THREE.CylinderGeometry(0.15, 0.13, 0.62, 7);
  torso.applyMatrix4(M4(0, 1.13, 0));
  parts.push(torso);
  const neck = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 5);
  neck.applyMatrix4(M4(0, 1.47, 0));
  parts.push(neck);
  return mergeGeos(parts);
}

/** Sand: grain, plus the wind ripples that stop it reading as brown paper. */
function sandTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#dcc99a';
  g.fillRect(0, 0, S, S);
  // ripples first, so the grain sits on top of them
  g.globalAlpha = 0.5;
  for (let i = 0; i < 34; i++) {
    g.strokeStyle = i % 2 ? '#c9b184' : '#eadcb4';
    g.lineWidth = 1.6 + Math.random() * 2.4;
    g.beginPath();
    const y = (i / 34) * S + Math.random() * 4;
    g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 14,
                    S * 0.7, y + (Math.random() - 0.5) * 14, S, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 6000; i++) {
    const v = 150 + Math.random() * 90 | 0;
    g.fillStyle = `rgba(${v + 30},${v + 8},${v - 34},0.42)`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.3, 1.3);
  }
  // scattered shells and pebbles
  for (let i = 0; i < 90; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(245,238,225,0.7)' : 'rgba(140,124,100,0.6)';
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 1.4 + Math.random() * 2.2,
              1 + Math.random() * 1.4, Math.random() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Foam: broken bands of white with a soft seaward edge. */
function foamTexture() {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  for (let band = 0; band < 3; band++) {
    const cy = H * (0.28 + band * 0.24);
    for (let x = 0; x < W; x += 3) {
      const wob = Math.sin(x * 0.05 + band * 2.1) * 9 + Math.sin(x * 0.017) * 14;
      const th = 6 + Math.sin(x * 0.09 + band) * 4;
      const a = 0.5 - band * 0.13;
      const grad = g.createLinearGradient(0, cy + wob - th, 0, cy + wob + th);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x, cy + wob - th, 4, th * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;      // the wash cycles, so V must repeat
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
