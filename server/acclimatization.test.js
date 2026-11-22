import test from 'node:test';
import assert from 'node:assert/strict';
import { acclimatizationLevel, todayPlan } from './acclimatization.js';
import { heatIndex } from './heatIndex.js';
import { addDays } from './dates.js';

const T = '2026-07-20';
const days = (from, to, hi = 95) => {
  const out = [];
  for (let i = from; i <= to; i++) out.push({ date: addDays(T, -i), heatMinutes: 300, maxHeatIndex: hi });
  return out;
};

test('new worker starts at 20%', () => {
  const plan = todayPlan([], T, 95);
  assert.equal(plan.level, 0);
  assert.equal(plan.allowedMinutes, 96);
  assert.equal(plan.reasons[0].code, 'new');
});

test('each heat day adds 20%', () => {
  assert.equal(todayPlan(days(1, 3), T, 95).fraction, 0.8);
  assert.equal(todayPlan(days(1, 4), T, 95).fraction, 1);
});

test('a weekend off costs nothing', () => {
  assert.equal(acclimatizationLevel([...days(1, 3), ...days(6, 8)], T).level, 6);
});

test('more than a week away resets to zero', () => {
  const plan = todayPlan(days(9, 20), T, 95);
  assert.equal(plan.level, 0);
  assert.equal(plan.reasons[0].code, 'returning');
  assert.equal(plan.reasons[0].days, 8);
});

test('short-hour or cool days do not count', () => {
  const shifts = [{ date: addDays(T, -1), heatMinutes: 30, maxHeatIndex: 99 }, { date: addDays(T, -2), heatMinutes: 300, maxHeatIndex: 75 }];
  assert.equal(acclimatizationLevel(shifts, T).level, 0);
});

test('heat wave halves exposure for acclimatized workers', () => {
  const plan = todayPlan(days(1, 14, 90), T, 108);
  assert.equal(plan.fraction, 0.5);
  assert.ok(plan.reasons.some((r) => r.code === 'heatwave'));
});

test('no limit on a cool day', () => {
  assert.equal(todayPlan([], T, 72).fraction, 1);
});

test('heat index matches NWS table values', () => {
  assert.equal(heatIndex(90, 50), 95);
  assert.equal(heatIndex(100, 40), 109);
  assert.equal(heatIndex(70, 50), 69);
});
