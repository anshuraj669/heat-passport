// Live hourly heat index from Open-Meteo: worldwide coverage, free, no API key.
// https://open-meteo.com/en/docs
import { heatIndex } from './heatIndex.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MS = 15 * 60 * 1000;
const HOURS_AHEAD = 48;
const cache = new Map();

// 19800 -> "+05:30", -25200 -> "-07:00"
export function formatOffset(seconds) {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

// Turn an Open-Meteo response into hours that start at the site's current hour.
// Open-Meteo gives site-local times ("2026-07-14T06:00") from local midnight, plus the
// site's UTC offset, so each hour carries the site's local date and hour.
export function parseForecast(json, now = new Date()) {
  const { time, temperature_2m: temps, relative_humidity_2m: rhs } = json.hourly;
  const offsetSec = json.utc_offset_seconds ?? 0;
  const offset = formatOffset(offsetSec);
  const localNow = new Date(now.getTime() + offsetSec * 1000).toISOString().slice(0, 13); // "YYYY-MM-DDTHH"

  const hourly = [];
  for (let i = 0; i < time.length && hourly.length < HOURS_AHEAD; i++) {
    if (time[i].slice(0, 13) < localNow || temps[i] == null) continue;
    const tempF = temps[i];
    const rh = rhs[i] ?? 40;
    hourly.push({ date: time[i].slice(0, 10), hour: Number(time[i].slice(11, 13)), offset, tempF, rh, heatIndex: heatIndex(tempF, rh) });
  }
  if (!hourly.length) throw new Error('Open-Meteo returned no upcoming hours');
  return { source: 'open-meteo', timezone: json.timezone ?? null, now: hourly[0].heatIndex, hourly };
}

export async function siteHeat(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  try {
    const url = new URL(API);
    url.search = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: 'temperature_2m,relative_humidity_2m',
      temperature_unit: 'fahrenheit',
      timezone: 'auto', // times in the site's own time zone
      forecast_days: '3', // today from midnight + 2 days covers the next 48 hours
    });
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = parseForecast(await res.json());
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    return { source: 'unavailable', error: err.message, now: null, hourly: [] };
  }
}
