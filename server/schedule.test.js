import test from 'node:test';
import assert from 'node:assert/strict';
import { workSchedule, syntheticDay, heatHoursLabel } from './schedule.js';
import { triage } from './firstAid.js';

const day = syntheticDay([6, 7, 8, 9, 10, 11, 12, 13], 110);

test('synthetic day peaks in the afternoon', () => {
  assert.ok(day[0].heatIndex < day.at(-1).heatIndex);
  assert.ok(day.every((h) => h.heatIndex <= 110));
});

test('limited heat time goes to the coolest hours', () => {
  const s = workSchedule(day, { fraction: 0.2, allowedMinutes: 96 });
  assert.deepEqual(s.filter((h) => h.heatMinutes).map((h) => [h.hour, h.heatMinutes]), [[6, 60], [7, 36]]);
  assert.equal(heatHoursLabel(s), '6 AM–8 AM');
});

test('acclimatized workers get every hour, with breaks', () => {
  const s = workSchedule(day, { fraction: 1, allowedMinutes: 480 });
  assert.ok(s.every((h) => h.heatMinutes === 60 && h.breakMinutes > 0));
});

test('cool hours do not use up the heat allowance', () => {
  const hours = [{ hour: 6, heatIndex: 75 }, { hour: 7, heatIndex: 85 }, { hour: 8, heatIndex: 95 }];
  const s = workSchedule(hours, { fraction: 0.2, allowedMinutes: 60 });
  assert.deepEqual(s.map((h) => h.heatMinutes), [60, 60, 0]);
});

test('triage escalates any heat-stroke sign to emergency', () => {
  assert.equal(triage(['headache', 'confusion']), 'emergency');
  assert.equal(triage(['cramps']), 'exhaustion');
  assert.equal(triage([]), 'reported');
});
