import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficer, poseOfficer, PoseBlender, lookAt } from '../src/world/officer.js';

test('variety is seeded: the same seed gives the same officer, different seeds differ', () => {
  const a = buildOfficer(3), b = buildOfficer(3);
  assert.deepEqual(a.variety, b.variety);
  const set = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => JSON.stringify(buildOfficer(n).variety)));
  assert.ok(set.size >= 5, `eight seeds should give at least five different builds, got ${set.size}`);
});

test('variety stays within human proportions and a moustache is an eighth mesh only when rolled', () => {
  for (let n = 1; n <= 12; n++) {
    const { group, variety } = buildOfficer(n);
    assert.ok(variety.height >= 0.94 && variety.height <= 1.06);
    assert.ok(variety.build >= 0.92 && variety.build <= 1.08);
    let meshes = 0; group.traverse((o) => { if (o.isMesh) meshes++; });
    assert.equal(meshes, 7 + (variety.moustache ? 1 : 0));
  }
});

test('the blender eases toward a new pose instead of snapping, and arrives', () => {
  const { joints } = buildOfficer(1);
  const ref = buildOfficer(1).joints;            // a second officer gives the pure pose targets
  poseOfficer(ref, 'idle', 0); const idleZ = ref.armR.rotation.z;
  poseOfficer(ref, 'aim', 0);  const aimZ = ref.armR.rotation.z;
  assert.notEqual(idleZ, aimZ);
  const bl = new PoseBlender();
  bl.apply(joints, 'idle', 0, 0.016);              // first apply snaps (warm-up)
  assert.ok(Math.abs(joints.armR.rotation.z - idleZ) < 1e-9);
  bl.apply(joints, 'aim', 0, 0.016, 0.2);          // one 16 ms frame toward aim
  const partway = joints.armR.rotation.z;
  assert.ok(Math.abs(partway - idleZ) < Math.abs(aimZ - idleZ) * 0.5, 'after one frame the arm is still mostly at idle');
  for (let i = 0; i < 120; i++) bl.apply(joints, 'aim', 0, 0.016, 0.2);
  assert.ok(Math.abs(joints.armR.rotation.z - aimZ) < 1e-4, 'after two seconds it has arrived');
});

test('lookAt turns the head and cap together and clamps to a real neck', () => {
  const { joints } = buildOfficer(2);
  poseOfficer(joints, 'aim', 0);
  const h0 = joints.head.rotation.y;
  lookAt(joints, 0.4);
  assert.ok(Math.abs(joints.head.rotation.y - h0 - 0.4) < 1e-9);
  assert.equal(joints.cap.rotation.y, joints.head.rotation.y);
  poseOfficer(joints, 'aim', 0);
  lookAt(joints, 3.0);
  assert.ok(Math.abs(joints.head.rotation.y - h0 - 0.8) < 1e-9, 'clamped at 0.8 rad');
});

test('SWAT dress is a geometry swap on the shared set: different parts, same material, colours on every part', async () => {
  const { buildOfficer, dressOfficer, officerMaterial } = await import('../src/world/officer.js');
  const a = buildOfficer(5), b = buildOfficer(5, { swat: true });
  assert.notEqual(a.joints.cap.geometry, b.joints.cap.geometry);
  assert.notEqual(a.joints.torso.geometry, b.joints.torso.geometry);
  assert.equal(a.joints.head.geometry, b.joints.head.geometry, 'same face');
  for (const j of ['cap', 'torso', 'armL', 'legL']) {
    assert.equal(b.joints[j].material, officerMaterial(), 'one material for all');
    assert.ok(b.joints[j].geometry.attributes.color, `${j} carries vertex colour`);
  }
  dressOfficer(a.joints, true);
  assert.equal(a.joints.torso.geometry, b.joints.torso.geometry, 'dressOfficer swaps to the same shared set');
  assert.equal(a.joints.cap.visible, true, 'the helmet always shows');
});
