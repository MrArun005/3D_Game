import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigation } from '../src/game/navigation.js';

test('navigation routes correctly through node 0 and handles destination reaching', () => {
  const fakeDistrict = {
    graph: {
      nodes: [
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 100, y: 0 },
        { id: 2, x: 100, y: 100 },
        { id: 3, x: 100, y: 200 },
      ],
      edges: [
        { a: 0, b: 1, length: 100, points: [[0, 0], [100, 0]] },
        { a: 1, b: 2, length: 100, points: [[100, 0], [100, 100]] },
        { a: 2, b: 3, length: 100, points: [[100, 100], [100, 200]] },
      ],
    },
  };

  const nav = new Navigation(fakeDistrict);

  // Route starting from node 0
  const route0to2 = nav.findRoute(0, 2);
  assert.equal(route0to2.length, 4);
  assert.deepEqual(nav.routeNodes, [0, 1, 2]);

  // Route from node 0 to node 0
  const route0to0 = nav.findRoute(0, 0);
  assert.equal(route0to0.length, 1);
  assert.deepEqual(route0to0[0], [0, 0]);

  // Turn direction test: traveling along X from (0,0) to (100,0), then turning toward (100, 100)
  // car at (80, 0), next is (100, 0), after is (100, 100) -> turn towards +Z
  nav.update({ x: 80, z: 0 }, { x: 100, z: 200 });
  assert.ok(nav.turnInfo, 'should compute turn info within 60m');
  assert.equal(nav.turnInfo.dir, 'RIGHT');
  assert.equal(nav.turnInfo.arrow, '↱');

  // Opposite turn: traveling along X, then turning toward (100, -100) -> turn towards -Z
  const fakeLeftDistrict = {
    graph: {
      nodes: [
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 100, y: 0 },
        { id: 2, x: 100, y: -100 },
        { id: 3, x: 100, y: -200 },
      ],
      edges: [
        { a: 0, b: 1, length: 100, points: [[0, 0], [100, 0]] },
        { a: 1, b: 2, length: 100, points: [[100, 0], [100, -100]] },
        { a: 2, b: 3, length: 100, points: [[100, -100], [100, -200]] },
      ],
    },
  };
  const leftNav = new Navigation(fakeLeftDistrict);
  leftNav.update({ x: 80, z: 0 }, { x: 100, z: -200 });
  assert.ok(leftNav.turnInfo);
  assert.equal(leftNav.turnInfo.dir, 'LEFT');
  assert.equal(leftNav.turnInfo.arrow, '↰');
});
