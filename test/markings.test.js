import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { District } from '../src/world/district.js';
import { junctionHalves, ZEBRA_DEPTH } from '../src/game/traffic.js';

/* Road markings (2026-09-24, "correct road markings too"). A crossing sits
   outside the WIDEST road meeting its junction, not outside its own road:
   where a narrow street met an arterial its zebra used to lie in the
   arterial's lanes (1,117 of 5,308 signalled approaches, up to 9 m in). */
const d = new District(JSON.parse(readFileSync(new URL('../public/halstead-bay.district.json', import.meta.url))));

test('junctionHalves is half the widest non-freeway road at each node', () => {
  const edges = [
    { a: 1, b: 2, width: 10, class: 'street' },
    { a: 1, b: 3, width: 28, class: 'arterial' },
    { a: 1, b: 4, width: 40, class: 'freeway' },
  ];
  const m = junctionHalves(edges);
  assert.equal(m.get(1), 14);
  assert.equal(m.get(2), 5);
  assert.equal(m.get(4), undefined);
});

test('no signalled crossing starts inside a road that meets its junction', () => {
  const JH = junctionHalves(d.graph.edges);
  const N = new Map(d.graph.nodes.map((n) => [n.id, n]));
  let n = 0;
  for (const e of d.graph.edges) {
    if (e.class === 'freeway' || e.class === 'ramp') continue;
    for (const id of [e.a, e.b]) {
      const nd = N.get(id);
      if (!nd || (nd.kind !== 'cross' && nd.kind !== 'tee')) continue;
      const jh = Math.max(e.width / 2, JH.get(id));
      const near = jh + 1.2;   // districtWorld #signals: the zebra's near edge
      for (const o of d.graph.edges) {
        if (o === e || (o.a !== id && o.b !== id) || o.class === 'freeway' || o.class === 'ramp') continue;
        assert.ok(near >= o.width / 2 + 1.2 - 1e-9, `edge ${e.id} at node ${id}: crossing at ${near.toFixed(1)} m inside a ${o.width} m road`);
      }
      n++;
    }
  }
  assert.ok(n > 5000, `${n} approaches`);
});
