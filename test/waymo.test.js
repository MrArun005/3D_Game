import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildWaymoIPace, ipaceClassify, IPACE_SPEC } from '../src/vehicle/waymo.js';

/* The Waymo Jaguar I-Pace is authored from memory with zero assets, so the
   tests pin the facts that make it read as one: the footprint contract every
   whole-group body honours, the cab-forward glazing, the roof lidar, and the
   rule-4 promise that every mesh carries UVs. */

const car = buildWaymoIPace();
car.updateMatrixWorld(true);
const bb = new THREE.Box3().setFromObject(car);
const size = bb.getSize(new THREE.Vector3());

test('footprint contract: centred, base on y=0, real I-Pace length', () => {
  assert.ok(Math.abs(size.x - IPACE_SPEC.L) < 0.2, `length ${size.x.toFixed(2)}`);
  assert.ok(Math.abs(bb.min.x + bb.max.x) < 0.05, 'centred in x');
  assert.ok(Math.abs(bb.min.z + bb.max.z) < 0.05, 'centred in z');
  assert.ok(Math.abs(bb.min.y) < 0.02, `tyres on the ground, min.y ${bb.min.y.toFixed(3)}`);
  // body 1.90 m wide plus mirrors, never past 2.25
  assert.ok(size.z > 1.7 && size.z < 2.25, `width ${size.z.toFixed(2)}`);
});

test('the top hat: the lidar dome stands proud of the 1.57 m roof', () => {
  assert.ok(size.y > IPACE_SPEC.roofY + 0.25, `height ${size.y.toFixed(2)}`);
  assert.ok(size.y < 2.1, 'but not a mast');
  const dome = car.userData.dome;
  assert.ok(dome, 'dome exposed for the spin hook');
  const dbb = new THREE.Box3().setFromObject(dome);
  assert.ok(dbb.min.y > 1.40, 'dome assembly sits on the roof');
  // centred near the roof peak, over the cabin, not on the bonnet
  const c = dbb.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.z) < 0.05, 'dome on the centreline');
  assert.ok(Math.abs(c.x) < 0.6, `dome over the cabin, x ${c.x.toFixed(2)}`);
});

test('cab-forward glazing: screen starts early, tail glass is high', () => {
  // windscreen mid-height at x=1.8 from the nose
  assert.equal(ipaceClassify(1.8, 0.5, 0.3), 'glass');
  // the hero saloon's screen zone (x>1.58) would still be bonnet here at 1.2
  assert.equal(ipaceClassify(1.2, 0.5, 0.3), 'body');
  // side glass between the raked pillars, none through the B-pillar
  assert.equal(ipaceClassify(2.3, 0.5, 0.8), 'glass');
  assert.equal(ipaceClassify(2.6, 0.5, 0.8), 'body');
  // everything under the beltline is bodywork
  assert.equal(ipaceClassify(2.3, 0.1, 0.8), 'body');
});

/* Both of these were real bugs, caught on screen and fixed. */
test('the windscreen survives the roof cut (rule order)', () => {
  // over the screen the section's TOP is the glass, so hf runs to ~1 there.
  // Cutting the roof (hf > 0.86) before the screen rule painted it all white.
  assert.equal(ipaceClassify(1.8, 0.95, 0.2), 'glass');
  assert.equal(ipaceClassify(4.15, 0.95, 0.2), 'glass');   // backlight, same trap
  // but the roof BETWEEN the screens is still bodywork
  assert.equal(ipaceClassify(3.0, 0.95, 0.2), 'body');
});

test('the nose and tail wear a dark panel proud of the loft cap', () => {
  // loft() caps its own ends but winds them inward, so on a DoubleSide paint
  // both ends read as washed-out grey slabs. The fix is a cladding panel that
  // stands proud enough to win the depth test against that coplanar face.
  const ends = [];
  car.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.max.x - b.min.x < 0.03 && b.max.y < 1.1 && o.material.color.getHex() === 0x14161a) ends.push(b);
  });
  assert.equal(ends.length, 2, 'one dark end panel at each end');
  const xs = ends.map((b) => (b.min.x + b.max.x) / 2).sort((a, b) => a - b);
  assert.ok(xs[0] < -IPACE_SPEC.L / 2, 'tail panel proud of the tail station');
  assert.ok(xs[1] > IPACE_SPEC.L / 2, 'nose panel proud of the nose station');
});

test('rule 4: every mesh in the model carries a real UV attribute', () => {
  let meshes = 0;
  car.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    assert.ok(o.geometry.attributes.uv, `${o.type} without UVs`);
  });
  assert.ok(meshes > 20, `sensor suite + trim present (${meshes} meshes)`);
});

test('four wheels at the corners, wheelbase 2.99 m', () => {
  const ws = car.userData.wheels;
  assert.equal(ws.length, 4);
  const xs = ws.map((w) => w.getWorldPosition(new THREE.Vector3()).x);
  const wbase = Math.max(...xs) - Math.min(...xs);
  assert.ok(Math.abs(wbase - (IPACE_SPEC.axleR - IPACE_SPEC.axleF)) < 0.02, `wheelbase ${wbase.toFixed(2)}`);
});
