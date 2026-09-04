import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildOfficer, poseOfficer, OFFICER_PARTS } from '../src/world/officer.js';
import {
  ARSENAL, WEAPON_KINDS, buildWeaponMesh, spreadFor, heatAfterShot, heatAfterRest,
} from '../src/game/weapons.js';

test('an officer is seven meshes (eight with a moustache), and every one carries UVs and vertex colours', () => {
  const { group } = buildOfficer();
  let meshes = 0, tris = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    assert.ok(g.attributes.uv, 'every mesh needs UVs (CLAUDE.md rule 4)');
    assert.ok(g.attributes.color, 'colour is per-vertex, not per-material');
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  assert.ok(meshes === OFFICER_PARTS || meshes === OFFICER_PARTS + 1, `seven meshes, eight with a moustache, got ${meshes}`);
  assert.ok(tris < 1500, `officer should stay under 1500 triangles, got ${tris}`);
});

test('two officers share geometry and material rather than duplicating them', () => {
  const a = buildOfficer(), b = buildOfficer();
  assert.equal(a.joints.torso.geometry, b.joints.torso.geometry);
  assert.equal(a.joints.head.material, b.joints.head.material);
});

test('every pose is applied without throwing and actually moves the joints', () => {
  const { joints } = buildOfficer();
  const seen = new Set();
  for (const pose of ['idle', 'aim', 'walk', 'cuff', 'fall']) {
    poseOfficer(joints, pose, 0.7);
    seen.add(`${joints.armR.rotation.z.toFixed(3)}|${joints.torso.rotation.z.toFixed(3)}`);
  }
  assert.equal(seen.size, 5, 'each pose should be visibly different from the others');
});

test('aiming raises the weapon arm towards level, and falling puts the body down', () => {
  const { joints } = buildOfficer();
  poseOfficer(joints, 'aim', 0);
  assert.ok(joints.armR.rotation.z < -1.3, 'right arm should come up to level when aiming');
  const standing = joints.torso.position.y;
  poseOfficer(joints, 'fall', 1);
  assert.ok(joints.torso.position.y < standing - 0.4, 'a downed officer drops');
});

test('every weapon builds as one mesh with real UVs', () => {
  for (const kind of WEAPON_KINDS) {
    const m = buildWeaponMesh(kind);
    assert.ok(m.isMesh, `${kind} should be a single mesh, i.e. one draw call`);
    assert.ok(m.geometry.attributes.uv, `${kind} needs UVs`);
    assert.ok(m.geometry.attributes.color, `${kind} needs vertex colours`);
  }
});

test('an unknown weapon id falls back to the pistol instead of throwing', () => {
  const m = buildWeaponMesh('railgun');
  assert.equal(m.geometry, buildWeaponMesh('pistol').geometry);
});

test('spread starts at the weapon rest value and grows to its maximum with heat', () => {
  for (const kind of WEAPON_KINDS) {
    const w = ARSENAL[kind];
    assert.equal(spreadFor(kind, 0), w.restSpread);
    assert.equal(spreadFor(kind, 1), w.maxSpread);
    assert.ok(spreadFor(kind, 0.5) > w.restSpread);
    // out-of-range heat is clamped, not extrapolated
    assert.equal(spreadFor(kind, 5), w.maxSpread);
    assert.equal(spreadFor(kind, -1), w.restSpread);
  }
});

test('firing adds heat, resting removes it, and neither leaves the 0..1 range', () => {
  let h = 0;
  for (let i = 0; i < 200; i++) h = heatAfterShot('smg', h);
  assert.equal(h, 1, 'sustained fire saturates at maximum spread');
  for (let i = 0; i < 200; i++) h = heatAfterRest('smg', h, 0.1);
  assert.equal(h, 0, 'spread recovers fully once you stop');
});

test('the shotgun throws multiple pellets and the rifle throws one', () => {
  assert.ok(ARSENAL.shotgun.pellets > 1);
  assert.equal(ARSENAL.rifle.pellets, 1);
});

test('handling numbers are internally consistent for every weapon', () => {
  for (const kind of WEAPON_KINDS) {
    const w = ARSENAL[kind];
    assert.ok(w.maxSpread > w.restSpread, `${kind}: max spread must exceed rest spread`);
    assert.ok(w.mag > 0 && w.reload > 0 && w.range > 0, `${kind}: magazine, reload and range must be positive`);
    assert.ok(w.muzzle > 0, `${kind}: needs a muzzle offset for the flash`);
  }
});

test('the muzzle offset sits inside the weapon it belongs to', () => {
  for (const kind of WEAPON_KINDS) {
    const g = buildWeaponMesh(kind).geometry;
    g.computeBoundingBox();
    const reach = g.boundingBox.max.x;
    assert.ok(ARSENAL[kind].muzzle <= reach + 0.06,
      `${kind}: muzzle ${ARSENAL[kind].muzzle} should not float past the barrel end ${reach.toFixed(3)}`);
  }
});

test('reserve ammunition: reloads draw from it, switching remembers each magazine, a mag can be added', async () => {
  const { Weapon } = await import('../src/game/weapon.js');
  const fakeScene = { add() {} };
  const w = new Weapon(fakeScene);
  assert.equal(w.reserveNow, ARSENAL.pistol.reserve);
  w.ammo = 2;
  assert.equal(w.reload(), true);
  w.update(ARSENAL.pistol.reload + 0.01);
  assert.equal(w.ammo, ARSENAL.pistol.mag, 'magazine refilled');
  assert.equal(w.reserveNow, ARSENAL.pistol.reserve - (ARSENAL.pistol.mag - 2), 'reserve paid for the difference');
  w.ammo = 5; w.switchTo('rifle'); assert.equal(w.ammo, ARSENAL.rifle.mag);
  w.switchTo('pistol'); assert.equal(w.ammo, 5, 'the pistol still has the five rounds it had');
  w.reserve.pistol = 0; w.ammo = 0;
  assert.equal(w.reload(), false, 'nothing to reload from');
  w.addMag('pistol'); assert.equal(w.ammo, ARSENAL.pistol.mag, 'an empty gun takes the mag directly');
});

test('aiming down sights tightens the cone for the shot without erasing accumulated heat', async () => {
  const { Weapon } = await import('../src/game/weapon.js');
  const w = new Weapon({ add() {} });
  w.switchTo('smg'); w.cool = 0;
  for (let i = 0; i < 6; i++) { w.fire(0, 1, 0, 1, 0, 0, []); w.cool = 0; }
  const heatBefore = w.heat;
  assert.ok(heatBefore > 0.1, 'six SMG rounds build real heat');
  w.spreadMul = 0.45;
  w.fire(0, 1, 0, 1, 0, 0, []);
  assert.ok(w.heat >= heatBefore, 'a shot in ADS adds heat like any other; it does not reset it');
});

test('the arsenal round-trips through serialize/restore', async () => {
  const { Weapon } = await import('../src/game/weapon.js');
  const a = new Weapon({ add() {} }); a.switchTo('rifle'); a.ammo = 7; a.reserve.rifle = 33; a.mags.pistol = 4;
  const b = new Weapon({ add() {} }); assert.equal(b.restore(a.serialize()), true);
  assert.equal(b.kind, 'rifle'); assert.equal(b.ammo, 7); assert.equal(b.reserve.rifle, 33); assert.equal(b.mags.pistol, 4);
  assert.equal(b.restore({ kind: 'bazooka' }), false, 'garbage is refused');
});
