import test from 'node:test';
import assert from 'node:assert/strict';
import { Jobs } from '../src/game/jobs.js';

/* A street race is a Mission route of 3-4 graph nodes, a par time at 15 m/s
   plus 8 s of grace, and a purse that grows 30% when you beat par by 15%.
   Built against a fake 5x5 grid of junctions 200 m apart, with Math.random
   stubbed: the first draw picks the RACE kind, the rest come from a seeded
   generator so the node picks are deterministic and never fall through. */
function fakeDistrict() {
  const nodes = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) nodes.push({ id: nodes.length, x: 2000 + i * 200, y: 1000 + j * 200, kind: 'cross' });
  return { graph: { nodes, edges: [] }, blocks: [{ x: 2400, y: 1400, district: 'KINGSWAY' }] };
}
function fakeMission() {
  return { listeners: [], pts: null, label: null, index: 0,
    addListener(type, fn) { this.listeners.push(fn); },
    route(pts, label) { this.pts = pts; this.label = label; this.index = 0; },
    stop() {}, setMarkerColor() {} };
}
const hud = { flash() {}, setJob() {} };
const traffic = { wanted: 0, reportCrime() {} };

function withRandom(seq, fn) {
  const real = Math.random;
  let st = 12345;
  const prng = () => { st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0; return st / 4294967296; };
  let n = 0;
  Math.random = () => (n < seq.length ? seq[n++] : prng());
  try { return fn(); } finally { Math.random = real; }
}

test('G rolls a race: 3-4 checkpoints, par at 15 m/s, pickedUp from the start', () => {
  const mission = fakeMission();
  const jobs = new Jobs(mission, traffic, hud, fakeDistrict());
  withRandom([0.8], () => jobs.toggle({ x: 2400, z: 1400 }));   // 0.8 * 4 kinds -> index 3 = race
  const j = jobs.job;
  assert.ok(j, 'a job was taken');
  assert.equal(j.kind, 'race');
  assert.ok(mission.pts.length >= 3 && mission.pts.length <= 4, `${mission.pts.length} checkpoints`);
  assert.match(mission.label, /RACE/);
  assert.equal(j.pickedUp, true, 'no stop-to-load prompts on a race');
  let dist = 0, from = { x: 2400, y: 1400 };
  for (const p of mission.pts) { dist += Math.hypot(p.x - from.x, p.y - from.y); from = p; }
  assert.ok(Math.abs(j.limit - (dist / 15 + 8)) < 1e-6, 'par is distance at 15 m/s plus 8 s');
  assert.equal(j.b, mission.pts[mission.pts.length - 1], 'the drop is the last checkpoint');
  for (let i = 1; i < mission.pts.length; i++) {
    const d = Math.hypot(mission.pts[i].x - mission.pts[i - 1].x, mission.pts[i].y - mission.pts[i - 1].y);
    assert.ok(d >= 150 && d <= 360, `leg ${i} is ${d.toFixed(0)} m`);
  }
});

test('beating par by 15% pays the fast bonus on top of the clean bonus', () => {
  const mission = fakeMission();
  const jobs = new Jobs(mission, traffic, hud, fakeDistrict());
  withRandom([0.8], () => jobs.toggle({ x: 2400, z: 1400 }));
  const j = jobs.job, cash0 = jobs.cash, base = j.pay;
  j.t = j.limit * 0.5;
  for (const fn of mission.listeners) fn();           // Mission fires 'finish' at the last ring
  assert.equal(jobs.job, null, 'job closed');
  assert.equal(jobs.cash - cash0, Math.round((base + 40) * 1.3));
});

test('a slow race still pays, but less', () => {
  const mission = fakeMission();
  const jobs = new Jobs(mission, traffic, hud, fakeDistrict());
  withRandom([0.8], () => jobs.toggle({ x: 2400, z: 1400 }));
  const j = jobs.job, cash0 = jobs.cash, base = j.pay;
  j.t = j.limit * 1.3;                                 // 30% over par
  for (const fn of mission.listeners) fn();
  const paid = jobs.cash - cash0;
  assert.ok(paid > 0 && paid < base, `paid ${paid} of ${base}`);
});
