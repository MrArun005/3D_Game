import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character, CHARACTERS, NAMED_CHARACTERS } from '../src/game/character.js';
import { OnFoot } from '../src/game/onfoot.js';

test('1. NAMED_CHARACTERS roster includes Valerie Cross and Maya Lin', () => {
  const valerie = NAMED_CHARACTERS.find(c => c.id === 'valerie');
  assert.ok(valerie, 'Valerie Cross must exist in NAMED_CHARACTERS');
  assert.equal(valerie.name, 'VALERIE CROSS');
  assert.equal(valerie.index, 9, 'Valerie must use female.wardrobe.glb (index 9)');
  assert.equal(CHARACTERS[valerie.index], '/models/avatar/female.wardrobe.glb');

  const maya = NAMED_CHARACTERS.find(c => c.id === 'maya');
  assert.ok(maya, 'Maya Lin must exist in NAMED_CHARACTERS');
  assert.equal(maya.name, 'MAYA LIN');
  assert.equal(maya.index, 2, 'Maya must use civilian_woman.glb (index 2)');
});

test('2. Character class supports jump and runningJump clips and facial morphs', () => {
  const scene = new THREE.Scene();
  const char = new Character(scene, CHARACTERS[9]);
  assert.ok(char, 'Character instantiated');
  assert.equal(char.index, 9);
  assert.equal(typeof char.setMorph, 'function');
  assert.equal(typeof char.update, 'function');

  // Test setMorph with mock morph mesh
  const mockMesh = {
    morphTargetDictionary: { mouthSmile: 0, eyeBlinkLeft: 1, eyeBlinkRight: 2 },
    morphTargetInfluences: [0, 0, 0],
  };
  char.morphMeshes.push(mockMesh);
  char.setMorph('mouthSmile', 0.14);
  assert.equal(mockMesh.morphTargetInfluences[0], 0.14);

  char.setMorph('eyeBlinkLeft', 0.85);
  assert.equal(mockMesh.morphTargetInfluences[1], 0.85);
});

test('3. OnFoot WASD movement is camera-relative and omnidirectional', () => {
  const scene = new THREE.Scene();
  const onFoot = new OnFoot(scene);
  onFoot.active = true;
  onFoot.x = 0; onFoot.y = 0; onFoot.z = 0;
  onFoot.camYaw = 0; // facing +X

  // W: forward along +X
  const cW = { throttle: 1, brake: 0, steer: 0, hold: false, handbrake: 0 };
  for (let i = 0; i < 30; i++) {
    onFoot.update(cW, 0.016, null, null, () => 0);
  }
  assert.ok(onFoot.vx > 2.0, `Forward should accelerate +vx, got ${onFoot.vx}`);
  assert.ok(Math.abs(onFoot.vz) < 0.2, `Forward should keep vz near 0, got ${onFoot.vz}`);

  // S: backward along -X
  onFoot.x = 0; onFoot.z = 0; onFoot.vx = 0; onFoot.vz = 0;
  const cS = { throttle: 0, brake: 1, steer: 0, hold: false, handbrake: 0 };
  for (let i = 0; i < 30; i++) {
    onFoot.update(cS, 0.016, null, null, () => 0);
  }
  assert.ok(onFoot.vx < -2.0, `Backward should accelerate -vx, got ${onFoot.vx}`);

  // A: strafe left (in +Z or -Z depending on coordinates)
  // steer = +1 for A
  onFoot.x = 0; onFoot.z = 0; onFoot.vx = 0; onFoot.vz = 0;
  const cA = { throttle: 0, brake: 0, steer: 1, hold: false, handbrake: 0 };
  for (let i = 0; i < 30; i++) {
    onFoot.update(cA, 0.016, null, null, () => 0);
  }
  assert.ok(onFoot.vz < -2.0, `Strafe A (left) should accelerate -vz, got ${onFoot.vz}`);

  // D: strafe right
  // steer = -1 for D
  onFoot.x = 0; onFoot.z = 0; onFoot.vx = 0; onFoot.vz = 0;
  const cD = { throttle: 0, brake: 0, steer: -1, hold: false, handbrake: 0 };
  for (let i = 0; i < 30; i++) {
    onFoot.update(cD, 0.016, null, null, () => 0);
  }
  assert.ok(onFoot.vz > 2.0, `Strafe D (right) should accelerate +vz, got ${onFoot.vz}`);
});

test('4. OnFoot sprinting accelerates up to ~7.0 m/s with Shift key', () => {
  const scene = new THREE.Scene();
  const onFoot = new OnFoot(scene);
  onFoot.active = true;
  onFoot.camYaw = 0;

  const cRun = { throttle: 1, brake: 0, steer: 0, hold: true, handbrake: 0 };
  for (let i = 0; i < 60; i++) {
    onFoot.update(cRun, 0.016, null, null, () => 0);
  }
  assert.ok(onFoot.vx > 5.5, `Sprinting with Shift should exceed 5.5 m/s, got ${onFoot.vx}`);
});

test('5. OnFoot jumping physics: Space launches jump, gravity pulls down, lands on ground', () => {
  const scene = new THREE.Scene();
  const onFoot = new OnFoot(scene);
  onFoot.active = true;
  onFoot.x = 100; onFoot.z = 200; onFoot.y = 0;
  onFoot.isGrounded = true;

  // Press Space
  const cJump = { throttle: 0, brake: 0, steer: 0, hold: false, handbrake: 1 };
  onFoot.update(cJump, 0.016, null, null, () => 0);

  assert.equal(onFoot.isGrounded, false, 'Jumping should set isGrounded to false');
  assert.ok(onFoot.vy > 5.0, `Launch vertical velocity should be > 5.0, got ${onFoot.vy}`);
  assert.ok(onFoot.y > 0, `Player height should increase above ground, got ${onFoot.y}`);

  // Ascend toward apex
  for (let i = 0; i < 15; i++) {
    onFoot.update({ ...cJump, handbrake: 0 }, 0.016, null, null, () => 0);
  }
  const apexHeight = onFoot.y;
  assert.ok(apexHeight > 0.5, `Apex jump height should be > 0.5m, got ${apexHeight}`);

  // Descend back toward ground
  for (let i = 0; i < 40; i++) {
    onFoot.update({ ...cJump, handbrake: 0 }, 0.016, null, null, () => 0);
  }
  assert.equal(onFoot.isGrounded, true, 'Player should land back on ground');
  assert.equal(onFoot.y, 0, 'Landed player height should match ground height');
  assert.equal(onFoot.vy, 0, 'Vertical velocity should be zeroed upon landing');
});

test('6. OnFoot elevation conformance over kerbs and ramps', () => {
  const scene = new THREE.Scene();
  const onFoot = new OnFoot(scene);
  onFoot.active = true;
  onFoot.x = 0; onFoot.z = 0; onFoot.y = 0;

  // Ground elevation function that rises to 1.5m at x = 10
  const elevationAt = (x) => (x > 5 ? 1.5 : 0);

  const cWalk = { throttle: 1, brake: 0, steer: 0, hold: false, handbrake: 0 };
  for (let i = 0; i < 120; i++) {
    onFoot.update(cWalk, 0.016, null, null, elevationAt);
  }
  assert.ok(onFoot.x > 5, 'Player moved past x = 5');
  assert.ok(onFoot.y > 1.2, `Player elevation should adapt to ground height (1.5), got ${onFoot.y}`);
});

test('7. Shortest-arc smooth turning damping', () => {
  const scene = new THREE.Scene();
  const onFoot = new OnFoot(scene);
  onFoot.active = true;
  onFoot.yaw = 0; // facing 0 rad
  onFoot.vx = 0; onFoot.vz = 4; // moving in direction Math.PI / 2 or -Math.PI / 2

  onFoot.update({ throttle: 0, brake: 0, steer: 0, hold: false, handbrake: 0 }, 0.016, null, null, () => 0);
  assert.notEqual(onFoot.yaw, 0, 'Yaw should interpolate toward velocity direction');
  assert.ok(Math.abs(onFoot.yaw) <= Math.PI, 'Yaw should stay normalized within [-PI, PI]');
});
