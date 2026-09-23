import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHumanGeometry, humanTriangles, unpackLook, _internals } from '../src/world/figure.js';

const { B, R, HAIR_STYLES, WEARS, packLook } = _internals;

test('the person is one indexed mesh with real UVs and a packed tag on every vertex', () => {
  for (const lod of [0, 1]) {
    const g = buildHumanGeometry(lod);
    assert.ok(g.index, 'indexed: the vertex shader runs once per vertex, not three times per triangle');
    for (const name of ['position', 'normal', 'uv', 'aTag']) assert.ok(g.attributes[name], `${name} on lod ${lod}`);
    const uv = g.attributes.uv.array;
    let nonZero = 0;
    for (let i = 0; i < uv.length; i++) if (uv[i] !== 0) nonZero++;
    assert.ok(nonZero > uv.length * 0.5, 'UVs are real, not the all-zero fill (CLAUDE.md rule 4)');
    // every tag names a real bone and region
    const tag = g.attributes.aTag.array, bones = new Set(Object.values(B)), regions = new Set(Object.values(R));
    for (let i = 0; i < tag.length; i += 3) {
      assert.ok(bones.has(tag[i]), `bone ${tag[i]}`);
      assert.ok(regions.has(tag[i + 1]), `region ${tag[i + 1]}`);
    }
    g.dispose();
  }
});

test('triangle budgets: near mesh under 3.6k, far mesh under 1k', () => {
  const near = humanTriangles(0), far = humanTriangles(1);
  assert.ok(near < 3600, `near ${near}`);
  assert.ok(far < 1000, `far ${far}`);
  assert.ok(far < near / 3, 'the far mesh is a real LOD');
});

test('every hair style wears at least one hair piece, and cropped wears only its own', () => {
  const g = buildHumanGeometry(0), tag = g.attributes.aTag.array, masks = new Set();
  for (let i = 0; i < tag.length; i += 3) if (tag[i + 2] >= 0) masks.add(tag[i + 2]);
  for (let style = 0; style < HAIR_STYLES; style++) {
    const worn = [...masks].filter((m) => (Math.floor(m / 2 ** style) % 2) === 1);
    assert.ok(worn.length > 0, `style ${style} wears something`);
    if (style === 2) assert.deepEqual(worn, [WEARS.cropped]);
  }
  g.dispose();
});

test('the look packs into one float and decodes exactly, inside the interpolation margin', () => {
  for (let i = 0; i < 400; i++) {
    const w = packLook(i, null);
    const l = unpackLook(w);
    assert.ok(l.style >= 0 && l.style < HAIR_STYLES);
    assert.ok(l.pattern >= 0 && l.pattern < 4);
    assert.ok(l.shorts === 0 || l.shorts === 1);
    assert.ok(l.longSleeve === 0 || l.longSleeve === 1);
    assert.ok(l.bag === 0 || l.bag === 1);
    if (l.pattern === 3) assert.equal(l.longSleeve, 1, 'an open jacket has sleeves');
    const f = w - Math.floor(w);
    assert.ok(f >= 0.05 - 1e-9 && f <= 0.95 + 1e-9, 'the build fraction stays off the integers');
  }
  for (const bag of [0, 1]) {
    const w = packLook(7, 5, { pattern: 2, shorts: 1, longSleeve: 0, bag, build: 0.5 });
    assert.deepEqual({ ...unpackLook(w), build: Math.round(unpackLook(w).build * 100) / 100 },
      { style: 5, pattern: 2, shorts: 1, longSleeve: 0, bag, umbrella: 0, build: 0.5 });
    // the umbrella bit rides on top of the colour()-time look (FigureFleet.flush adds it with the rain) and leaves the rest alone
    const u = unpackLook(w + 192);
    assert.deepEqual({ ...u, build: Math.round(u.build * 100) / 100 }, { style: 5, pattern: 2, shorts: 1, longSleeve: 0, bag, umbrella: 1, build: 0.5 });
  }
});
