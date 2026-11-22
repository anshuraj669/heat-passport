// Acclimatization engine based on OSHA guidance:
// - New workers, and anyone back after more than a week away, start at 20% of a
//   normal heat-exposed shift and add no more than 20% per day.
// - Full physiological adaptation can take up to 14 days.
// - On the first day of a heat wave, even acclimatized workers cut exposure by 50%.
// https://www.osha.gov/heat-exposure/protecting-new-workers
import { addDays, daysBetween } from './dates.js';

export const QUALIFYING_MINUTES = 60; // heat work needed for a day to count
export const QUALIFYING_HEAT_INDEX = 80; // °F
export const FULL_LEVEL = 14; // days to full adaptation
const GRACE_DAYS = 3; // short breaks (weekends) cost nothing
const RESET_AFTER_DAYS = 7; // "absent more than a week" = start over
const HEAT_WAVE_INDEX = 103; // °F, OSHA-NIOSH "high" risk band
const HEAT_WAVE_JUMP = 10; // °F hotter than recent work

// Safety policy below is a conservative prototype default. It is NOT from OSHA and
// needs review by an occupational health clinician before real-world use.
const HOT_DAY_INDEX = 103; // °F, a day this hot counts toward a hot streak
const HOT_STREAK_DAYS = 3; // consecutive hot days before warning about built-up strain
const WARM_NIGHT_F = 80; // overnight low that limits recovery
const MIN_FRACTION = 0.2;
const RECENT_ILLNESS_CUT = 0.2; // fever/vomiting/diarrhea in the last 2 days
const HOLD_FRACTION = { emergency: 0, exhaustion: 0.2, reported: 0.2 };

const isHeatDay = (s) => s.heatMinutes >= QUALIFYING_MINUTES && s.maxHeatIndex >= QUALIFYING_HEAT_INDEX;

// Level = effective days of heat adaptation, 0..FULL_LEVEL, as of the start of `today`.
export function acclimatizationLevel(shifts, today) {
  const heatDays = [...new Set(shifts.filter((s) => s.date < today && isHeatDay(s)).map((s) => s.date))].sort();
  if (!heatDays.length) return { level: 0, daysOff: null, lastHeatDay: null };

  const set = new Set(heatDays);
  let level = 0;
  let daysOff = 0;
  for (let d = heatDays[0]; d < today; d = addDays(d, 1)) {
    if (set.has(d)) {
      level = Math.min(FULL_LEVEL, level + 1);
      daysOff = 0;
    } else {
      daysOff++;
      if (daysOff > RESET_AFTER_DAYS) level = 0;
      else if (daysOff > GRACE_DAYS) level = Math.max(0, level - 1);
    }
  }
  const lastHeatDay = heatDays.at(-1);
  return { level, daysOff: daysBetween(lastHeatDay, today) - 1, lastHeatDay };
}

function recentMaxHeatIndex(shifts, today) {
  const since = addDays(today, -7);
  const recent = shifts.filter((s) => s.date >= since && s.date < today && isHeatDay(s));
  return recent.length ? Math.max(...recent.map((s) => s.maxHeatIndex)) : null;
}

// Consecutive hot working days ending the day before `today`.
export function hotStreak(shifts, today) {
  const hot = new Set(shifts.filter((s) => s.maxHeatIndex >= HOT_DAY_INDEX && s.heatMinutes >= QUALIFYING_MINUTES).map((s) => s.date));
  let days = 0;
  for (let d = addDays(today, -1); hot.has(d); d = addDays(d, -1)) days++;
  return days;
}

export function statusLabel(level) {
  if (level === 0) return 'Not acclimatized';
  if (level < 5) return 'Building';
  if (level < FULL_LEVEL) return 'Mostly acclimatized';
  return 'Fully acclimatized';
}

// Today's safe heat-exposure plan for one worker.
export function todayPlan(shifts, today, forecastHeatIndex, shiftMinutes = 480, { hold = null, recentIllness = false, nightLowF = null } = {}) {
  const { level, daysOff, lastHeatDay } = acclimatizationLevel(shifts, today);
  const reasons = [];
  let fraction = Math.min(1, 0.2 * (level + 1));

  if (level === 0 && lastHeatDay) {
    reasons.push({ code: 'returning', days: daysOff, text: `Back after ${daysOff} days away from heat work. The body loses its heat adaptation after about a week, so OSHA says to restart at 20%.` });
  } else if (level === 0) {
    reasons.push({ code: 'new', text: 'No recent heat work on record. OSHA says new workers start at 20% of a normal heat-exposed shift.' });
  } else if (fraction < 1) {
    reasons.push({ code: 'building', day: level + 1, text: `Day ${level + 1} of acclimatization. Increase heat exposure by no more than 20% per day.` });
  } else {
    reasons.push({ code: 'acclimatized', text: 'Acclimatized: a full shift is OK with normal water, rest and shade breaks.' });
  }

  const recentMax = recentMaxHeatIndex(shifts, today);
  if (forecastHeatIndex != null && forecastHeatIndex < QUALIFYING_HEAT_INDEX) {
    fraction = 1;
    reasons.push({ code: 'cool', heatIndex: forecastHeatIndex, text: `Heat index today is only ${forecastHeatIndex}°F, so no heat-exposure limit is needed.` });
  } else if (
    forecastHeatIndex >= HEAT_WAVE_INDEX && fraction > 0.5 &&
    (recentMax == null || forecastHeatIndex - recentMax >= HEAT_WAVE_JUMP)
  ) {
    fraction = 0.5;
    reasons.push({ code: 'heatwave', heatIndex: forecastHeatIndex, recentMax, text: `Heat wave: today (${forecastHeatIndex}°F) is much hotter than this worker's recent days (${recentMax ?? '—'}°F). OSHA says cut exposure by 50% on the first very hot day.` });
  }

  if (recentIllness && fraction < 1) {
    fraction = Math.max(MIN_FRACTION, Math.round((fraction - RECENT_ILLNESS_CUT) * 10) / 10);
    reasons.push({ code: 'readinessLimit', text: 'Your limit is lower today because of your daily check: recent illness makes dehydration more likely.' });
  }

  // A hold outranks everything else, even a cool day, until a person clears the worker.
  if (hold) {
    fraction = Math.min(fraction, HOLD_FRACTION[hold.severity] ?? MIN_FRACTION);
    reasons.push({
      code: 'hold', severity: hold.severity,
      text: hold.severity === 'emergency'
        ? 'Medical hold after possible heat stroke: no heat work until a medical professional clears you.'
        : 'Hold after a heat illness report: reduced heat work until your supervisor clears you.',
    });
  }

  const streak = hotStreak(shifts, today);
  if (streak >= HOT_STREAK_DAYS && forecastHeatIndex >= QUALIFYING_HEAT_INDEX) {
    reasons.push({ code: 'hotStreak', days: streak, text: `${streak} very hot work days in a row: heat strain builds up. Take every break and watch for symptoms.` });
  }
  if (nightLowF >= WARM_NIGHT_F) {
    reasons.push({ code: 'warmNight', lowF: nightLowF, text: `Warm night ahead of this shift (low of ${nightLowF}°F): the body recovers less. Start slower and drink extra water.` });
  }

  return {
    hold,
    level,
    percent: Math.round((level / FULL_LEVEL) * 100),
    status: statusLabel(level),
    lastHeatDay,
    daysOff,
    recentMaxHeatIndex: recentMax,
    fraction,
    shiftMinutes,
    allowedMinutes: Math.round(fraction * shiftMinutes),
    reasons,
  };
}
