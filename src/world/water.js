import * as THREE from 'three';

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
const DECK_T = 0.9;                // bridge deck thickness
const DECK_Y = 7.6;               // must match District's bridge span height

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
  const g = new THREE.ShapeGeometry(shape, 12);
  g.rotateX(-Math.PI / 2);         // shape XY -> world XZ, facing up
  g.translate(0, y, 0);
  return g;
}

export function buildWater(scene, district, day = true) {
  const group = new THREE.Group();
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
  const land = new THREE.Mesh(flatten(outline, -0.06), new THREE.MeshLambertMaterial({
    color: day ? 0x59614a : 0x11161c,
  }));
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
  for (const poly of [bay, river, ocean]) {
    const shape = new THREE.Shape(poly);
    const a = new THREE.Mesh(flatten(shape, WATER_Y), mat);
    a.frustumCulled = false;
    group.add(a);
    const b = new THREE.Mesh(flatten(shape, WATER_Y + 0.02), mat2);
    b.frustumCulled = false;
    group.add(b);
  }

  /* --- bridges ---
     The carriageway itself stays flat at y=0: re-elevating the road graph
     would mean re-deriving every kerb, marking and lamp that hangs off it.
     What was missing is everything UNDER the road -- so each crossing gets a
     deck soffit, piers down to the water, and parapets you can see over. */
  const decks = [], piers = [];
  for (const br of D.bridges) {
    const pts = br.points, half = br.width / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const yaw = Math.atan2(bz - az, bx - ax);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      decks.push(M(mx, DECK_Y - DECK_T, mz, yaw, L, DECK_T, br.width));
      /* No rails here any more. districtWorld emits a parapet per road segment
         that FOLLOWS the ramp from the same corner heights as the tarmac; a
         second, fixed-height rail at DECK_Y doubled it over the water and
         stopped dead at the abutments. The deck soffit and piers stay: they
         are what you see from the water, and nothing else draws them. */
      // piers every ~34m, stopping short of the abutments
      for (let t = 16; t < L - 14; t += 34) {
        const px = ax + Math.cos(yaw) * t, pz = az + Math.sin(yaw) * t;
        piers.push(M(px, WATER_Y - 4, pz, yaw, 3.4, DECK_Y - DECK_T - (WATER_Y - 4), br.width * 0.55));
      }
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const inst = (list, colour, shadow) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: colour }), list.length);
    list.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.castShadow = !!shadow;
    m.receiveShadow = true;
    group.add(m);
  };
  inst(decks, day ? 0x8c8880 : 0x1b2027, true);
  inst(piers, day ? 0x7d7a72 : 0x171c22, true);

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

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** Box placed by centre-along-run, bottom-anchored in Y, yawed to the run. */
function M(x, y, z, yaw, len, h, w) {
  _e.set(0, -yaw, 0);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z), _q.setFromEuler(_e), _s.set(len, h, w),
  );
}
