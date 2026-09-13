import test from 'node:test';
import assert from 'node:assert/strict';
import { ANGLES, SPOT } from '../src/game/video.js';

test('video mode: every angle is a complete rig with a unique name, and the spot is on the map', () => {
  const names = new Set();
  for (const a of ANGLES) {
    assert.ok(a.name && !names.has(a.name), `duplicate or missing name: ${a.name}`); names.add(a.name);
    for (const k of ['back', 'up', 'aim', 'fov', 'lag']) assert.equal(typeof a.rig[k], 'number', `${a.name}.${k}`);
    assert.ok(a.rig.fov >= 35 && a.rig.fov <= 75, `${a.name}: fov ${a.rig.fov}`);
    if (a.rig.lookBack) assert.ok(a.rig.back > 0, `${a.name}: a look-back shot puts the camera AHEAD with a positive back`);
    if (a.interior) assert.ok(a.rig.side && a.rig.rigid, `${a.name}: interior angles need side + rigid`);
  }
  assert.ok(ANGLES.length >= 5);
  assert.ok(SPOT.x > 0 && SPOT.x < 4200 && SPOT.z > 0 && SPOT.z < 3000 && SPOT.hour >= 16 && SPOT.hour < 18);
});
