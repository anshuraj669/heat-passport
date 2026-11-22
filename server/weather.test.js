import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast, formatOffset } from './weather.js';

// 3 days of hourly data from local midnight, like Open-Meteo with timezone=auto.
function forecast(startDate, offsetSec, tempF = 95, rh = 50) {
  const time = [];
  for (let d = 0; d < 3; d++) {
    const day = new Date(`${startDate}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + d);
    const iso = day.toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) time.push(`${iso}T${String(h).padStart(2, '0')}:00`);
  }
  return {
    timezone: 'test', utc_offset_seconds: offsetSec,
    hourly: { time, temperature_2m: time.map(() => tempF), relative_humidity_2m: time.map(() => rh) },
  };
}

test('UTC offsets format like ISO times, including half hours', () => {
  assert.equal(formatOffset(19800), '+05:30'); // India
  assert.equal(formatOffset(14400), '+04:00'); // Gulf
  assert.equal(formatOffset(-25200), '-07:00'); // Phoenix
  assert.equal(formatOffset(0), '+00:00');
});

test('forecast starts at the site\'s current local hour, not the server\'s', () => {
  // 18:45 UTC is 00:15 the next day in India (+05:30).
  const now = new Date('2026-11-15T18:45:00Z');
  const india = parseForecast(forecast('2026-11-15', 19800), now);
  assert.equal(india.hourly[0].date, '2026-11-16');
  assert.equal(india.hourly[0].hour, 0);
  assert.equal(india.hourly[0].offset, '+05:30');

  // The same moment is 11:45 in Phoenix (-07:00).
  const phoenix = parseForecast(forecast('2026-11-15', -25200), now);
  assert.equal(phoenix.hourly[0].date, '2026-11-15');
  assert.equal(phoenix.hourly[0].hour, 11);
  assert.equal(phoenix.hourly.length, 48);
});

test('forecast hours carry the heat index and the source name', () => {
  const data = parseForecast(forecast('2026-07-14', 14400, 104, 40), new Date('2026-07-14T06:00:00Z'));
  assert.equal(data.source, 'open-meteo');
  assert.equal(data.now, data.hourly[0].heatIndex);
  assert.ok(data.hourly[0].heatIndex > 104, 'humid heat feels hotter than the air temperature');
});
