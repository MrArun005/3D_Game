import * as THREE from 'three';

/**
 * What the city stops at.
 *
 * Halstead Bay is 4200 x 3000m of authored map and nothing beyond it. Left
 * alone the horizon is a hard edge onto the sky, which reads as a bug from
 * anywhere elevated. So the map gets a boundary the player can see and
 * understand: a fence at the last metre of city, then open ground, then a
 * mountain ring that closes the view in every direction.
 *
 * All of it is static and built once -- it is outside the streaming radius by
 * definition, and re-generating a mountain because a chunk moved would be
 * absurd.
 */

const hash = (x, z) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** Value noise: smooth enough to be a landform rather than a spike field. */
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u) + ((c - a) + (d - c) * u - (b - a) * u) * v;
}

function ridge(x, z) {
  return noise(x, z) * 0.44 + noise(x * 2.1, z * 2.1) * 0.26
       + noise(x * 4.3, z * 4.3) * 0.17 + noise(x * 9.1, z * 9.1) * 0.09
       + noise(x * 17.3, z * 17.3) * 0.04;
}

export function buildSurrounds(scene, bounds, day = true) {
  const group = new THREE.Group();
  const cx = bounds.w / 2, cz = bounds.h / 2;
  const APRON = 900;                     // flat ground between fence and foothills
  const RANGE = 3400;                    // depth of the mountain belt itself

  /* No apron plate here: water.js owns the single ground surface, because it
     is the only place that knows where the bay and the river are cut out of
     it. A second plate laid over the top would fill the harbour back in. */

  /* --- the range ---
     A grid over the whole surround, with the city footprint cut out. Height is
     driven by how far outside the map a vertex is, so the hills start low at
     the apron and build to a skyline -- a wall of uniform peaks reads as a
     backdrop, a graded one reads as terrain. */
  const half = { x: bounds.w / 2 + APRON, z: bounds.h / 2 + APRON };
  const outer = { x: half.x + RANGE, z: half.z + RANGE };
  const N = 210;
  const pos = [], idx = [], col = [], ramps = [];
  const c = new THREE.Color();
  const rock = day ? [0x4a5340, 0x5d6450, 0x6f7361, 0x83836f, 0x9a9583] : [0x1c2430, 0x232c3a, 0x2a3442, 0x323a46, 0x39414d];
  const snow = day ? 0xe8eef2 : 0x8a97a8;

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = j / N;
      const x = -outer.x + u * outer.x * 2;
      const z = -outer.z + v * outer.z * 2;
      // 0 inside the city+apron, ramping to 1 at the far edge of the range
      const d = Math.max(
        (Math.abs(x) - half.x) / RANGE,
        (Math.abs(z) - half.z) / RANGE,
      );
      // no mountains to seaward: the east side of the map is open ocean
      const t = x > half.x * 0.92 ? 0 : Math.max(0, Math.min(1, d));
      const ramp = t * t * (3 - 2 * t);
      const h = ramp * (420 + ridge(x / 760, z / 760) * 1850) - 2;
      pos.push(cx + x, h, cz + z);
      ramps.push(ramp);
      const lit = ridge(x / 620, z / 620);
      /* Band by ALTITUDE first, then break the band with noise. Picking the
         colour from noise alone gave a range with no vertical structure --
         everything the same speckled grey, which is why it read as haze. */
      const band = Math.min(rock.length - 1, Math.floor((h / 1500) * rock.length + lit * 1.1));
      c.setHex(h > 1250 + lit * 320 ? snow : rock[Math.max(0, band)]);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      /* Skip the flat interior. Every vertex inside the city ramps to 0, which
         left a sheet at y=-2 spanning the whole map -- invisible against the
         ground plate, but two thirds of a metre ABOVE the harbour, so it
         quietly floored the bay and the river. */
      if (!ramps[a] && !ramps[a + 1] && !ramps[a + N + 1] && !ramps[a + N + 2]) continue;
      idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const hills = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
  }));
  hills.frustumCulled = false;
  group.add(hills);

  /* --- the fence ---
     Chain-link, drawn as an alpha-mapped strip rather than modelled wire: at
     4200x3000 the perimeter is 14.4km, and real mesh would cost more than the
     city it surrounds. Posts are geometry because their silhouette is what
     sells it from three metres away. */
  const linkTex = chainLink();
  const H = 2.6, INSET = 6;
  const x0 = -INSET, x1 = bounds.w + INSET, z0 = -INSET, z1 = bounds.h + INSET;
  // three runs, not four: you do not fence the sea
  const runs = [
    [x0, z0, x1, z0], [x1, z1, x0, z1], [x0, z1, x0, z0],
  ];
  const fpos = [], fuv = [], fidx = [];
  const posts = [];
  for (const [ax, az, bx, bz] of runs) {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const base = fpos.length / 3;
    fpos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, H, az);
    const vh = H / 3.1;                       // keep the diamonds square
    fuv.push(0, 0, L / 3.1, 0, L / 3.1, vh, 0, vh);
    fidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    for (let t = 0; t < L; t += 3.1) posts.push([ax + ux * t, az + uz * t]);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fpos), 3));
  fg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(fuv), 2));
  fg.setIndex(fidx);
  fg.computeVertexNormals();
  group.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
    map: linkTex, transparent: true, alphaTest: 0.35,
    side: THREE.DoubleSide, fog: true,
  })));

  const postGeo = new THREE.CylinderGeometry(0.055, 0.055, H + 0.12, 6);
  postGeo.translate(0, (H + 0.12) / 2, 0);
  const postMesh = new THREE.InstancedMesh(
    postGeo, new THREE.MeshLambertMaterial({ color: 0x777f86 }), posts.length,
  );
  postMesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  posts.forEach(([px, pz], i) => postMesh.setMatrixAt(i, m.makeTranslation(px, 0, pz)));
  postMesh.instanceMatrix.needsUpdate = true;
  group.add(postMesh);

  scene.add(group);
  return group;
}

/** One 64px chain-link cell, tiled. Alpha carries the diamonds. */
function chainLink() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#b9c2c8';
  g.lineWidth = 3.2;
  g.beginPath();
  for (let i = -64; i <= 128; i += 16) {
    g.moveTo(i, 0); g.lineTo(i + 64, 64);
    g.moveTo(i, 64); g.lineTo(i + 64, 0);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 1);
  return t;
}
