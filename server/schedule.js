import { riskLevel } from './heatIndex.js';
import { QUALIFYING_HEAT_INDEX } from './acclimatization.js';

// Suggested shade/cool-down break per hour of heat work, by risk band.
// A starting point for a site's own heat plan, not a regulatory value.
export const BREAK_MINUTES = { lower: 5, moderate: 10, high: 15, extreme: 20 };

// Hour-by-hour plan: cool hours are free, then the worker's heat allowance goes to
// the coolest remaining hours. Everything else is shade, indoor or light work.
export function workSchedule(hours, plan) {
  const minutes = new Map();
  let left = plan.fraction >= 1 ? Infinity : plan.allowedMinutes;
  for (const h of hours) if (h.heatIndex < QUALIFYING_HEAT_INDEX) minutes.set(h.hour, 60);
  const hot = hours.filter((h) => h.heatIndex >= QUALIFYING_HEAT_INDEX).toSorted((a, b) => a.heatIndex - b.heatIndex || a.hour - b.hour);
  for (const h of hot) {
    if (left <= 0) break;
    const m = Math.min(60, left);
    minutes.set(h.hour, m);
    left -= m;
  }
  return hours.map((h) => {
    const risk = riskLevel(h.heatIndex).level;
    const heatMinutes = minutes.get(h.hour) ?? 0;
    return {
      hour: h.hour,
      heatIndex: h.heatIndex,
      risk,
      heatMinutes,
      breakMinutes: heatMinutes && h.heatIndex >= QUALIFYING_HEAT_INDEX ? BREAK_MINUTES[risk] : 0,
    };
  });
}

// A typical summer day curve peaking mid-afternoon, used when simulating a heat wave.
export function syntheticDay(hours, peak) {
  return hours.map((hour) => ({ hour, heatIndex: Math.round(peak - 20 * ((hour - 15) / 9) ** 2) }));
}

export const formatHour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;

// "6–8 AM, 1 PM" style summary of the hours with heat work.
export function heatHoursLabel(schedule) {
  const hours = schedule.filter((s) => s.heatMinutes > 0 && s.heatIndex >= QUALIFYING_HEAT_INDEX).map((s) => s.hour);
  const ranges = [];
  for (const h of hours) {
    const last = ranges.at(-1);
    if (last && last[1] === h - 1) last[1] = h;
    else ranges.push([h, h]);
  }
  return ranges.map(([a, b]) => (a === b ? formatHour(a) : `${formatHour(a)}–${formatHour(b + 1)}`)).join(', ');
}
