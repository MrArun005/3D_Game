import * as THREE from 'three';
import { positionWorld, max, mix, vec3, smoothstep, texture } from 'three/tsl';

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

  /* --- the water itself ---
     The surface stays geometrically flat: the bay is one polygon and there is
     no tessellation to displace. The motion comes from two normal maps
     scrolling across each other at different speeds and angles, which is what
     gives a still plane a moving swell under a specular highlight. */
  const nrm = waveNormals();
  const nrm2 = waveNormals(true);
  const mat = new THREE.MeshStandardMaterial({
    color: day ? 0x0e3d59 : 0x0d1a26,
    roughness: 0.3, metalness: 0.1, envMapIntensity: day ? 0.4 : 0.9,
    normalMap: nrm, normalScale: new THREE.Vector2(2.2, 2.2),
  });
  // second layer as a translucent sheet, so the two swells cross
  const mat2 = new THREE.MeshStandardMaterial({
    color: day ? 0x1a5c7d : 0x102232,
    roughness: 0.2, metalness: 0.15, envMapIntensity: day ? 0.5 : 0.9,
    normalMap: nrm2, normalScale: new THREE.Vector2(1.8, 1.8),
    transparent: true, opacity: 0.3, depthWrite: false,
  });
  // open ocean: from the coast out past anything the camera can reach
  const ocean = toV2([
    [b.w + 20, -pad - 3000], [b.w + 11000, -pad - 3000],
    [b.w + 11000, b.h + pad + 3000], [b.w + 20, b.h + pad + 3000],
  ]);

  // Flat water polygon bodies (Bay and Ocean)
  for (const [name, poly] of [['water_bay', bay], ['water_ocean', ocean]]) {
    const shape = new THREE.Shape(poly);
    const a = new THREE.Mesh(flatten(shape, WATER_Y), mat);
    a.name = `${name}_surface`;
    a.frustumCulled = false;
    group.add(a);
    const b = new THREE.Mesh(flatten(shape, WATER_Y + 0.02), mat2);
    b.name = `${name}_surface_swell`;
    b.frustumCulled = false;
    group.add(b);
  }

  // The River: built as a contiguous quad-strip ribbon so winding river curves
  // never suffer chord clipping or degenerate triangulation from 2D polygon planar cuts.
  if (D.water.river?.points?.length) {
    const riverGeo = buildRiverGeometry(D.water.river.points, D.water.river.width, WATER_Y);
    const riverA = new THREE.Mesh(riverGeo, mat);
    riverA.name = 'water_river_surface';
    riverA.frustumCulled = false;
    group.add(riverA);

    const riverSwellGeo = buildRiverGeometry(D.water.river.points, D.water.river.width, WATER_Y + 0.02);
    const riverB = new THREE.Mesh(riverSwellGeo, mat2);
    riverB.name = 'water_river_surface_swell';
    riverB.frustumCulled = false;
    group.add(riverB);
  }

  /* --- bridges --- nothing here any more (2026-09-25). This block predated
     world/spans.js (piers, soffit, fascia per road segment) and
     world/liftBridge.js (the signature bridge, whole) and put a SECOND set of
     piers and a slab at a fixed 7.6 m under every bridge. Once the river
     bridges became arches with a 3.3-4.1 m crown (district.js) that slab
     stood 3-4 m ABOVE their decks. Two instanced draws fewer. */

  scene.add(group);

  let t = 0;
  return {
    group,
    update(dt) {
      t += dt;
      // different speeds AND different bearings, or the two just beat together
      nrm.offset.set(t * 0.021, t * 0.033);
      nrm2.offset.set(-t * 0.029, t * 0.013);
    },
  };
}

/** Overlapping sine lobes baked into a tangent-space normal map. */
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
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  /* ShapeGeometry writes the shape's own XY into uv, so these UVs are in
     METRES, not 0..1. A repeat of 260 tiled the swell every four millimetres
     and aliased the whole ocean to flat grey; 1/15 gives a 15m wave. */
  tex.repeat.set(1 / 15, 1 / 15);
  return tex;
}

