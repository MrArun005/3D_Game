import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TankVehicle } from '../src/game/tank.js';
import { Debris } from '../src/world/breakables.js';
import { Garage } from '../src/game/garage.js';
import { Hud } from '../src/ui/hud.js';
import { Stats } from '../src/ui/stats.js';

test('1. Tank breakNear passes tank instance with valid velocities and crushes traffic safely', () => {
  const scene = new THREE.Group();
  let breakNearCarPassed = null;
  let breakNearSpeedPassed = null;

  const mockDebris = {
    breakNear: (x, z, r, car, speed) => {
      breakNearCarPassed = car;
      breakNearSpeedPassed = speed;
    },
  };

  const trafficCar = {
    live: true,
    x: 0,
    z: 1,
    mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)),
  };
  const mockTraffic = { cars: [trafficCar] };

  const tank = new TankVehicle(scene, null, mockTraffic, mockDebris, { x: 0, z: 0, yaw: 0 });
  tank.enter({ id: 'player' });

  // Update with full throttle to engage drive and crush physics
  tank.update({ throttle: 1, brake: 0, steer: 0 }, 0.05);

  assert.equal(breakNearCarPassed, tank, 'breakNear must receive the tank vehicle instance');
  assert.equal(typeof breakNearCarPassed.vx, 'number', 'tank.vx must be a valid number');
  assert.ok(breakNearSpeedPassed > 0, 'speed must be passed to breakNear');

  // Traffic car velocity check
  assert.equal(typeof trafficCar.vx, 'number', 'trafficCar.vx must be a valid number, not NaN');
  assert.equal(typeof trafficCar.vz, 'number', 'trafficCar.vz must be a valid number, not NaN');
  assert.ok(Number.isFinite(trafficCar.vx));
  assert.ok(Number.isFinite(trafficCar.vz));
});

test('2. Real Debris.breakNear does not throw TypeError when car is undefined or tank is passed', () => {
  const scene = new THREE.Group();
  const debris = new Debris(scene);

  // Calling breakNear with undefined car or tank instance must not throw
  assert.doesNotThrow(() => {
    debris.breakNear(0, 0, 5, undefined, 12);
  });
  assert.doesNotThrow(() => {
    debris.breakNear(0, 0, 5, { vx: 5, vz: 5 }, 12);
  });
});

test('3. Garage has ownedCars getter and buyCar method', async () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = v; },
  };

  const mockJobs = { cash: 50000, persist: () => {} };
  const mockHud = { flash: () => {} };
  const garage = new Garage(mockJobs, {}, { userData: {} }, null, mockHud);

  assert.ok(Array.isArray(garage.ownedCars), 'ownedCars must be an array');
  assert.ok(garage.ownedCars.includes('q-sports'), 'ownedCars includes default car');

  // Buy a supercar
  const bought = await garage.buyCar('s-corvette-zr1', null, 25000);
  assert.equal(bought, true, 'buyCar should succeed when cash is sufficient');
  assert.ok(garage.ownedCars.includes('s-corvette-zr1'), 'bought car must now be owned');
  assert.equal(garage.cash, 25000, 'cash should be deducted');
});

test('4. HUD accurately branches on vehicleType for helicopter and tank', () => {
  const mockCtx = () => ({
    clearRect: () => {},
    drawImage: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    arc: () => {},
    stroke: () => {},
    fill: () => {},
    fillText: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rotate: () => {},
    translate: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    canvas: { width: 230, height: 230 },
  });

  const mockEl = () => ({
    textContent: '',
    innerHTML: '',
    style: {},
    classList: { add: () => {} },
    appendChild: () => {},
    getContext: mockCtx,
    width: 230,
    height: 230,
  });

  global.document = {
    getElementById: () => mockEl(),
    createElement: () => mockEl(),
    body: { appendChild: () => {} },
  };

  const hud = new Hud();
  hud.kph = { innerHTML: '' };
  hud.gear = { innerHTML: '' };
  hud.flightBanner = { style: {} };

  // Test Helicopter HUD readout
  const heliState = {
    type: 'helicopter',
    fwdSpeed: 15,
    altitudeAboveGround: 42,
    landed: false,
    rotorRpm: 1.0,
    x: 0,
    z: 0,
    yaw: 0,
  };
  hud.update(heliState, { wanted: 0, cars: [], police: [] }, null, null, null);

  assert.equal(hud.flightBanner.style.display, 'flex');
  assert.ok(hud.gear.innerHTML.includes('ALT <b>42m</b> · AIRBORNE'), 'Helicopter altimeter must be rendered');

  // Test Tank HUD readout
  const tankState = {
    type: 'tank',
    fwdSpeed: 8,
    reloadTime: 1.5,
    x: 0,
    z: 0,
    yaw: 0,
  };
  hud.update(tankState, { wanted: 0, cars: [], police: [] }, null, null, null);
  assert.equal(hud.flightBanner.style.display, 'none');
  assert.ok(hud.gear.innerHTML.includes('CANNON <b>1.5s</b>'), 'Tank cannon reload timer must be rendered');
});

test('5. Stats frame profiler does not allocate and sort samples when F3 overlay is closed', () => {
  global.addEventListener = () => {};
  const stats = new Stats();
  stats.on = false; // F3 closed
  stats.frameIndex = 1;

  for (let i = 0; i < 20; i++) {
    stats.samples.push({ ms: Math.random() * 16, cause: 'normal' });
  }

  // With stats.on = false, update() should return before sorting
  stats.update(0.016, null, { info: { render: { calls: 0, triangles: 0, lines: 0, points: 0 } } });

  // samples array should not be modified/sorted in place
  assert.equal(stats.samples.length, 21);
});
