import * as THREE from 'three';

/** Compose a TRS matrix. */
export function M4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Merge geometries into one. Position/normal/uv only — no need for the addon. */
export function mergeGeos(list) {
  const P = [], N = [], U = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    P.push(g.attributes.position.array);
    N.push(g.attributes.normal.array);
    U.push(g.attributes.uv.array);
  }
  const cat = (arrs) => {
    let n = 0; for (const a of arrs) n += a.length;
    const out = new Float32Array(n); let k = 0;
    for (const a of arrs) { out.set(a, k); k += a.length; }
    return out;
  };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(cat(P), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(cat(N), 3));
  out.setAttribute('uv', new THREE.BufferAttribute(cat(U), 2));
  return out;
}

/**
 * `uvs` is optional only for callers that genuinely have nothing to say. It
 * used to be absent everywhere, which wrote an all-zero UV attribute onto the
 * car hull and every merged prop -- every texel sampled the same corner of the
 * map, so the hull could never take a normal map, a livery, a plate or dirt.
 * That single omission is what blocked Tier 2 of the roadmap.
 */
export function fromTris(positions, normals, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (normals) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(
    uvs ? new Float32Array(uvs) : new Float32Array((positions.length / 3) * 2), 2));
  if (!normals) g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
//  Lofting
//  A station is [x, yBottom, yTop, wLow, wMax, wTop, shoulderY]. It expands
//  into a closed, mirror-symmetric section in the YZ plane. Consecutive
//  sections are stitched into quads.
// ---------------------------------------------------------------------------

export const SECTION_HALF = 16;              // samples up one side
export const SECTION_N = SECTION_HALF * 2 - 2;

/**
 * Control points down one flank, resampled through a spline.
 * Straight polyline control points gave a visibly faceted cross-section; the
 * spline is what makes the flank read as pressed sheet metal.
 */
export function section(st) {
  const [, yb, yt, wl, wm, wt, sy] = st;
  const span = yt - yb;
  const shoulder = yt - sy;
  const ctrl = [
    [0, yb],
    [wl * 0.55, yb],
    [wl * 0.95, yb + span * 0.03],
    [wl, yb + span * 0.10],
    [wm * 0.985, (sy + yb) * 0.5],
    [wm, sy],
    [wt * 1.035, yt - shoulder * 0.46],
    [wt, yt - shoulder * 0.13],
    [wt * 0.85, yt - shoulder * 0.035],
    [wt * 0.5, yt],
    [0, yt],
  ].map(([a, b]) => new THREE.Vector2(a, b));

  const sampled = new THREE.SplineCurve(ctrl).getPoints(SECTION_HALF - 1);
  const half = sampled.map((v) => [Math.max(0, v.x), v.y]);
  half[0][0] = 0;
  half[half.length - 1][0] = 0;

  const pts = half.slice();
  for (let i = half.length - 2; i >= 1; i--) pts.push([-half[i][0], half[i][1]]);
  return pts;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (u, v) => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
function norm(v) {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

/** Linearly blend two stations, so a classifier can ask about a quad's middle. */
function lerpStation(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/**
 * Stitch stations into buckets of triangle soup, with smoothed normals.
 *
 * Normals are averaged across adjacent quads, but only where the angle between
 * them is under `smoothAngle` — so the flanks and roof shade smoothly while the
 * wheel-arch cuts stay as creases. Per-face normals alone are what made this
 * read as a low-poly model.
 *
 * `classify(xMid, heightFraction, widthFraction)` names the bucket for a quad.
 * It is geometric rather than index-based, so the section resolution can change
 * without rewriting the glazing layout.
 */
export function loft(stations, classify = () => 'body', smoothAngle = 48) {
  const secs = stations.map(section);
  const N = secs[0].length;
  const S = stations.length;
  const cosLimit = Math.cos((smoothAngle * Math.PI) / 180);

  const P = [];
  for (let i = 0; i < S; i++) {
    const row = [];
    for (let k = 0; k < N; k++) row.push([stations[i][0], secs[i][k][1], secs[i][k][0]]);
    P.push(row);
  }

  // per-quad normal
  const QN = [];
  for (let i = 0; i < S - 1; i++) {
    const row = [];
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      const a = P[i][k], b = P[i + 1][k], c = P[i + 1][k2];
      row.push(norm(cross(sub(b, a), sub(c, a))));
    }
    QN.push(row);
  }

  // per-vertex normal: the mean of the (up to four) quads that touch it
  const VN = [];
  for (let i = 0; i < S; i++) {
    const row = [];
    for (let k = 0; k < N; k++) {
      let acc = [0, 0, 0];
      for (const qi of [i - 1, i]) {
        if (qi < 0 || qi >= S - 1) continue;
        for (const qk of [(k - 1 + N) % N, k]) {
          const n = QN[qi][qk];
          acc = [acc[0] + n[0], acc[1] + n[1], acc[2] + n[2]];
        }
      }
      row.push(norm(acc));
    }
    VN.push(row);
  }

  /* UVs: a cylindrical unwrap, which is the parameterisation the loft already
     has. U runs nose to tail in METRES normalised by hull length, so a decal is
     not squashed where the stations bunch up; V runs around the section by
     cumulative PERIMETER rather than by ring index, so the map does not stretch
     across the wide flank and crush over the narrow roof.

     The ring closes on itself (k2 wraps to 0), so a quad's second edge uses the
     UNWRAPPED index -- v = 1 rather than v = 0 -- which puts a normal texture
     seam down the underside instead of mirroring the whole map back on itself. */
  const x0 = stations[0][0];
  const xLen = (stations[S - 1][0] - x0) || 1;
  const ringV = [];
  for (let i = 0; i < S; i++) {
    const acc = [0];
    let total = 0;
    for (let k = 0; k < N; k++) {
      const a = P[i][k], b = P[i][(k + 1) % N];
      total += Math.hypot(b[1] - a[1], b[2] - a[2]);
      acc.push(total);
    }
    ringV.push(acc.map((d) => d / (total || 1)));
  }
  const uAt = (i) => (stations[i][0] - x0) / xLen;

  const buckets = new Map();
  const emit = (name, verts, normals, uvs) => {
    let b = buckets.get(name);
    if (!b) buckets.set(name, (b = { p: [], n: [], u: [] }));
    for (let i = 0; i < verts.length; i++) {
      b.p.push(verts[i][0], verts[i][1], verts[i][2]);
      b.n.push(normals[i][0], normals[i][1], normals[i][2]);
      b.u.push(uvs[i][0], uvs[i][1]);
    }
  };
  // hard crease if the quad disagrees with the averaged normal too much
  const pickNormal = (face, vertex) => {
    const d = face[0] * vertex[0] + face[1] * vertex[1] + face[2] * vertex[2];
    return d > cosLimit ? vertex : face;
  };

  for (let i = 0; i < S - 1; i++) {
    const mid = lerpStation(stations[i], stations[i + 1], 0.5);
    const xm = mid[0];
    const [, , yt, , wm, , sy] = mid;
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      const a = P[i][k], b = P[i + 1][k], c = P[i + 1][k2], d = P[i][k2];
      const yc = (a[1] + b[1] + c[1] + d[1]) / 4;
      const zc = (a[2] + b[2] + c[2] + d[2]) / 4;
      const heightFraction = (yc - sy) / Math.max(1e-4, yt - sy);
      const widthFraction = Math.abs(zc) / Math.max(1e-4, wm);
      const name = classify(xm, heightFraction, widthFraction);
      if (!name) continue;

      const fn = QN[i][k];
      const na = pickNormal(fn, VN[i][k]);
      const nb = pickNormal(fn, VN[i + 1][k]);
      const nc = pickNormal(fn, VN[i + 1][k2]);
      const nd = pickNormal(fn, VN[i][k2]);
      const ua = [uAt(i), ringV[i][k]];
      const ub = [uAt(i + 1), ringV[i + 1][k]];
      const uc = [uAt(i + 1), ringV[i + 1][k + 1]];
      const ud = [uAt(i), ringV[i][k + 1]];
      emit(name, [a, b, c], [na, nb, nc], [ua, ub, uc]);
      emit(name, [a, c, d], [na, nc, nd], [ua, uc, ud]);
    }
  }

  // flat caps at nose and tail — a crease there is correct, that is the bumper face
  for (const [si, flip] of [[0, false], [S - 1, true]]) {
    let cy = 0, cz = 0;
    for (let k = 0; k < N; k++) { cy += secs[si][k][1]; cz += secs[si][k][0]; }
    const centre = [stations[si][0], cy / N, cz / N];
    const n = [flip ? 1 : -1, 0, 0];
    /* The caps are a fan, so they get their own little disc projection --
       taking a slice of the body map here would smear the whole flank texture
       across the bumper face. */
    let rMax = 1e-4;
    for (let k = 0; k < N; k++) {
      rMax = Math.max(rMax, Math.hypot(P[si][k][1] - centre[1], P[si][k][2] - centre[2]));
    }
    const capUv = (v) => [
      0.5 + ((v[2] - centre[2]) / rMax) * 0.5,
      0.5 + ((v[1] - centre[1]) / rMax) * 0.5,
    ];
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      const tri = flip
        ? [centre, P[si][k], P[si][k2]]
        : [centre, P[si][k2], P[si][k]];
      emit('body', tri, [n, n, n], tri.map(capUv));
    }
  }

  const out = {};
  for (const [name, b] of buckets) out[name] = fromTris(b.p, b.n, b.u);
  return out;
}

/**
 * A thin ribbon following the body contour at a given station — a panel shutline.
 * Offsets the section outward along its own 2D normal so the seam hugs the
 * curvature instead of cutting through it.
 */
export function seamRing(stations, x, { width = 0.006, lift = 0.004, minY = 0.1, maxWidthFraction = 0.42 } = {}) {
  let i = 0;
  while (i < stations.length - 2 && stations[i + 1][0] < x) i++;
  const t = (x - stations[i][0]) / Math.max(1e-4, stations[i + 1][0] - stations[i][0]);
  const st = lerpStation(stations[i], stations[i + 1], Math.max(0, Math.min(1, t)));
  const pts = section(st);
  const N = pts.length;

  // outward 2D normal at each point, averaged from its two edges
  const nrm = [];
  for (let k = 0; k < N; k++) {
    const p0 = pts[(k - 1 + N) % N], p1 = pts[k], p2 = pts[(k + 1) % N];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1]];
    const e2 = [p2[0] - p1[0], p2[1] - p1[1]];
    let nx = e1[1] + e2[1], ny = -(e1[0] + e2[0]);
    const L = Math.hypot(nx, ny) || 1;
    nrm.push([nx / L, ny / L]);
  }

  const pos = [], nor = [];
  const yFloor = st[1] + minY;
  // A door shutline runs up the flank and stops at the drip rail. Letting the
  // ring close over the roof painted a black stripe across the roof panel.
  const zFloor = st[4] * maxWidthFraction;
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N;
    if (pts[k][1] < yFloor || pts[k2][1] < yFloor) continue;
    if (Math.abs(pts[k][0]) < zFloor || Math.abs(pts[k2][0]) < zFloor) continue;
    const oz1 = pts[k][0] + nrm[k][0] * lift, oy1 = pts[k][1] + nrm[k][1] * lift;
    const oz2 = pts[k2][0] + nrm[k2][0] * lift, oy2 = pts[k2][1] + nrm[k2][1] * lift;
    const a = [x - width, oy1, oz1], b = [x + width, oy1, oz1];
    const c = [x + width, oy2, oz2], d = [x - width, oy2, oz2];
    const n1 = [0, nrm[k][1], nrm[k][0]], n2 = [0, nrm[k2][1], nrm[k2][0]];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    nor.push(...n1, ...n1, ...n2, ...n1, ...n2, ...n2);
  }
  return fromTris(pos, nor);
}
