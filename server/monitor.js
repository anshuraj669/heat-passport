// Background safety loop: escalates ignored alerts and runs peak-heat check-ins, because
// someone with heat stroke may be too confused to ask for help.
import { getDb, save } from './db.js';
import { todayISO } from './dates.js';
import { findWorker, heatFor, passport, siteHour } from './service.js';
import { raiseAlert } from './alerts.js';
import { notifyAlert } from './notify.js';

const minutes = (name, fallback) => (Number(process.env[name]) || fallback) * 60_000;
const escalateAfter = () => minutes('ESCALATE_AFTER_MINUTES', 3);
const checkinTimeout = () => minutes('CHECKIN_TIMEOUT_MINUTES', 5);
const TICK_MS = 15_000;
const CHECKIN_HEAT_INDEX = 103; // °F, the OSHA-NIOSH "high" risk band

// Wearable rule of thumb for the prototype; thresholds need clinician review.
const WEARABLE_HR = 150;
const WEARABLE_SKIN_F = 101;
const WEARABLE_WINDOW_MS = 10 * 60_000; // two high readings in a row, to ignore a blip
const WEARABLE_COOLDOWN_MS = 30 * 60_000;

// Check-in question, stored on the check-in so a push/SMS channel can send it as-is.
const TEXT = {
  en: { ask: (n) => `Safety check, ${n}: are you OK? Reply OK, or SICK if you need help.`, ok: 'OK', help: 'I need help' },
  es: { ask: (n) => `Control de seguridad, ${n}: ¿está bien? Responda BIEN, o MAL si necesita ayuda.`, ok: 'Estoy bien', help: 'Necesito ayuda' },
  pt: { ask: (n) => `Verificação de segurança, ${n}: você está bem? Responda BEM, ou MAL se precisar de ajuda.`, ok: 'Estou bem', help: 'Preciso de ajuda' },
};

export const checkinsActive = (employerId) => getDb().checkinDays[employerId] === todayISO();

// Crews do not record who turned up, so a supervisor starts check-ins each day. Otherwise
// someone on a day off would "miss" a check-in and raise a false alarm.
export function setCheckinsDay(employerId, on) {
  const db = getDb();
  if (on) db.checkinDays[employerId] = todayISO();
  else delete db.checkinDays[employerId];
  save();
}

const pendingFor = (workerId) => getDb().checkins.find((c) => c.workerId === workerId && c.status === 'pending');

async function startCheckin(worker, employerId) {
  if (pendingFor(worker.id)) return null;
  const db = getDb();
  const checkin = {
    id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`, workerId: worker.id, employerId,
    sentAt: new Date().toISOString(), status: 'pending', answeredAt: null,
    message: (TEXT[worker.language] ?? TEXT.en).ask(worker.name.split(' ')[0]),
  };
  db.checkins.push(checkin);
  save();
  // The worker's app shows the check-in on its next poll, in their language.
  return checkin;
}

export async function sendCheckinsNow(employer) {
  const db = getDb();
  const started = await Promise.all((db.crews[employer.id] ?? []).map((id) => findWorker(id)).filter(Boolean).map((w) => startCheckin(w, employer.id)));
  return started.filter(Boolean).length;
}

export function replyCheckin(checkinId, ok) {
  const db = getDb();
  const checkin = db.checkins.find((c) => c.id === checkinId);
  if (!checkin) return null;
  const worker = findWorker(checkin.workerId);
  const wasMissed = checkin.status === 'missed';
  if (checkin.status === 'pending' || wasMissed) {
    checkin.status = ok ? 'ok' : 'help';
    checkin.answeredAt = new Date().toISOString();
    if (ok && wasMissed) {
      // A late reply settles the missed alert, so nobody keeps searching.
      const missed = db.alerts.find((a) => a.workerId === checkin.workerId && a.severity === 'missed' && !a.resolvedAt);
      if (missed) { missed.resolvedAt = checkin.answeredAt; missed.resolution = 'Worker replied OK after the check-in window'; }
    }
    save();
    if (!ok && worker) raiseAlert(worker, { severity: 'reported', source: 'checkin' });
  }
  return checkin;
}

export const pendingCheckin = pendingFor;

export function recordWearable(worker, { heartRate, skinTempF }) {
  const db = getDb();
  const now = Date.now();
  const last = db.wearables[worker.id];
  const high = heartRate >= WEARABLE_HR || skinTempF >= WEARABLE_SKIN_F;
  const sustained = high && last?.high && now - Date.parse(last.at) <= WEARABLE_WINDOW_MS;
  const cooledDown = !last?.alertedAt || now - Date.parse(last.alertedAt) >= WEARABLE_COOLDOWN_MS;
  const reading = { at: new Date(now).toISOString(), high, heartRate, skinTempF, alertedAt: last?.alertedAt ?? null };
  if (sustained && cooledDown) {
    reading.alertedAt = reading.at;
    db.wearables[worker.id] = reading;
    const alert = raiseAlert(worker, { severity: 'wearable', source: 'wearable' });
    return { ...reading, alertId: alert.id };
  }
  db.wearables[worker.id] = reading;
  save();
  return reading;
}

async function escalateIgnored(now) {
  const db = getDb();
  const due = db.alerts.filter((a) => {
    const age = now - Date.parse(a.upgradedAt ?? a.createdAt);
    return !a.resolvedAt && !a.acknowledgedAt && !a.escalatedAt && age >= escalateAfter() && age < 24 * 3_600_000;
  });
  for (const alert of due) {
    alert.escalatedAt = new Date(now).toISOString();
    save();
    await notifyAlert(alert, { escalation: true });
  }
}

function expireCheckins(now) {
  const db = getDb();
  for (const c of db.checkins.filter((x) => x.status === 'pending' && now - Date.parse(x.sentAt) >= checkinTimeout())) {
    c.status = 'missed';
    save();
    const worker = findWorker(c.workerId);
    if (worker) raiseAlert(worker, { severity: 'missed', source: 'checkin' });
  }
}

// One check-in per worker per hour, only in hours the plan has them working in high heat.
async function scheduledCheckins(now) {
  const db = getDb();
  for (const employer of db.employers.filter((e) => checkinsActive(e.id))) {
    const heat = await heatFor(employer.sites[0].id);
    if (!heat?.isToday) continue;
    const hour = siteHour(heat.utcOffset, new Date(now));
    for (const worker of (db.crews[employer.id] ?? []).map((id) => findWorker(id)).filter(Boolean)) {
      const slot = passport(worker, heat).schedule.find((h) => h.hour === hour);
      if (!slot?.heatMinutes || slot.heatIndex < CHECKIN_HEAT_INDEX) continue;
      const thisHour = db.checkins.some((c) => c.workerId === worker.id && now - Date.parse(c.sentAt) < 3_600_000);
      if (!thisHour) await startCheckin(worker, employer.id);
    }
  }
}

export async function tick(now = Date.now()) {
  await escalateIgnored(now);
  expireCheckins(now);
  await scheduledCheckins(now);
}

export function startMonitor() {
  let running = false;
  setInterval(async () => {
    if (running) return; // a slow weather call must not stack up ticks
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error('Safety monitor error:', err.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
}
