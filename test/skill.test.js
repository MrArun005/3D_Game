import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkill, SKILL } from '../src/game/skill.js';

const kmh = (k) => k / 3.6;
// heading yaw 0: forward is +X
const car = (over = {}) => ({ x: 0, z: 0, yaw: 0, vx: kmh(90), vz: 0, impact: 0, ...over });

test('near miss: a car beside you at speed scores once, then again only after it has gone', () => {
  const sk = createSkill();
  let ev = sk.update(car(), [{ id: 1, x: 0.5, z: 1.8 }], 1 / 60);
  assert.equal(ev.length, 1); assert.equal(ev[0].kind, 'near'); assert.equal(ev[0].mult, 2);
  ev = sk.update(car(), [{ id: 1, x: 0.2, z: 1.8 }], 1 / 60);
  assert.equal(ev.length, 0, 'still beside: not counted twice');
  sk.update(car(), [{ id: 1, x: -20, z: 1.8 }], 1 / 60);   // gone past
  ev = sk.update(car(), [{ id: 1, x: 0, z: 1.8 }], 1 / 60);
  assert.equal(ev[0]?.kind, 'near');
});

test('near miss needs speed and closeness', () => {
  const sk = createSkill();
  assert.equal(sk.update(car({ vx: kmh(40) }), [{ id: 1, x: 0, z: 1.5 }], 1 / 60).length, 0, 'too slow');
  assert.equal(sk.update(car(), [{ id: 2, x: 0, z: 5 }], 1 / 60).length, 0, 'too far');
  assert.equal(sk.update(car(), [{ id: 3, x: 12, z: 1 }], 1 / 60).length, 0, 'ahead, not beside');
});

test('drift: a held slide banks points when it ends; a flick does not', () => {
  const sk = createSkill();
  const slide = car({ vx: kmh(70) * Math.cos(0.5), vz: kmh(70) * Math.sin(0.5) });   // 0.5 rad of slip
  for (let i = 0; i < 90; i++) sk.update(slide, [], 1 / 60);   // 1.5 s
  assert.ok(sk.live().drifting && sk.live().pts > 0);
  const ev = sk.update(car({ vx: kmh(70) }), [], 1 / 60);
  assert.equal(ev[0].kind, 'drift'); assert.ok(ev[0].pts > 40); assert.equal(ev[0].secs, 1.5);
  const sk2 = createSkill();
  for (let i = 0; i < 10; i++) sk2.update(slide, [], 1 / 60);
  assert.equal(sk2.update(car(), [], 1 / 60).length, 0, 'a flick under 0.6 s is not a drift');
});

test('the chain banks as cash after calm, with the multiplier', () => {
  const sk = createSkill();
  sk.update(car(), [{ id: 1, x: 0, z: 1.5 }], 1 / 60);
  sk.update(car(), [{ id: 2, x: 0, z: -1.5 }], 1 / 60);
  let bank = null;
  for (let i = 0; i < 60 * 3 && !bank; i++) bank = sk.update(car(), [], 1 / 60).find((e) => e.kind === 'bank');
  assert.ok(bank, 'banked within 3 s');
  assert.equal(bank.mult, 3);
  assert.equal(bank.total, Math.round(bank.pts * 3));
  assert.equal(bank.cash, Math.round(bank.total * SKILL.cashPerPoint));
  assert.equal(sk.live(), null);
});

test('a crash wipes the unbanked chain', () => {
  const sk = createSkill();
  sk.update(car(), [{ id: 1, x: 0, z: 1.5 }], 1 / 60);
  const ev = sk.update(car({ impact: 5 }), [], 1 / 60);
  assert.equal(ev[0].kind, 'lost');
  assert.equal(sk.live(), null);
  for (let i = 0; i < 300; i++) assert.ok(!sk.update(car(), [], 1 / 60).some((e) => e.kind === 'bank'), 'nothing left to bank');
});

test('reversing is not a drift', () => {
  const sk = createSkill();
  for (let i = 0; i < 120; i++) sk.update(car({ vx: -kmh(50) }), [], 1 / 60);
  assert.equal(sk.live(), null);
});
