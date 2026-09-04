import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DispatchService } from '../src/game/dispatch.js';

test('DispatchService dispatches helicopter when cash is sufficient and docks fee', () => {
  const scene = new THREE.Group();
  const mockGarage = { cash: 5000 };
  const mockHud = { flash: () => {} };
  const mockAudio = { horn: () => {} };
  const mockWorld = { nearbyBuildings: () => [] };

  const dispatch = new DispatchService(scene, mockWorld, mockGarage, null, null, mockHud, mockAudio);
  const heli = dispatch.dispatchHelicopter({ x: 10, z: 20 });

  assert.ok(heli, 'Helicopter should be created');
  assert.equal(heli.type, 'helicopter');
  assert.equal(mockGarage.cash, 2500, 'Cash should be deducted by $2,500');
  assert.equal(dispatch.dispatchedVehicles.length, 1);
});

test('DispatchService rejects helicopter dispatch when funds are insufficient', () => {
  const scene = new THREE.Group();
  const mockGarage = { cash: 1000 };
  let flashMsg = '';
  const mockHud = { flash: (msg) => { flashMsg = msg; } };

  const dispatch = new DispatchService(scene, null, mockGarage, null, null, mockHud, null);
  const heli = dispatch.dispatchHelicopter({ x: 0, z: 0 });

  assert.equal(heli, null);
  assert.equal(mockGarage.cash, 1000);
  assert.ok(flashMsg.includes('INSUFFICIENT FUNDS'));
});

test('DispatchService dispatches Rhino tank when conditions met', () => {
  const scene = new THREE.Group();
  const mockGarage = { cash: 15000 };
  const mockHud = { flash: () => {} };
  const mockAudio = { horn: () => {} };

  const dispatch = new DispatchService(scene, null, mockGarage, null, null, mockHud, mockAudio);
  const tank = dispatch.dispatchTank({ x: 0, z: 0, yaw: 0 });

  assert.ok(tank, 'Tank should be spawned');
  assert.equal(tank.type, 'tank');
  assert.equal(mockGarage.cash, 3000, 'Cash should be deducted by $12,000');
  assert.equal(dispatch.dispatchedVehicles.length, 1);
});
