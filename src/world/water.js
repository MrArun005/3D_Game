// Water shading ported from StarKnightt/ocean-drive (MIT, (c) 2026 Prasenjit) -- see THIRD_PARTY.md.
import * as THREE from 'three';
import {
  positionWorld, abs, max, min, mix, vec2, vec3, float, smoothstep, step, texture, attribute, uniform, time,
  cameraPosition, length, normalize, reflect, dot, pow, sin, clamp, uv, exp, fract, vec4, mrt, pmremTexture,
} from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toTex } from './textures.js';
import { mulberry32 } from '../core/rng.js';
import { buildSpan, signatureBridge } from './spans.js';

/**
 * The bay, the river, and the ten bridges that cross them.
 *
 * The planner has always carried this data -- Halstead Bay is a harbour city
 * and the whole east side of the map is open water -- but the 3D world was
 * rendering it as green field. Water is cut out of the ground plate rather
 * than laid on top of it, so the bank is a real edge with a drop behind it
 * instead of a blue rectangle painted on a lawn.
 */

const WATER_Y = -2.6;              // deep enough to read as a drop from the quay

/** A centreline of `width` turned into a closed polygon, one side then back. */
function ribbonPolygon(points, width) {
  const half = width / 2;
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * half, nz = (dx / L) * half;
    left.push([points[i][0] + nx, points[i][1] + nz]);
    right.push([points[i][0] - nx, points[i][1] - nz]);
  }
  return left.concat(right.reverse());
}

/* Shapes are authored in XY and laid down with rotateX(-90deg), which maps
   shape-Y to world -Z and leaves the face normal pointing up. Negating z here
   is what keeps the map the right way round after that rotation -- with a +90
   rotation instead, every surface faces into the ground and vanishes. */
const toV2 = (pts) => pts.map(([x, z]) => new THREE.Vector2(x, -z));

/** Signed area; ShapeGeometry wants holes wound against their outline. */
function area(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return a / 2;
}

function flatten(shape, y) {
  const g = new THREE.ShapeGeometry(shape, 6);
  g.rotateX(-Math.PI / 2);         // shape XY -> world XZ, facing up
  g.translate(0, y, 0);
  return g;
}

function buildRiverGeometry(points, width, y) {
  const half = width / 2;
  const pos = [];
  const uvs = [];
  const indices = [];

  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * half, nz = (dx / L) * half;

    if (i > 0) {
      dist += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }

    // Left vertex (along +nx, +nz)
    pos.push(points[i][0] + nx, y, points[i][1] + nz);
    uvs.push((points[i][0] + nx) / 15, (points[i][1] + nz) / 15);

    // Right vertex (along -nx, -nz)
    pos.push(points[i][0] - nx, y, points[i][1] - nz);
    uvs.push((points[i][0] - nx) / 15, (points[i][1] - nz) / 15);

    if (i < points.length - 1) {
      const base = i * 2;
      // Winding for +Y upward normal:
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // 0 on one bank, 1 on the other: the water shader reads metres-from-bank off it
  geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 ? null : (k / 3) % 2)).filter((x) => x !== null), 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildWater(scene, district, day = true, { pave = null } = {}) {
  const group = new THREE.Group();
  group.name = 'water_system';
  const D = district.data;
  const bay = toV2(D.water.bay);
  const river = toV2(ribbonPolygon(D.water.river.points, D.water.river.width));
  const quayY = -0.06;

  /* --- the ground, with the water cut out of it --- */
  const b = district.bounds;
  const pad = 1000;                 // meets the mountain apron with room to spare
  /* The east edge of the land is the coast, not the padding. Halstead Bay is
     on an ocean; running the ground plate 1000m past the map on that side is
     what turned the sea into a lake with a mountain behind it. */
  const outline = new THREE.Shape(toV2([
    [-pad, -pad], [b.w + 30, -pad], [b.w + 30, b.h + pad], [-pad, b.h + pad],
  ]));
  const outerSign = Math.sign(area(outline.getPoints(1)));
  for (const hole of [bay, river]) {
    const h = area(hole) * outerSign > 0 ? hole.slice().reverse() : hole;
    outline.holes.push(new THREE.Path(h));
  }
  /* City ground is PAVING, country ground is field (2026-09-25). The plate
     was olive (0x59614a) everywhere, so wherever a block slab stops short of
     the pavement -- Regent Street at its real 18 m and the side streets
     narrowed to 11 m left strips by every frontage -- the city showed a grass
     verge in front of its shops. Inside the district bounds the plate is
     concrete grey; it fades back to field over 60 m past the edge, where the
     fence and the open ground begin. One mix a pixel on a surface that
     already draws; no draws, no triangles. */
  const landMat = THREE.MeshLambertNodeMaterial ? new THREE.MeshLambertNodeMaterial() : new THREE.MeshLambertMaterial();
  const field = new THREE.Color(day ? 0x59614a : 0x11161c), paving = new THREE.Color(day ? 0x7a7b7d : 0x14171c);
  if (landMat.isNodeMaterial) {
    const p = positionWorld.xz;
    const outside = max(max(p.x.negate(), p.x.sub(b.w)), max(p.y.negate(), p.y.sub(b.h)));   // metres past the district rectangle, <= 0 inside
    /* With the pavement's own slab texture (main.js passes walkDistrict's map)
       in world metres at the pavement's 2.4 m tile, a gap reads as more
       pavement rather than as a flat smear; one texture sample a pixel. */
    const city = pave ? texture(pave, p.div(2.4)).rgb : vec3(paving.r, paving.g, paving.b);
    landMat.colorNode = mix(city, vec3(field.r, field.g, field.b), smoothstep(0, 60, outside));
  } else landMat.color.copy(field);
  const land = new THREE.Mesh(flatten(outline, -0.06), landMat);
  land.name = 'ground_water_cutout';
  land.receiveShadow = true;
  land.frustumCulled = false;
  group.add(land);

  /* --- the water itself (2026-09-28, TSL rewrite) ---
     ONE opaque node material per water type, no second translucent sheet:
       - colour by DEPTH, read as distance from the nearest bank (the plan has
         no bathymetry; a harbour and a dredged river shelve fast, so metres
         from the wall is the honest proxy): a grey-green river, a darker
         slate harbour, a jade shelf only where the sand of Halstead Sands runs
         under it;
       - the swell is two tiled wave-normal maps sampled in WORLD metres and
         scrolled by the `time` node -- no CPU work a frame, no displacement --
         flattened with distance so the far water turns into a mirror instead
         of aliasing to grey;
       - Fresnel sky reflection is the standard BRDF against scene.environment
         (roughness 0.06): dark looking down, the sky at a grazing angle;
       - a sun GLITTER path: a sharp reflection lobe toward the live sun,
         broken into glints by a fine third sample, written as emissive so it
         blooms (the sun direction is read off the scene's DirectionalLight in
         update(), one Vector3 copy a frame);
       - foam: a lap band at every quay wall and bank, breathing with time,
         and on the bay, breakers rolling in over the beach shelf.
     Draws: river 1, bay + ocean 1 (merged), pier foam 1 = 3 (was 6: every body
     drew twice, once for the transparent swell sheet). Per pixel: 4 texture
     samples (2 swell, 1 glint, 1 foam; +1 shore field on the bay) and a
     pow(), on a surface that already drew; the old path was 2 lit layers
     with blending, so fill cost is about level. */
  const nrm = toTex(waveNormals(), false);
  const nrm2 = toTex(waveNormals(true), false);
  const foamT = toTex(foamCanvas(), false);
  const sunDir = uniform(new THREE.Vector3(-0.55, 0.72, 0.35).normalize());
  const sunCol = uniform(new THREE.Color(day ? 3.4 : 0.3, day ? 3.2 : 0.3, day ? 3.0 : 0.36));   // the sun light's colour x intensity, from update()
  const envI = uniform(scene.environmentIntensity ?? 0.85);
  const U = { nrm, nrm2, foamT, sunDir, sunCol, envI, env: scene.environment };

  const ocean = toV2([
    [b.w + 20, -pad - 3000], [b.w + 11000, -pad - 3000],
    [b.w + 11000, b.h + pad + 3000], [b.w + 20, b.h + pad + 3000],
  ]);

  /* The bay's shore field: metres to the nearest coast (R) and to the nearest
     BEACH edge (G), baked once into a small texture over the bay. The
     classification is beach.js's: diagonal bay edges outside Harbour Point
     are sand, the one inside is the port's quay wall. */
  const shoreF = bayShoreField(D, b);
  const riverW = D.water.river?.width ?? 100;
  const fieldUv = () => vec2(positionWorld.x.sub(shoreF.x0).div(shoreF.w), positionWorld.z.sub(shoreF.z0).div(shoreF.h));
  const inField = (u) => step(0, u.x).mul(step(u.x, 1)).mul(step(0, u.y)).mul(step(u.y, 1));

  const riverMat = waterMaterial({
    ...U,
    shore: () => { const a = attribute('aAcross', 'float'); return min(a, float(1).sub(a)).mul(riverW); },
    beach: null,
    shallow: 0x44604c, deep: 0x1c342e, depthM: 30,   // the river keeps its green
    flow: vec2(0.0, 0.012),
  });
  const bayMat = waterMaterial({
    ...U,
    shore: () => {
      const u = fieldUv();
      const openSea = max(positionWorld.x.sub(b.w + 30), 0);   // off the field, the ocean's only coast is the plate's east edge
      return mix(openSea, texture(shoreF.tex, u).r.mul(SHORE_RANGE), inField(u));
    },
    beach: () => {
      const u = fieldUv();
      return mix(float(SHORE_RANGE), texture(shoreF.tex, u).g.mul(SHORE_RANGE), inField(u));
    },
    shallow: 0x2a6f68, deep: 0x0c1c26, depthM: 60,   // ocean-drive's turquoise-to-slate ramp, greyed for a harbour
    flow: vec2(-0.004, 0.002),
  });

  {
    const g = mergeGeometries([flatten(new THREE.Shape(bay), WATER_Y), flatten(new THREE.Shape(ocean), WATER_Y)]);
    const m = new THREE.Mesh(g, bayMat);
    m.name = 'water_bay_ocean_surface';
    m.frustumCulled = false;
    m.receiveShadow = true;
    group.add(m);
  }

  // The River: built as a contiguous quad-strip ribbon so winding river curves
  // never suffer chord clipping or degenerate triangulation from 2D polygon planar cuts.
  if (D.water.river?.points?.length) {
    const riverGeo = buildRiverGeometry(D.water.river.points, D.water.river.width, WATER_Y);
    const riverA = new THREE.Mesh(riverGeo, riverMat);
    riverA.name = 'water_river_surface';
    riverA.frustumCulled = false;
    riverA.receiveShadow = true;
    group.add(riverA);
  }

  /* --- foam round the bridge piers: one instanced quad per column, a ring
     that frays with time. The pier sites are world/spans.js's own (the same
     seeded placement the chunk builder uses), asked once here with the
     geometry thrown away at once. --- */
  /* The spans are built (~5 ms each, ~40 over water) and thrown away, so the
     job is sliced: ~2 ms of it a frame from update(), not 200 ms at boot. The
     mesh exists from the start at a fixed capacity with one zero-size
     instance, so the boot warm-up compiles it and no pipeline is built
     mid-game; the count grows as columns land. */
  const PIER_CAP = 192;
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2);
  const pierFoam = new THREE.InstancedMesh(quad, pierFoamMaterial(foamT), PIER_CAP);
  const m4 = new THREE.Matrix4();
  pierFoam.setMatrixAt(0, m4.makeScale(0, 0, 0));
  pierFoam.count = 1;
  pierFoam.name = 'water_pier_foam';
  pierFoam.frustumCulled = false;
  pierFoam.renderOrder = 2;
  group.add(pierFoam);
  let pierJob = pierColumns(district);
  let piers = 0;

  /* --- bridges --- nothing here any more (2026-09-25). This block predated
     world/spans.js (piers, soffit, fascia per road segment) and
     world/liftBridge.js (the signature bridge, whole) and put a SECOND set of
     piers and a slab at a fixed 7.6 m under every bridge. Once the river
     bridges became arches with a 3.3-4.1 m crown (district.js) that slab
     stood 3-4 m ABOVE their decks. Two instanced draws fewer. */

  scene.add(group);

  let sun = null, looked = 0;
  const v = new THREE.Vector3();
  return {
    group,
    get piers() { return piers; },
    update() {
      if (pierJob) {
        const t0 = performance.now();
        while (pierJob && performance.now() - t0 < 2) {
          const r = pierJob.next();
          if (r.done) { pierJob = null; break; }
          for (const c of r.value) {
            if (piers >= PIER_CAP) break;
            const k = (c.r + 3.2) * 2;
            pierFoam.setMatrixAt(piers++, m4.makeScale(k, 1, k).setPosition(c.x, WATER_Y + 0.04, c.z));
          }
          if (piers) { pierFoam.count = piers; pierFoam.instanceMatrix.needsUpdate = true; }
        }
      }
      /* The sun: the scene's shadow-casting DirectionalLight (renderer.js owns
         it, clock.js moves it). Looked up once, retried every ~2 s until found. */
      if (!sun && looked-- <= 0) {
        looked = 120;
        scene.traverse((o) => { if (!sun && o.isDirectionalLight && o.castShadow) sun = o; });
        if (!sun) scene.traverse((o) => { if (!sun && o.isDirectionalLight) sun = o; });
      }
      if (sun) {
        v.copy(sun.position).sub(sun.target.position);
        if (v.lengthSq() > 1e-6) sunDir.value.copy(v.normalize());
        // a low or dim sun (dusk, the moon) glints less; below the horizon, not at all
        sunCol.value.copy(sun.color).multiplyScalar(sun.intensity * THREE.MathUtils.smoothstep(sunDir.value.y, -0.02, 0.1));
      }
      envI.value = scene.environmentIntensity ?? 0.85;
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose?.(); });
      for (const m of [riverMat, bayMat, pierFoam.material, landMat]) m?.dispose?.();
      for (const t of [nrm, nrm2, foamT, shoreF.tex]) t.dispose();
      pierFoam.dispose();
      scene.remove(group);
    },
  };
}

const SHORE_RANGE = 80;            // metres the shore field encodes (8 bits: 0.31 m a step)

/**
 * The water node material -- a TSL port of the ocean shading in
 * StarKnightt/ocean-drive (MIT, (c) 2026 Prasenjit; src/world/ocean.js and
 * surf.js; see THIRD_PARTY.md). What came across: the lifted-reflection
 * Fresnel (the reflected ray is folded above the horizon and widened by the
 * slope variance the pixel cannot resolve, so it never samples the dark
 * ground -- the black-speckle bug of the first version), the depth colour
 * ramp, the Beckmann sun-glitter lobe broken into glints, the lit foam, and
 * the swash timing (fast ease-out run-up, slow recede) for the breakers.
 * What is ours: it runs as a MeshBasicNodeMaterial over flat polygons (no
 * camera-centred grid, no Gerstner displacement, no ShaderMaterial), the sky
 * is scene.environment's PMREM instead of their analytic sky, depth is metres
 * from the bank, and the breakers are keyed to beach distance.
 *
 * `shore()` returns metres to the nearest bank for this fragment; `beach()`
 * (optional) metres to the nearest sand edge.
 */
function waterMaterial({ nrm, nrm2, foamT, sunDir, sunCol, envI, env, shore, beach, shallow, deep, depthM, flow }) {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'water';
  const p = positionWorld.xz;
  const toCam = cameraPosition.sub(positionWorld);
  const dist = length(toCam);
  const V = normalize(toCam);
  const d = shore();
  const t = time;
  const L = sunDir;

  // --- slopes: two crossing wave-normal layers in world metres, drifting with the current
  const A = texture(nrm, p.div(19).add(vec2(0.021, 0.033).add(flow).mul(t))).xy.mul(2).sub(1);
  const B = texture(nrm2, p.div(7.5).add(vec2(-0.029, 0.013).add(flow.mul(2)).mul(t))).xy.mul(2).sub(1);
  const calm = float(1).div(dist.mul(0.004).add(1));                  // what the pixel still resolves
  const nearBank = smoothstep(0, 10, d).mul(0.6).add(0.4);             // the lee of a wall is calmer
  const s = A.mul(0.5).add(B.mul(0.32)).mul(calm).mul(nearBank);
  // slope variance lost below the pixel (ocean-drive's `lost`): grows as the resolved part shrinks
  const lost = float(1).sub(calm).mul(0.018).mul(nearBank).add(0.0004);
  const sig = lost.sqrt();
  const n = normalize(vec3(s.x.negate(), 1, s.y.negate()));
  const nv = max(dot(n, V), 0.002);

  // --- reflection: the ray folded above the horizon and widened by sig (two taps)
  const R = reflect(V.negate(), n);
  const gz = float(1).sub(smoothstep(0.02, 0.35, V.y));
  const Ra = normalize(vec3(R.x, abs(R.y).add(gz.mul(1.6).add(1.2).mul(sig)).add(0.004), R.z));
  const Rb = normalize(vec3(R.x, abs(R.y).add(gz.mul(2.8).add(2.2).mul(sig)).add(0.004), R.z));
  const skyAt = (dir, rough) => (env ? pmremTexture(env, dir, float(rough)).rgb.mul(envI) : vec3(0.35, 0.45, 0.6).mul(envI));
  const sky = skyAt(Ra, 0.04).add(skyAt(Rb, 0.2)).mul(0.5);
  const F = float(0.02).add(pow(float(1).sub(clamp(nv.add(gz.mul(1.2).add(1).mul(sig)), 0, 1)), 5).mul(0.98));

  // --- the water body: the ramp as a scattering albedo under the sky and the sun
  const skyUp = skyAt(vec3(0, 1, 0), 1.0);
  const ambient = skyUp.add(sunCol.mul(max(L.y, 0)).mul(0.12));
  let ramp = mix(hexVec(shallow), hexVec(deep), smoothstep(0, depthM, d));
  if (beach) {
    // the sand shelf off Halstead Sands (beach.js: the sand leaves the water ~28 m out, its toe is at 34 m)
    ramp = mix(ramp, hexVec(0x2f8f86), float(1).sub(smoothstep(27, 60, beach())).mul(0.8));
  }
  let col = ramp.mul(ambient).mul(float(1).sub(F)).add(sky.mul(F));

  // --- sun glitter: Beckmann lobe whose roughness is the unresolved slope, broken into glints
  const H = normalize(L.add(V));
  const nh = max(dot(n, H), 1e-4), nh2 = nh.mul(nh);
  const m2 = lost.mul(0.6).add(0.0034).add(pow(float(1).sub(nv), 8).mul(0.003)).add(smoothstep(10, 500, dist).mul(0.009)).mul(2);
  const Dn = min(exp(float(1).sub(nh2).negate().div(nh2.mul(m2))).div(m2.mul(Math.PI).mul(nh2).mul(nh2)), 3000);
  const Fh = float(0.02).add(pow(float(1).sub(max(dot(H, V), 0)), 5).mul(0.98));
  let spec = sunCol.mul(Dn).mul(Fh).div(nv.mul(4)).mul(smoothstep(-0.06, 0.06, dot(n, L))).mul(vec3(1.0, 0.8, 0.55));
  const g1 = texture(nrm2, p.div(1.7).sub(vec2(0.05, 0.08).mul(t))).x;
  const g2 = texture(nrm, p.div(0.9).add(vec2(0.07, -0.03).mul(t))).y;
  const glint = smoothstep(0.3, 0.75, g1.mul(g2).mul(1.8));
  spec = spec.mul(glint.mul(3.0).add(0.15));
  spec = spec.div(dot(spec, vec3(0.2126, 0.7152, 0.0722)).div(3.0).add(1));   // soft-clip, keeps the path from blowing out

  // --- foam
  const drift = vec2(0.013, -0.009).add(flow).mul(t);
  const lace = texture(foamT, p.div(6.5).add(drift)).r;
  const lapW = sin(t.mul(0.8).add(p.x.mul(0.043)).add(p.y.mul(0.061))).mul(0.9).add(2.6);
  let foam = float(1).sub(smoothstep(0.3, lapW, d)).mul(smoothstep(0.35, 0.7, lace).mul(0.7).add(0.3));
  if (beach) {
    const bd = beach();
    /* Breakers (ocean-drive surf.js's clock, driven by beach distance): each set
       rolls in from ~70 m to the waterline at 28 m. The front moves with a fast
       ease-out (run-up), then the wash recedes slowly (pow 1.4); a roller sits
       on the front, a bore of dissolving foam behind it. */
    const T = 9.5;
    const along = p.x.mul(0.011).add(p.y.mul(0.007));                  // sets arrive a little out of phase along the shore
    const u = fract(t.div(T).add(sin(along).mul(0.08)));
    const up = smoothstep(0, 0.45, u);
    const run = float(1).sub(float(1).sub(up).mul(float(1).sub(up)));   // 1-(1-u)^2
    const front = float(70).sub(run.mul(42)).add(sin(along.mul(9).add(u.mul(3))).mul(1.2));
    const fresh = float(1).sub(smoothstep(0.45, 1.0, u).pow(1.4));
    const behind = bd.sub(front);
    const lead = step(-0.1, behind);
    const roller = exp(max(behind, 0).negate().div(0.9)).mul(lead).mul(fresh);
    const bore = exp(max(behind, 0).negate().div(run.mul(3).add(1.5))).mul(lead).mul(fresh).mul(lace);
    const surfZone = smoothstep(27, 29, bd).mul(float(1).sub(smoothstep(62, 75, bd)));
    foam = max(foam, max(roller.mul(mix(0.55, 0.95, lace)), bore).mul(surfZone));
    // the thin line where the water meets the sand, and streaks over the surf zone
    foam = max(foam, float(1).sub(smoothstep(27.5, 30, bd)).mul(lace).mul(0.8));
    foam = max(foam, surfZone.mul(smoothstep(0.55, 0.8, texture(foamT, p.div(17).add(vec2(0, 0.01).mul(t))).r)).mul(0.3));
  }
  // sparse whitecaps far out on open water
  const cap = smoothstep(0.62, 0.8, texture(foamT, p.div(41).add(vec2(0.004, 0).mul(t))).r).mul(smoothstep(0.5, 0.75, lace));
  foam = max(foam, cap.mul(smoothstep(80, 160, d)).mul(0.5).mul(float(1).sub(smoothstep(200, 1500, dist))));
  foam = clamp(foam, 0, 1);

  // lit foam: sun on all-facing bubbles + sky fill, taken as luminance so it stays cream-white
  const toSun = max(dot(V.negate(), L), 0);
  const foamL = dot(sunCol.mul(0.318).mul(toSun.mul(0.35).add(0.3)).add(skyUp.mul(1.1)), vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(1.0, 0.97, 0.92).mul(0.8).mul(foamL), foam);
  spec = spec.mul(float(1).sub(foam));

  mat.colorNode = col.add(spec);
  // the glitter feeds the bloom (grade.js reads the emissive MRT target)
  mat.mrtNode = mrt({ emissive: vec4(spec.mul(0.5), 1) });
  return mat;
}

/** Foam ring round a pier column: quad uv 0..1, a frayed ring that pulses outward. */
function pierFoamMaterial(foamT) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.name = 'water_pier_foam';
  const c = uv().sub(0.5).mul(2);
  const r = length(c);
  const n = texture(foamT, positionWorld.xz.div(4.5).add(vec2(0.02, -0.015).mul(time))).r;
  const ring = float(1).sub(smoothstep(0.35, 0.95, r.add(sin(time.mul(1.4).add(r.mul(9))).mul(0.04))));
  mat.colorNode = vec3(0.82, 0.85, 0.86);
  mat.opacityNode = ring.mul(smoothstep(0.3, 0.7, n)).mul(0.85);
  return mat;
}

const hexVec = (h) => { const c = new THREE.Color(h); return vec3(c.r, c.g, c.b); };

/**
 * Every pier column standing in open water, from world/spans.js's own seeded
 * placement. A generator: each step yields the columns ([{x, z, r}]) of one
 * span over water, so a caller can slice the work across frames.
 */
export function* pierColumns(district) {
  if (!district?.segments || !district.inOpenWater) return;
  for (const s of district.segments) {
    const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
    if (!district.inOpenWater(mx, mz) && !district.inOpenWater(s.ax, s.az) && !district.inOpenWater(s.bx, s.bz)) continue;
    let sp;
    try { if (signatureBridge(s, district)) continue; sp = buildSpan(s, district); } catch { continue; }
    for (const p of sp.parts) p.geo?.dispose?.();
    const out = [];
    for (const pr of sp.piers) for (const [x, z] of pr.cols || [[pr.x, pr.z]]) {
      if (district.inOpenWater(x, z)) out.push({ x, z, r: pr.colR ?? 1.5 });
    }
    yield out;
  }
}

/** Distance from (px,pz) to the segment a-b. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * k, pz - az - dz * k);
}

/**
 * The bay's coast, classified the way beach.js lays its sand: returns
 * { coast: [[a,b]...], beach: [[a,b]...] }. The vertical edge on the east
 * map border is open sea, not shore.
 */
export function bayCoast(D, bounds) {
  const bay = D.water.bay, coast = [], beach = [];
  const hp = (D.districts || []).find((d) => /HARBOUR/i.test(d.name || ''));
  const inDocks = (x, z) => {
    const poly = hp?.boundary; if (!poly) return false;
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) ins = !ins;
    }
    return ins;
  };
  for (let i = 0; i < bay.length; i++) {
    const a = bay[i], b = bay[(i + 1) % bay.length];
    if (Math.abs(a[0] - b[0]) < 1 && a[0] >= bounds.w) continue;          // the east border: open sea
    coast.push([a, b]);
    const diag = Math.abs(a[0] - b[0]) >= 1 && Math.abs(a[1] - b[1]) >= 1;
    if (diag && !inDocks((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) beach.push([a, b]);
  }
  // the land plate's east edge is the ocean's coast north and south of the bay
  coast.push([[bounds.w + 30, -5000], [bounds.w + 30, 1900]], [[bounds.w + 30, 3060], [bounds.w + 30, 8000]]);
  return { coast, beach };
}

function bayShoreField(D, bounds) {
  const xs = D.water.bay.map((p) => p[0]), zs = D.water.bay.map((p) => p[1]);
  const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60, z0 = Math.min(...zs) - 60, z1 = Math.max(...zs) + 60;
  const W = 384, H = Math.max(64, Math.round(W * (z1 - z0) / (x1 - x0)));
  const { coast, beach } = bayCoast(D, bounds);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const near = (segs, x, z) => { let m = Infinity; for (const [a, b] of segs) m = Math.min(m, segDist(x, z, a[0], a[1], b[0], b[1])); return m; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + ((i + 0.5) / W) * (x1 - x0), z = z0 + ((j + 0.5) / H) * (z1 - z0);
    const k = (j * W + i) * 4;
    img.data[k] = Math.min(255, (near(coast, x, z) / SHORE_RANGE) * 255);
    img.data[k + 1] = Math.min(255, (near(beach, x, z) / SHORE_RANGE) * 255);
    img.data[k + 2] = 0; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  /* Through toTex (anisotropy, colour space), then clamped -- the field is
     not a tile -- and flipY off, so canvas row j is v = (z - z0) / h. */
  const tex = toTex(c, false);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return { tex, x0, z0, w: x1 - x0, h: z1 - z0 };
}

/** Seeded foam blotches: a tiling mask of soft cells. */
function foamCanvas() {
  const S = 256, rnd = mulberry32(0xf0a3);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let n = 0; n < 260; n++) {
    const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 14, a = 0.25 + rnd() * 0.5;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {    // wrapped, so it tiles
      if (x + ox + r < 0 || x + ox - r > S || y + oy + r < 0 || y + oy - r > S) continue;
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  }
  return c;
}

/** Overlapping sine lobes baked into a tangent-space normal map (a canvas; toTex makes the texture). */
function waveNormals(cross = false) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const k = cross ? 1.7 : 1.0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      // height field, then its analytic gradient -> normal
      const dx = 0.5 * Math.cos(u * 2 * k) + 0.28 * Math.cos(u * 5 - v * 3)
               + 0.16 * Math.cos(u * 9 + v * 7);
      const dz = 0.42 * Math.cos(v * 3 * k) - 0.28 * Math.cos(u * 5 - v * 3) * 0.6
               + 0.16 * Math.cos(u * 9 + v * 7);
      const nx = -dx * 0.34, nz = -dz * 0.34;
      const len = Math.hypot(nx, nz, 1);
      const i = (y * S + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
