'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../app/server.js');

test('ols recovers a perfect line', () => {
  const fit = S.ols([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]);
  assert.ok(fit);
  assert.equal(Math.round(fit.slope * 1e9) / 1e9, 2);
  assert.equal(Math.round(fit.intercept * 1e9) / 1e9, 1);
  assert.equal(Math.round(fit.r2 * 1e9) / 1e9, 1);
});

test('ols needs at least three points', () => {
  assert.equal(S.ols([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null);
});

test('median handles odd and even lengths', () => {
  assert.equal(S.median([3, 1, 2]), 2);
  assert.equal(S.median([4, 1, 3, 2]), 2.5);
});

test('theil-sen resists a single outlier', () => {
  const pts = [];
  for (let i = 0; i < 20; i++) pts.push({ x: i, y: 100 - 2 * i });
  pts[10].y += 30; // 一个离谱的异常值
  const slope = S.theilSen(pts);
  assert.ok(slope < -1.5 && slope > -2.5, 'slope=' + slope);
});

test('holt finds a negative trend on a falling series', () => {
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push({ x: i, y: 180 - 0.2 * i + (i % 3) * 0.1 });
  const fit = S.holt(pts);
  assert.ok(fit);
  assert.ok(fit.trend < 0);
  assert.ok(fit.alpha >= 0.1 && fit.alpha <= 0.35);
});

test('AR(1) rho is floored and inflation widens the interval', () => {
  const res = [];
  for (let i = 0; i < 20; i++) res.push(Math.sin(i / 3) * 0.5);
  const rho = S.ar1Rho(res);
  assert.ok(rho >= S.RHO_FLOOR);
  const x = res.map((_, i) => i);
  const infl = S.ar1Inflation(x, rho);
  assert.ok(infl >= 1);

  const pts = res.map((e, i) => ({ x: i, y: 180 - 0.1 * i + e }));
  const fit = S.withAR1(S.ols(pts), x);
  assert.ok(fit.ciHiAR - fit.ciLoAR > fit.ciHi - fit.ciLo);
});

test('date helpers round-trip', () => {
  assert.equal(S.ymd(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(S.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(S.parseYmd('not-a-date'), null);
});

test('demo data produces a complete stats object', () => {
  const weight = S.readWeight();
  const intake = S.readIntake();
  assert.ok(weight.length >= 10, 'demo data should have records');
  assert.ok(Object.keys(intake).length >= 10, 'demo data should have intake');

  const st = S.computeStats(weight, intake);
  assert.ok(st.n >= 3);
  assert.ok(st.last && st.last.w > 0);
  assert.ok(st.fit && st.fit.slope < 0);
  assert.ok(st.holt && st.holt.level > 0);
  assert.ok(st.forecast && st.forecast.lo < st.forecast.hi);
  assert.ok(Array.isArray(st.methodRows) && st.methodRows.length >= 3);
  assert.equal(typeof st.minDelta, 'number');
  assert.equal(typeof st.daysToHoliday, 'number');
  if (st.oil) assert.equal(st.oil.scenarios.length, 3);
});
