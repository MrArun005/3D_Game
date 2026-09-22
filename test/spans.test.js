import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { District, DECK_T } from '../src/world/district.js';
import { buildSpan, spanTris, signatureBridge, clipToBounds, MIN_SPAN_H, PIER_MIN, PIER_MAX, POST_STEP, LAMP_STEP, UPSTAND_H, WATER_Y } from '../src/world/spans.js';

/* world/spans.js is the structure every elevated road gets: piers, a fascia,
   a parapet with a REAL railing, lamps, joints, abutments and a soffit.
   None of it needs a GPU, so everything that can be wrong without one is
   covered here: where the piers land, how far apart, whether two chunks
   sharing a span agree about it, whether the railing has gaps you can see the
   water through, and the triangle budget. */

const data = JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url)));
const city = new District(data);

/** Distance from a point to a polyline -- to find the road segments on a bridge. */
function nearPoly(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    let t = l2 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

/** The road segments that actually carry a bridge's deck. */
function segsOn(br) {
  const p0 = br.points[0], p1 = br.points[br.points.length - 1];
  const r = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2 + 90;
  return city.segmentsNear((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, r).filter((s) => {
    const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
    /* A segment counts only if the TARMAC is elevated along it, and the tarmac
       is one quad with elevationAt() at its four corners -- so a 1.2 km
       boundary segment whose ENDS are at grade is drawn flat and gets no
       structure, on purpose (spans.js header). Match that test here. */
    return nearPoly(br.points, mx, mz) < br.width / 2 + 4
      && Math.max(city.elevationAt(s.ax, s.az), city.elevationAt(s.bx, s.bz)) > 0.12;
  });
}

const LIFT = data.bridges.find((b) => b.name === 'HALSTEAD LIFT BRIDGE');
const liftSegs = segsOn(LIFT);

/** How far apart the two long edges of a segment's deck quad are, in metres. */
function crossFall(s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * s.half, nz = (dx / L) * s.half;
  return Math.max(
    Math.abs(city.elevationAt(s.ax + nx, s.az + nz) - city.elevationAt(s.ax - nx, s.az - nz)),
    Math.abs(city.elevationAt(s.bx + nx, s.bz + nz) - city.elevationAt(s.bx - nx, s.bz - nz)));
}
/* Everything below is read off ONE segment. It used to be the longest one on
   the signature bridge -- which is the single worst choice in the district:
   the road graph runs ~16 m west of that bridge's polyline, so district.js's
   lifted band cuts the carriageway down the middle and its two kerbs sit 7.60 m
   apart. spans.js refuses to build on a quad like that, so read it off the
   longest bridge segment that IS a deck. */
const deckSegs = data.bridges.flatMap(segsOn).filter((s) => crossFall(s) <= DECK_T);
const deckSeg = deckSegs.reduce((a, s) => (Math.hypot(s.bx - s.ax, s.bz - s.az) > Math.hypot(a.bx - a.ax, a.bz - a.az) ? s : a));
const deckL = Math.hypot(deckSeg.bx - deckSeg.ax, deckSeg.bz - deckSeg.az);
const built = buildSpan(deckSeg, city);

/** Signed offset of a point across the segment, and its distance along it. */
function frame(s, x, z) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const rx = x - s.ax, rz = z - s.az;
  return { t: rx * ux + rz * uz, off: rx * -uz + rz * ux, L };
}

const bbox = (geo) => { geo.computeBoundingBox(); return geo.boundingBox; };
const sizeOf = (geo) => bbox(geo).getSize(new THREE.Vector3());

/* The railing posts are ONE geometry per edge (spans.js repeat(): 24 vertices
   a post), so count vertices, not parts. A post is the only metal thing
   between half a metre and 1.4 m tall -- rails are 50 mm and lamp columns 4.2 m. */
const postRuns = (r) => r.parts.filter((p) => { const s = sizeOf(p.geo); return p.mat === 'metal' && s.y > 0.5 && s.y < 1.4; });
const postCount = (r) => postRuns(r).reduce((n, p) => n + p.geo.attributes.position.count / 24, 0);

test('the plan has bridges whose carriageway is actually elevated', () => {
  assert.ok(LIFT.signature, 'HALSTEAD LIFT BRIDGE is the signature bridge');
  assert.ok(liftSegs.length >= 4, `segments on the lift bridge: ${liftSegs.length}`);
  assert.ok(deckSegs.length >= 15, `bridge segments with a real deck: ${deckSegs.length}`);
  assert.ok(deckL > 40, `longest deck segment ${deckL.toFixed(0)} m`);
  assert.ok(built.parts.length > 20, `parts ${built.parts.length}`);
  assert.ok(built.carried, 'this deck is carried on piers');
});

test('a deck quad the elevation band cut in half builds nothing at all', () => {
  /* district.js lifts the band `half + 5.5` about the BRIDGE polyline; the
     deck quad is the ROAD segment at its own half. On the lift bridge the two
     are ~16 m apart, so one kerb comes back at 7.60 m and the other at 0.
     A fascia on the low edge would lie on the ground beside the road and a
     pier under the average of the two would hold nothing: build neither. */
  const cut = liftSegs.filter((s) => crossFall(s) > DECK_T);
  assert.ok(cut.length >= 4, `lift-bridge segments cut by the band: ${cut.length}`);
  assert.ok(Math.max(...cut.map(crossFall)) > 7, `worst cross-fall ${Math.max(...cut.map(crossFall)).toFixed(2)} m`);
  for (const s of cut) {
    const none = buildSpan(s, city);
    assert.equal(none.parts.length, 0, `structure on a ${crossFall(s).toFixed(1)} m cross-fall`);
    assert.equal(none.piers.length, 0);
    assert.equal(none.carried, false);
  }
  // ...and it costs the bridges that ARE built nothing: they are all near flat
  for (const s of deckSegs) assert.ok(crossFall(s) <= DECK_T, `kept segment cross-fall ${crossFall(s)}`);
});

test('the deck is closed from below: a soffit between the two fascias', () => {
  /* A.mat.tarmac is FrontSide, so the carriageway quad does not exist when you
     look up at it. Once districtWorld's skirt is a soffit band rather than a
     wall to the ground, something has to close the underside or a boat sees
     the sky through the road. */
  const deckY = city.elevationAt(deckSeg.ax, deckSeg.az);
  const wide = built.parts.filter((p) => {
    const b = bbox(p.geo), s = b.getSize(new THREE.Vector3());
    return p.mat === 'concrete' && Math.min(s.x, s.z) > deckSeg.half && b.max.y < deckY - 0.5 && b.max.y > deckY - DECK_T - 0.1;
  });
  assert.ok(wide.length >= 1, 'a slab spanning the carriageway sits just under the deck');
  const b = bbox(wide[0].geo);
  assert.ok(b.max.y - b.min.y < 0.4, `the soffit is a slab, not a box: ${(b.max.y - b.min.y).toFixed(2)} m`);
});

test('a span at grade gets nothing at all', () => {
  const flat = { ax: 900, az: 900, bx: 1000, bz: 900, half: 8, cls: 'street' };
  const none = buildSpan(flat, city);
  assert.equal(none.parts.length, 0);
  assert.equal(none.lamps.length, 0);
  assert.equal(none.piers.length, 0);
  assert.equal(none.carried, false);
});

test('piers stand under the deck, reach the ground or the riverbed, and stop below the soffit', () => {
  assert.ok(built.piers.length >= 1, `piers on a ${deckL.toFixed(0)} m deck: ${built.piers.length}`);
  for (const p of built.piers) {
    const f = frame(deckSeg, p.x, p.z);
    assert.ok(Math.abs(f.off) < 0.05, `pier on the centreline, off=${f.off.toFixed(3)}`);
    assert.ok(f.t > 0 && f.t < f.L, `pier inside the segment, t=${f.t.toFixed(1)} of ${f.L.toFixed(1)}`);
    assert.ok(p.deck >= MIN_SPAN_H, `no pier under a ramp: deck ${p.deck.toFixed(2)} m`);
    // the cap top sits exactly one deck thickness under the road
    assert.ok(Math.abs(p.top - (p.deck - DECK_T)) < 1e-6, `cap under the soffit: ${p.top} vs ${p.deck - DECK_T}`);
    // and the shaft runs to the ground, or into the bed under open water
    const wet = city.inOpenWater(p.x, p.z);
    const want = wet ? WATER_Y - 3.4 : 0;
    assert.ok(Math.abs(p.base - want) < 1e-6, `foot at ${p.base} (wet=${wet}), wanted ${want}`);
    assert.ok(p.base < p.top - 0.6, 'a pier with height');
  }
  // and the geometry really is down there: the lowest concrete reaches the feet
  let low = Infinity;
  for (const p of built.parts) if (p.mat === 'concrete') low = Math.min(low, bbox(p.geo).min.y);
  const deepest = Math.min(...built.piers.map((p) => p.base));
  assert.ok(Math.abs(low - deepest) < 0.01, `lowest concrete ${low.toFixed(2)} vs deepest pier foot ${deepest.toFixed(2)}`);
});

test('pier spacing is inside 24-34 m and the whole span is carried', () => {
  let n = 0;
  for (const br of data.bridges) {
    for (const s of segsOn(br)) {
      const b = buildSpan(s, city);
      for (let i = 1; i < b.piers.length; i++) {
        const gap = b.piers[i].t - b.piers[i - 1].t;
        assert.ok(gap >= PIER_MIN - 0.01 && gap <= PIER_MAX + 0.01, `pier gap ${gap.toFixed(1)} m on ${br.name}`);
      }
      n += b.piers.length;
    }
  }
  assert.ok(n >= 10, `piers over all ten bridges: ${n}`);
});

test('the same segment builds the same structure twice (seeded from its endpoints)', () => {
  const a = buildSpan(deckSeg, city, { truss: true });
  const b = buildSpan(deckSeg, city, { truss: true });
  assert.equal(a.parts.length, b.parts.length);
  assert.equal(spanTris(a), spanTris(b));
  for (let i = 0; i < a.parts.length; i++) {
    assert.equal(a.parts[i].mat, b.parts[i].mat);
    const pa = a.parts[i].geo.attributes.position.array, pb = b.parts[i].geo.attributes.position.array;
    assert.equal(pa.length, pb.length);
    for (let j = 0; j < pa.length; j++) assert.equal(pa[j], pb[j], `part ${i} vertex ${j}`);
  }
  // and the endpoint ORDER cannot change it: the seed is canonicalised
  const flipped = buildSpan({ ...deckSeg, ax: deckSeg.bx, az: deckSeg.bz, bx: deckSeg.ax, bz: deckSeg.az }, city);
  assert.equal(flipped.piers.length, built.piers.length, 'same pier count from either end');
  const ts = built.piers.map((p) => p.t).sort((x, y) => x - y);
  const fs = flipped.piers.map((p) => deckL - p.t).sort((x, y) => x - y);
  for (let i = 0; i < ts.length; i++) assert.ok(Math.abs(ts[i] - fs[i]) < 1e-6, `pier ${i}: ${ts[i]} vs ${fs[i]}`);
});

test('two adjoining chunks cut one span in half: no doubled pier, no dropped post', () => {
  // a plane across the middle of the deck segment, as a pair of chunk boxes
  const pad = 4000;
  const f = frame(deckSeg, deckSeg.bx, deckSeg.bz);
  const ux = (deckSeg.bx - deckSeg.ax) / f.L, uz = (deckSeg.bz - deckSeg.az) / f.L;
  const cut = [deckSeg.ax + ux * deckL * 0.5, deckSeg.az + uz * deckL * 0.5];
  // the deck runs mostly along +Z here; split on whichever axis it actually crosses
  const axis = Math.abs(uz) > Math.abs(ux) ? 'z' : 'x';
  const lo = axis === 'z'
    ? { x0: -pad, x1: pad, z0: -pad, z1: cut[1] }
    : { x0: -pad, x1: cut[0], z0: -pad, z1: pad };
  const hi = axis === 'z'
    ? { x0: -pad, x1: pad, z0: cut[1], z1: pad }
    : { x0: cut[0], x1: pad, z0: -pad, z1: pad };

  const whole = buildSpan(deckSeg, city);
  const a = buildSpan(deckSeg, city, { bounds: lo });
  const b = buildSpan(deckSeg, city, { bounds: hi });
  assert.ok(a.piers.length > 0 && b.piers.length > 0, `the cut splits the piers: ${a.piers.length}/${b.piers.length}`);
  assert.equal(a.piers.length + b.piers.length, whole.piers.length, 'piers are partitioned, not doubled or dropped');
  assert.equal(a.lamps.length + b.lamps.length, whole.lamps.length, 'lamps are partitioned');
  for (const p of a.piers) for (const q of b.piers) {
    assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > 1, `a pier built twice at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  }
  // the railing posts too: the two halves add up to exactly the whole
  assert.ok(postCount(whole) > 20, `posts on the whole span: ${postCount(whole)}`);
  assert.equal(postCount(a) + postCount(b), postCount(whole), `posts ${postCount(a)}+${postCount(b)} vs ${postCount(whole)}`);
  // and the continuous runs are clipped, so the deck edge is covered exactly once
  const runLen = (r) => r.parts.filter((p) => p.mat === 'concrete').reduce((m, p) => Math.max(m, bbox(p.geo).getSize(new THREE.Vector3()).length()), 0);
  assert.ok(runLen(a) < runLen(whole) && runLen(b) < runLen(whole), 'the fascia is clipped to each chunk, not rebuilt whole');
});

test('the railing has real gaps: separate posts, thin rails, and open air between them', () => {
  const rails = built.parts.filter((p) => { const s = sizeOf(p.geo); return p.mat === 'metal' && s.y < 0.3 && Math.max(s.x, s.z) > deckL * 0.5; });
  // posts every POST_STEP on both sides
  const posts = postCount(built);
  const want = Math.floor(deckL / POST_STEP) * 2;
  assert.ok(Math.abs(posts - want) <= 4, `railing posts ${posts}, wanted about ${want}`);
  assert.equal(postRuns(built).length, 2, 'one post run per side of the deck');
  assert.ok(rails.length === 4 || rails.length === 6, `two or three rails a side: ${rails.length} rails`);
  // the posts are SEPARATE geometry from the rails -- nothing merged into a wall
  for (const p of postRuns(built)) {
    assert.equal(p.geo.attributes.position.count % 24, 0, 'a run of boxes, not a wall');
    // every 24-vertex block is a 90 mm box with air on both sides of it
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 72) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let j = i; j < i + 72; j += 3) { x0 = Math.min(x0, a[j]); x1 = Math.max(x1, a[j]); z0 = Math.min(z0, a[j + 2]); z1 = Math.max(z1, a[j + 2]); }
      assert.ok(x1 - x0 < 0.2 && z1 - z0 < 0.2, `post ${i / 72} is ${(x1 - x0).toFixed(2)} x ${(z1 - z0).toFixed(2)} -- that is a wall`);
    }
  }
  // at a height between two rails the railing is mostly air: the posts cover
  // under a tenth of the run. That is the whole point -- the old 1.0 m
  // parapet was solid from the kerb to the top.
  const railTop = Math.max(...rails.map((p) => bbox(p.geo).max.y));
  const deckY = city.elevationAt(deckSeg.ax, deckSeg.az);
  assert.ok(railTop > deckY + UPSTAND_H + 0.5, `the railing clears the upstand: ${railTop.toFixed(2)}`);
  const solidAcross = posts * 0.09;
  assert.ok(solidAcross < deckL * 2 * 0.1, `railing is ${(solidAcross / (deckL * 2) * 100).toFixed(1)}% solid`);
  // and the solid part below it really is low
  const upstands = built.parts.filter((p) => p.mat === 'concrete')
    .map((p) => bbox(p.geo)).filter((b) => b.min.y > deckY - 0.01 && b.max.y > deckY);
  for (const b of upstands) assert.ok(b.max.y - deckY <= UPSTAND_H + 0.01, `solid parapet ${(b.max.y - deckY).toFixed(2)} m, cap is ${UPSTAND_H}`);
});

test('lamps alternate sides, sit on the parapet line, and come back for the light pool', () => {
  const L = deckL;
  assert.ok(built.lamps.length >= Math.floor(L / LAMP_STEP) - 1, `lamps ${built.lamps.length} over ${L.toFixed(0)} m`);
  let last = 0;
  built.lamps.forEach((lp, i) => {
    const f = frame(deckSeg, lp.x, lp.z);
    assert.ok(Math.abs(f.off) > deckSeg.half - 2 && Math.abs(f.off) < deckSeg.half,
      `lamp ${i} on the parapet line: |off|=${Math.abs(f.off).toFixed(2)} of half=${deckSeg.half}`);
    const side = Math.sign(f.off);
    if (i) assert.equal(side, -last, `lamp ${i} alternates sides`);
    last = side;
    const deck = city.elevationAt(lp.x, lp.z);
    assert.ok(lp.y > deck + 3.5 && lp.y < deck + 6, `lamp head ${(lp.y - deck).toFixed(2)} m over the deck`);
    assert.equal(typeof lp.colour, 'number', 'a colour for the glare sprite and the light pool');
  });
});

test('joints, abutments, and nothing over the deck', () => {
  // one dark joint strip over each pier, and nothing else is dark
  const dark = built.parts.filter((p) => p.mat === 'dark');
  assert.equal(dark.length, built.piers.length, `joint strips ${dark.length} vs piers ${built.piers.length}`);
  for (const p of dark) {
    const s = bbox(p.geo).getSize(new THREE.Vector3());
    assert.ok(s.y < 0.01, 'the joint lies flat on the deck');
    assert.ok(Math.max(s.x, s.z) > deckSeg.half, 'it crosses the whole carriageway');
  }
  // nothing is built over the deck: no truss, only the lamp columns
  const deckY0 = city.elevationAt(deckSeg.ax, deckSeg.az);
  const over = built.parts.filter((p) => p.mat === 'metal' && bbox(p.geo).min.y > deckY0 + 4);
  for (const p of over) {
    const s = bbox(p.geo).getSize(new THREE.Vector3());
    assert.ok(Math.max(s.x, s.y, s.z) < 5, `a ${Math.max(s.x, s.y, s.z).toFixed(1)} m member over the deck -- world/liftBridge.js owns the steel`);
  }
  // the ramp ends of the bridge carry an abutment down to grade
  let abutments = 0;
  for (const s of deckSegs) {
    for (const p of buildSpan(s, city).parts) {
      const b = bbox(p.geo);
      if (p.mat === 'concrete' && b.min.y < 0.01 && b.max.y > 3 && b.getSize(new THREE.Vector3()).length() > deckSeg.half) abutments++;
    }
  }
  assert.ok(abutments >= 1, `abutments where a bridge meets the bank: ${abutments}`);
});

test('signatureBridge picks the bridge world/liftBridge.js owns, and nothing else', () => {
  // districtWorld must not build a second structure on the one bridge that has its own module
  const on = liftSegs.filter((s) => signatureBridge(s, city));
  assert.ok(on.length >= 4, `lift-bridge segments recognised: ${on.length}`);
  const other = data.bridges.find((b) => b.name === 'DOCK ROAD');
  // DOCK ROAD crosses the lift bridge at right angles: inside the corridor, not running with it
  for (const s of segsOn(other)) assert.equal(signatureBridge(s, city), false, 'DOCK ROAD is not the signature bridge');
  assert.equal(signatureBridge({ ax: 900, az: 900, bx: 1000, bz: 900 }, city), false, 'a street downtown is not a bridge');
});

test('clipToBounds partitions a line exactly once', () => {
  const [lo, hi] = clipToBounds(0, 0, 1, 0, 100, { x0: -10, x1: 40, z0: -10, z1: 10 });
  assert.equal(lo, 0); assert.equal(hi, 40);
  const [lo2, hi2] = clipToBounds(0, 0, 1, 0, 100, { x0: 40, x1: 400, z0: -10, z1: 10 });
  assert.equal(lo2, 40); assert.equal(hi2, 100);
  const [a, b] = clipToBounds(0, 0, 1, 0, 100, { x0: 500, x1: 600, z0: -10, z1: 10 });
  assert.ok(b <= a, 'a segment outside the chunk builds nothing');
});

test('every elevated segment in the district is inside 2,500 triangles per 100 m', () => {
  let worst = 0, worstWhat = '', total = 0, metres = 0;
  for (const br of data.bridges) {
    for (const s of segsOn(br)) {
      if (crossFall(s) > DECK_T) continue;        // the band cut this quad: nothing is built on it
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const b = buildSpan(s, city);
      const tris = spanTris(b);
      total += tris; metres += L;
      const per = (tris / L) * 100;
      if (per > worst) { worst = per; worstWhat = `${br.name ?? '(unnamed)'} ${L.toFixed(0)} m`; }
      assert.ok(per <= 2500, `${br.name ?? '(unnamed)'}: ${per.toFixed(0)} triangles per 100 m`);
    }
  }
  assert.ok(metres > 500, `elevated bridge deck measured: ${metres.toFixed(0)} m`);
  assert.ok(total > 0);
  // a sanity floor too: a span that costs nothing is a span that built nothing
  assert.ok((total / metres) * 100 > 300, `mean ${((total / metres) * 100).toFixed(0)} per 100 m looks empty`);
  assert.ok(worst > 0, worstWhat);
});
