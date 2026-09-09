import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTouchDevice, isMobile } from '../src/core/device.js';

test('a desktop with a mouse is neither touch nor mobile', () => {
  const env = { search: '', maxTouchPoints: 0, coarse: false, userAgent: 'Mozilla/5.0 (Macintosh)', innerWidth: 1440, innerHeight: 860 };
  assert.equal(isTouchDevice(env), false);
  assert.equal(isMobile(env), false);
});

test('a phone is touch and mobile; a big touch laptop is touch but not mobile', () => {
  const phone = { search: '', maxTouchPoints: 5, coarse: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0)', innerWidth: 844, innerHeight: 390 };
  assert.equal(isTouchDevice(phone), true);
  assert.equal(isMobile(phone), true);
  const laptop = { search: '', maxTouchPoints: 10, coarse: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', innerWidth: 1920, innerHeight: 1080 };
  assert.equal(isTouchDevice(laptop), true);
  assert.equal(isMobile(laptop), false);
});

test('?mobile and ?desktop override detection', () => {
  const desk = { search: '?mobile', maxTouchPoints: 0, coarse: false, userAgent: '', innerWidth: 1440, innerHeight: 860 };
  assert.equal(isMobile(desk), true);
  const phone = { search: '?desktop', maxTouchPoints: 5, coarse: true, userAgent: 'iPhone', innerWidth: 844, innerHeight: 390 };
  assert.equal(isTouchDevice(phone), false);
  assert.equal(isMobile(phone), false);
});
