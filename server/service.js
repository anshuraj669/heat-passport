// Shared domain logic used by the HTTP API and the SMS channel.
import { getDb } from './db.js';
import { todayISO, addDays } from './dates.js';
import { todayPlan } from './acclimatization.js';
import { conditionAdjustment } from './conditions.js';
import { riskLevel } from './heatIndex.js';
import { siteHeat } from './weather.js';
import { workSchedule, syntheticDay } from './schedule.js';
import { emergencyNumbers } from './location.js';
import { unitFor } from './units.js';

export const LANGUAGES = ['en', 'es', 'pt'];

export const normId = (id) => String(id ?? '').trim().toUpperCase();

export const READINESS_FLAGS = {
  sick: 'Sick in the last 2 days (fever, vomiting or diarrhea): dehydration risk is higher',
  alcohol: 'Drank alcohol in the last 24 hours: dehydration risk is higher',
  poorSleep: 'Slept less than 5 hours: heat tolerance is lower',
  meds: 'Takes medicine that affects heat tolerance (e.g. water pills, some blood pressure or mental-health medicines)',
  darkUrine: 'Dark yellow or brown urine: a sign of dehydration that can strain the kidneys',
};

// Plan reasons that reveal the worker's private daily-check answers.
const PRIVATE_REASONS = new Set(['readiness', 'readinessLimit']);

// Join codes will enroll supervisor devices for notifications, so they stay off public lists.
export const publicEmployer = ({ joinCode, ...employer }) => employer;

// Demo-only: one simulated heat index shared by every view.
let simulatedHeat = null;
export const getSimulatedHeat = () => simulatedHeat;
export const setSimulatedHeat = (v) => { simulatedHeat = v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v); };

export function findWorker(id) {
  return getDb().workers.find((w) => w.id === normId(id)) ?? null;
}

export function findSite(siteId) {
  for (const e of getDb().employers) {
    const site = e.sites.find((s) => s.id === siteId);
    if (site) return { employer: e, site };
  }
  return null;
}

// A worker reached by their phone number.
export function workerByContact(from) {
  const db = getDb();
  const text = String(from ?? '');
  const phone = text.replace(/[^\d+]/g, '');
  return (phone && db.workers.find((w) => w.phone && w.phone.replace(/[^\d+]/g, '') === phone)) || null;
}

// Current hour at a site, from a UTC offset like "-07:00".
export function siteHour(offset, at = new Date()) {
  const m = String(offset ?? '').match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return at.getHours();
  const shift = (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
  return Math.floor((at.getUTCHours() + at.getUTCMinutes() / 60 + shift + 24) % 24);
}

export const employerName = (id) => getDb().employers.find((e) => e.id === id)?.name ?? id;

// Employers whose crew currently includes this worker.
export const sharedWith = (workerId) =>
  getDb().employers.filter((e) => (getDb().crews[e.id] ?? []).includes(workerId)).map((e) => ({ id: e.id, name: e.name }));

// Where the worker is working now: their current crew's site, else their last shift's site.
export function currentSiteId(workerId) {
  const db = getDb();
  const crewEmployer = db.employers.find((e) => (db.crews[e.id] ?? []).includes(workerId));
  if (crewEmployer) return crewEmployer.sites[0].id;
  return db.shifts.filter((s) => s.workerId === workerId).toSorted((a, b) => a.date.localeCompare(b.date)).at(-1)?.siteId ?? null;
}

// The crew site the worker is checked in to today, if any.
export function crewSiteId(workerId) {
  const db = getDb();
  return db.employers.find((e) => (db.crews[e.id] ?? []).includes(workerId))?.sites[0].id ?? null;
}

// A worker with no crew plans their day at their own location, with a typical 7 AM shift.
export function personalSite(worker) {
  const loc = worker.location;
  if (!loc) return null;
  return { id: `me:${worker.id}`, name: loc.name, lat: loc.lat, lon: loc.lon, countryCode: loc.countryCode, shiftStart: 7, shiftHours: 8, personal: true };
}

// Weather for a worker: a chosen site, else today's crew site, else their own location,
// else the site of their last shift.
export async function heatForWorker(worker, siteId = null) {
  if (siteId) return heatFor(siteId);
  const crewSite = crewSiteId(worker.id);
  if (crewSite) return heatFor(crewSite);
  if (worker.location) return heatForSite(personalSite(worker), null);
  const last = currentSiteId(worker.id);
  return last ? heatFor(last) : null;
}

// The country that applies right now: the work site's, else the worker's own location.
export const countryFor = (worker, heat = null) => heat?.site?.countryCode ?? worker.location?.countryCode ?? null;

// Emergency numbers and temperature unit (°C or °F) both follow that country.
export const emergencyFor = (worker, heat = null) => emergencyNumbers(countryFor(worker, heat));
export const tempUnitFor = (worker, heat = null) => unitFor(countryFor(worker, heat));

// Heat for the site's next shift: today if the shift isn't over yet, else tomorrow.
export async function heatFor(siteId) {
  const found = findSite(siteId);
  if (!found) return null;
  return heatForSite(found.site, found.employer);
}

export async function heatForSite(site, employer) {
  const live = await siteHeat(site.lat, site.lon);
  const shiftHours = Array.from({ length: site.shiftHours }, (_, i) => site.shiftStart + i);

  let planDate = todayISO();
  let hours = [];
  if (live.hourly.length) {
    const first = live.hourly[0];
    planDate = first.hour >= site.shiftStart + site.shiftHours - 1 ? addDays(first.date, 1) : first.date;
    hours = live.hourly.filter((h) => h.date === planDate && shiftHours.includes(h.hour));
  }
  const simulated = simulatedHeat;
  if (simulated != null) hours = syntheticDay(shiftHours, simulated);

  // Forecasts assume shade and light work; the job can make it feel much hotter.
  const adjustment = conditionAdjustment(site.conditions);
  hours = hours.map((h) => ({ ...h, baseHeatIndex: h.heatIndex, heatIndex: h.heatIndex + adjustment }));
  const baseIndex = hours.length ? Math.max(...hours.map((h) => h.baseHeatIndex)) : simulated ?? live.now;
  const planIndex = baseIndex == null ? null : baseIndex + adjustment;

  // Overnight low before the shift, used for the warm-night recovery warning.
  const night = live.hourly.filter((h) => h.date === planDate && h.hour <= 5).map((h) => h.tempF);
  const nightLowF = simulated != null ? Math.round(simulated - 25) : night.length ? Math.round(Math.min(...night)) : null;

  return {
    site, employer: employer ? { id: employer.id, name: employer.name } : null,
    source: live.source, now: live.now == null ? null : live.now + adjustment, error: live.error,
    adjustment, baseIndex, nightLowF,
    simulated, planDate, isToday: planDate === todayISO(),
    utcOffset: live.hourly[0]?.offset || null, // site time zone, so phone reminders fire at site time
    hours, planIndex, risk: riskLevel(planIndex),
  };
}

export function latestCheck(workerId) {
  const since = addDays(todayISO(), -1);
  return getDb().checks.filter((c) => c.workerId === workerId && c.date >= since).toSorted((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
}

export function openAlerts(workerIds) {
  const since = Date.now() - 24 * 3600 * 1000;
  return getDb().alerts.filter((a) => workerIds.includes(a.workerId) && !a.resolvedAt && Date.parse(a.createdAt) >= since);
}

// Active hold for a worker. With `onDate`, the hold that was already in force that day.
export function activeHold(workerId, onDate = null) {
  const holds = getDb().holds.filter((h) => h.workerId === workerId);
  if (!onDate) return holds.find((h) => !h.clearedAt) ?? null;
  return holds.find((h) => h.createdAt.slice(0, 10) < onDate && (!h.clearedAt || h.clearedAt.slice(0, 10) >= onDate)) ?? null;
}

// The limit that applied to a logged shift, for the heat log and crew trends.
export function planForShift(s) {
  const db = getDb();
  const site = findSite(s.siteId)?.site;
  const check = db.checks.find((c) => c.workerId === s.workerId && c.date === s.date);
  return todayPlan(db.shifts.filter((x) => x.workerId === s.workerId), s.date, s.maxHeatIndex, (site?.shiftHours ?? 8) * 60, {
    hold: activeHold(s.workerId, s.date),
    recentIllness: Boolean(check?.sick),
  });
}

// Repeated dehydration and heat strain are linked to kidney injury in outdoor workers.
// The thresholds are prototype defaults that need clinician review.
const KIDNEY_WINDOW_DAYS = 30;
const KIDNEY_RISKY_DAYS = 8;
const LONG_HOT_MINUTES = 240;

export function kidneyCheck(workerId) {
  const db = getDb();
  const since = addDays(todayISO(), -KIDNEY_WINDOW_DAYS);
  const risky = new Set([
    ...db.checks.filter((c) => c.workerId === workerId && c.date >= since && c.darkUrine).map((c) => c.date),
    ...db.alerts.filter((a) => a.workerId === workerId && a.createdAt.slice(0, 10) >= since && a.severity !== 'missed').map((a) => a.createdAt.slice(0, 10)),
    ...db.shifts.filter((s) => s.workerId === workerId && s.date >= since && s.maxHeatIndex >= 103 && s.heatMinutes >= LONG_HOT_MINUTES).map((s) => s.date),
  ]);
  return { riskyDays: risky.size, suggest: risky.size >= KIDNEY_RISKY_DAYS };
}

// Crew-level patterns with no names. Hidden for tiny crews, where counts identify people.
const MIN_CREW_FOR_TRENDS = 3;

export function insights(employer, crewIds, utcOffset) {
  if (crewIds.length < MIN_CREW_FOR_TRENDS) return { hidden: true, minCrew: MIN_CREW_FOR_TRENDS };
  const db = getDb();
  const since = addDays(todayISO(), -14);
  const alerts = db.alerts.filter((a) => a.employers.includes(employer.id) && a.createdAt.slice(0, 10) >= since);
  const illness = alerts.filter((a) => ['emergency', 'exhaustion', 'reported'].includes(a.severity));
  const byHour = new Map();
  for (const a of illness) {
    const hour = siteHour(utcOffset, new Date(a.createdAt));
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
  }
  const [peakHour, peakCount] = [...byHour].toSorted((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const overLimitShifts = db.shifts
    .filter((s) => s.employerId === employer.id && s.date >= since)
    .filter((s) => s.heatMinutes > planForShift(s).allowedMinutes).length;
  const missedCheckins = alerts.filter((a) => a.severity === 'missed').length;
  const warnings = [];
  if (illness.length >= 2) warnings.push('illness');
  if (overLimitShifts >= 3) warnings.push('overLimit');
  if (missedCheckins >= 2) warnings.push('missedCheckins');
  return { hidden: false, days: 14, illnessReports: illness.length, peakHour, peakCount, overLimitShifts, missedCheckins, warnings };
}

// `self` includes the worker's private answers. Only the worker's own view may set it.
export function passport(worker, heat, { self = false } = {}) {
  const db = getDb();
  const today = todayISO();
  const shifts = db.shifts.filter((s) => s.workerId === worker.id);
  const planDate = heat?.planDate ?? today;
  const check = latestCheck(worker.id);
  const flags = check ? Object.keys(READINESS_FLAGS).filter((k) => check[k]) : [];
  const plan = todayPlan(shifts, planDate, heat?.planIndex ?? null, (heat?.site.shiftHours ?? 8) * 60, {
    hold: activeHold(worker.id), recentIllness: flags.includes('sick'), nightLowF: heat?.nightLowF,
  });

  if (flags.length) {
    plan.reasons.push({ code: 'readiness', flags, text: `Extra caution today. ${flags.map((f) => READINESS_FLAGS[f]).join('. ')}. Start with lighter work, drink extra water, and check in often.` });
  }

  const timeline = [];
  for (let d = addDays(today, -13); d <= today; d = addDays(d, 1)) {
    const day = shifts.filter((s) => s.date === d);
    timeline.push({
      date: d,
      heatMinutes: day.reduce((m, s) => m + s.heatMinutes, 0),
      maxHeatIndex: day.length ? Math.max(...day.map((s) => s.maxHeatIndex)) : null,
      employers: [...new Set(day.map((s) => employerName(s.employerId)))],
    });
  }

  const { location: _private, ...publicWorker } = worker;
  const common = {
    worker: self ? worker : publicWorker,
    today,
    plan,
    schedule: heat?.hours.length ? workSchedule(heat.hours, plan) : [],
    caution: flags.length > 0,
    timeline,
    employers: [...new Set(shifts.map((s) => employerName(s.employerId)))],
    sharedWith: sharedWith(worker.id),
    lastSiteId: currentSiteId(worker.id),
    emergency: emergencyFor(worker, heat),
    unit: tempUnitFor(worker, heat),
  };
  if (!self) return common;

  const buddy = findWorker(db.buddies[worker.id]);
  return {
    ...common,
    location: worker.location ?? null,
    check,
    flags,
    kidney: kidneyCheck(worker.id),
    buddy: buddy ? { id: buddy.id, name: buddy.name } : null,
    checkin: db.checkins.find((c) => c.workerId === worker.id && c.status === 'pending') ?? null,
    // Open alerts about coworkers that were sent to this worker as their buddy.
    buddyAlerts: db.alerts
      .filter((a) => !a.resolvedAt && (a.notifications ?? []).some((n) => n.role === 'buddy' && n.recipient === worker.id))
      .map((a) => ({ id: a.id, severity: a.severity, workerName: findWorker(a.workerId)?.name, location: a.location, emergencyNumber: a.emergencyNumber, createdAt: a.createdAt })),
  };
}

// What a supervisor may see: never the daily-check answers, only that caution is needed.
export function crewMember(worker, heat, employer) {
  const db = getDb();
  const p = passport(worker, heat);
  const today = todayISO();
  const { name, id, language } = worker;
  return {
    worker: { id, name, language },
    plan: { ...p.plan, reasons: p.plan.reasons.filter((r) => !PRIVATE_REASONS.has(r.code)) },
    timeline: p.timeline,
    schedule: p.schedule,
    caution: p.caution,
    otherEmployers: p.employers.filter((n) => n !== employer.name),
    loggedToday: p.timeline.at(-1).heatMinutes > 0,
    buddyId: db.buddies[worker.id] ?? null,
    checkin: db.checkins.filter((c) => c.workerId === worker.id && c.sentAt.slice(0, 10) === today).at(-1) ?? null,
  };
}

export function createAlert(worker, symptoms, severity, source, reportedBy = null) {
  const db = getDb();
  const found = findSite(currentSiteId(worker.id));
  const alert = {
    id: `a${Date.now()}${Math.floor(Math.random() * 1000)}`, workerId: worker.id, symptoms, severity, source, reportedBy,
    employers: sharedWith(worker.id).map((e) => e.id),
    location: found
      ? { name: found.site.name, address: found.site.address ?? null, lat: found.site.lat, lon: found.site.lon }
      : worker.location ? { name: worker.location.name, address: null, lat: worker.location.lat, lon: worker.location.lon } : null,
    emergencyNumber: emergencyNumbers(found?.site.countryCode ?? worker.location?.countryCode).primary,
    notifications: [],
    createdAt: new Date().toISOString(), resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, escalatedAt: null,
  };
  db.alerts.push(alert);
  return alert;
}
