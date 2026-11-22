import express from 'express';
import fs from 'node:fs';
import { getDb, save } from './db.js';
import { todayISO, addDays } from './dates.js';
import { buildSeed } from './seed.js';
import { SYMPTOMS, triage, firstAid } from './firstAid.js';
import { handleSms, escapeXml } from './sms.js';
import {
  normId, findWorker, findSite, heatFor, heatForWorker, passport, crewMember, currentSiteId, openAlerts, planForShift, insights,
  publicEmployer, READINESS_FLAGS, LANGUAGES, getSimulatedHeat, setSimulatedHeat,
} from './service.js';
import { raiseAlert, acknowledgeAlert, clearHold } from './alerts.js';
import { startMonitor, setCheckinsDay, checkinsActive, sendCheckinsNow, replyCheckin, recordWearable } from './monitor.js';
import { JOB_CONDITIONS } from './conditions.js';
import { unitFor } from './units.js';
import { searchPlaces, resolveLocation, validCoords, reversePlace, emergencyNumbers } from './location.js';

const app = express();
app.use(express.json());

// The Android app runs from its own origin (http://localhost), so allow cross-origin calls.
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newId = () => 'HP-' + Array.from({ length: 4 }, () => ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]).join('');

function requireWorker(req, res) {
  const worker = findWorker(req.params.id);
  if (!worker) res.status(404).json({ error: 'No passport with that ID' });
  return worker;
}

function requireEmployer(req, res) {
  const employer = getDb().employers.find((e) => e.id === req.params.id);
  if (!employer) res.status(404).json({ error: 'Unknown employer' });
  return employer;
}

app.get('/api/employers', (req, res) => res.json(getDb().employers.map(publicEmployer)));

// ── Worker passport ─────────────────────────────────────────────

app.get('/api/passport/:id', async (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const heat = await heatForWorker(worker, req.query.siteId || null);
  const alerts = openAlerts([worker.id]);
  res.json({ ...passport(worker, heat, { self: true }), heat, alerts });
});

// ── Location: place search, GPS lookup, emergency numbers ───────

app.get('/api/locations/search', async (req, res) => {
  try {
    const places = await searchPlaces(req.query.q);
    res.json(places.map((p) => ({ ...p, emergency: emergencyNumbers(p.countryCode) })));
  } catch (err) {
    res.status(502).json({ error: 'Place search is unavailable right now. Try again, or use your current location.' });
  }
});

app.get('/api/locations/reverse', async (req, res) => {
  const coords = validCoords(req.query.lat, req.query.lon);
  if (!coords) return res.status(400).json({ error: 'Invalid coordinates' });
  const place = await reversePlace(coords.lat, coords.lon);
  res.json({ ...place, emergency: emergencyNumbers(place.countryCode) });
});

app.post('/api/workers/:id/location', async (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const location = await resolveLocation(req.body);
  if (!location) return res.status(400).json({ error: 'Invalid location' });
  worker.location = location;
  save();
  res.json({ location, emergency: emergencyNumbers(location.countryCode) });
});

app.post('/api/workers', async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  // Look the place up before picking an ID, so no other request can take the same ID meanwhile.
  const location = req.body.location ? await resolveLocation(req.body.location) : null;
  const db = getDb();
  let id;
  do id = newId(); while (db.workers.some((w) => w.id === id));
  const phone = String(req.body.phone ?? '').replace(/[^\d+]/g, '') || undefined;
  const worker = { id, name, language: LANGUAGES.includes(req.body.language) ? req.body.language : 'en', phone, ...(location && { location }) };
  db.workers.push(worker);
  save();
  res.status(201).json(worker);
});

app.post('/api/workers/:id/shifts', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const db = getDb();
  const found = findSite(req.body.siteId);
  if (!found) return res.status(400).json({ error: 'Unknown site' });
  const heatMinutes = Number(req.body.heatMinutes);
  const maxHeatIndex = Number(req.body.maxHeatIndex);
  if (!(heatMinutes >= 0 && heatMinutes <= 960) || !(maxHeatIndex > 0 && maxHeatIndex < 150)) {
    return res.status(400).json({ error: 'Heat minutes must be 0–960 and heat index 1–149°F' });
  }
  const date = req.body.date || todayISO();
  // One record per worker, site and day: re-logging updates it.
  const existing = db.shifts.find((s) => s.workerId === worker.id && s.siteId === found.site.id && s.date === date);
  const shift = existing ?? { id: `s${Date.now()}`, workerId: worker.id, employerId: found.employer.id, siteId: found.site.id, date };
  Object.assign(shift, { heatMinutes, maxHeatIndex });
  if (!existing) db.shifts.push(shift);
  save();
  res.status(existing ? 200 : 201).json(shift);
});

// Daily 30-second readiness check.
app.post('/api/workers/:id/check', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const db = getDb();
  const date = todayISO();
  db.checks = db.checks.filter((c) => !(c.workerId === worker.id && c.date === date));
  const check = { workerId: worker.id, date, ...Object.fromEntries(Object.keys(READINESS_FLAGS).map((k) => [k, Boolean(req.body[k])])) };
  db.checks.push(check);
  save();
  res.status(201).json(check);
});

// "I feel sick": triage, first aid, and an alert to every employer the worker shares with.
app.post('/api/workers/:id/alerts', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const symptoms = (req.body.symptoms ?? []).filter((s) => s in SYMPTOMS);
  // The SOS button and the "Call emergency" shortcut send `emergency: true`: someone who taps it may be
  // too confused to pick symptoms, so it is treated as possible heat stroke without inventing any.
  const severity = req.body.emergency === true ? 'emergency' : triage(symptoms);
  // A buddy can report for a worker who may be too confused to do it themselves.
  const reporter = req.body.reportedBy ? findWorker(req.body.reportedBy) : null;
  const alert = raiseAlert(worker, { symptoms, severity, source: 'app', reportedBy: reporter?.id });
  res.status(201).json({ alert, firstAid: firstAid(severity, req.body.lang ?? worker.language, { supervisorAlerted: alert.employers.length > 0, emergencyNumber: alert.emergencyNumber }) });
});

app.post('/api/workers/:id/hold/clear', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const by = String(req.body.by ?? '').trim();
  if (!by) return res.status(400).json({ error: 'Say who cleared this worker' });
  const hold = clearHold(worker.id, by, req.body.note);
  if (!hold) return res.status(404).json({ error: 'No active hold' });
  res.json(hold);
});

app.post('/api/workers/:id/buddy', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const db = getDb();
  const buddy = req.body.buddyId ? findWorker(req.body.buddyId) : null;
  if (req.body.buddyId && (!buddy || buddy.id === worker.id)) return res.status(400).json({ error: 'Pick a different worker as buddy' });
  if (buddy) db.buddies[worker.id] = buddy.id;
  else delete db.buddies[worker.id];
  save();
  res.json({ buddyId: buddy?.id ?? null });
});

app.post('/api/workers/:id/wearable/consent', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  worker.wearableConsent = Boolean(req.body.on);
  if (!worker.wearableConsent) delete getDb().wearables[worker.id];
  save();
  res.json({ wearableConsent: worker.wearableConsent });
});

// Device-agnostic reading endpoint. No real wearable is connected yet.
app.post('/api/workers/:id/wearable', (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  if (!worker.wearableConsent) return res.status(403).json({ error: 'Worker has not turned on wearable sharing' });
  const heartRate = Number(req.body.heartRate);
  const skinTempF = Number(req.body.skinTempF);
  if (!(heartRate > 20 && heartRate < 250) || !(skinTempF > 70 && skinTempF < 115)) {
    return res.status(400).json({ error: 'Reading out of range' });
  }
  res.status(201).json(recordWearable(worker, { heartRate, skinTempF }));
});

app.post('/api/checkins/:id/reply', (req, res) => {
  const checkin = replyCheckin(req.params.id, Boolean(req.body.ok));
  if (!checkin) return res.status(404).json({ error: 'Unknown check-in' });
  res.json(checkin);
});

app.post('/api/alerts/:alertId/acknowledge', (req, res) => {
  const alert = acknowledgeAlert(req.params.alertId, String(req.body.by ?? 'Dashboard').slice(0, 80));
  if (!alert) return res.status(404).json({ error: 'Unknown alert' });
  res.json(alert);
});

app.post('/api/alerts/:alertId/resolve', (req, res) => {
  const alert = getDb().alerts.find((a) => a.id === req.params.alertId);
  if (!alert) return res.status(404).json({ error: 'Unknown alert' });
  alert.resolvedAt = new Date().toISOString();
  alert.resolution = String(req.body.note ?? '').slice(0, 200);
  save();
  res.json(alert);
});

// ── Employer / supervisor ───────────────────────────────────────

app.get('/api/employers/:id/crew', async (req, res) => {
  const employer = requireEmployer(req, res);
  if (!employer) return;
  const db = getDb();
  const heat = await heatFor(req.query.siteId || employer.sites[0].id);
  const ids = db.crews[employer.id] ?? [];
  const crew = ids
    .map((id) => db.workers.find((w) => w.id === id))
    .filter(Boolean)
    .map((w) => crewMember(w, heat, employer));
  const alerts = openAlerts(ids).map((a) => ({ ...a, workerName: db.workers.find((w) => w.id === a.workerId)?.name }));
  res.json({
    employer: publicEmployer(employer), heat, crew, alerts,
    emergency: emergencyNumbers(heat?.site?.countryCode),
    unit: unitFor(heat?.site?.countryCode),
    insights: insights(employer, ids, heat?.utcOffset),
    jobConditions: JOB_CONDITIONS,
    checkinsOn: checkinsActive(employer.id),
  });
});

app.post('/api/sites/:siteId/conditions', (req, res) => {
  const found = findSite(req.params.siteId);
  if (!found) return res.status(404).json({ error: 'Unknown site' });
  const next = { ...found.site.conditions };
  for (const [key, options] of Object.entries(JOB_CONDITIONS)) {
    if (req.body[key] in options) next[key] = req.body[key];
  }
  found.site.conditions = next;
  save();
  res.json(found.site);
});

app.post('/api/employers/:id/checkins', (req, res) => {
  const employer = requireEmployer(req, res);
  if (!employer) return;
  setCheckinsDay(employer.id, Boolean(req.body.on));
  res.json({ checkinsOn: checkinsActive(employer.id) });
});

// Send one round now, so a demo does not have to wait for a peak-heat hour.
app.post('/api/employers/:id/checkins/now', async (req, res) => {
  const employer = requireEmployer(req, res);
  if (!employer) return;
  res.status(201).json({ sent: await sendCheckinsNow(employer) });
});

app.post('/api/employers/:id/crew', (req, res) => {
  const employer = requireEmployer(req, res);
  if (!employer) return;
  const db = getDb();
  const worker = findWorker(req.body.workerId);
  if (!worker) return res.status(404).json({ error: 'No passport with that ID' });
  const crew = (db.crews[employer.id] ??= []);
  if (!crew.includes(worker.id)) crew.push(worker.id);
  save();
  res.status(201).json(worker);
});

app.delete('/api/employers/:id/crew/:workerId', (req, res) => {
  const db = getDb();
  db.crews[req.params.id] = (db.crews[req.params.id] ?? []).filter((id) => id !== normId(req.params.workerId));
  save();
  res.status(204).end();
});

// Compliance record: every heat shift at this employer, with the worker's safe limit that day.
app.get('/api/employers/:id/heat-log.csv', (req, res) => {
  const employer = requireEmployer(req, res);
  if (!employer) return;
  const db = getDb();
  const since = addDays(todayISO(), -Math.min(Number(req.query.days) || 30, 365));
  const rows = [['Date', 'Worker', 'Passport ID', 'Site', 'Heat minutes', 'Max adjusted heat index (F)', 'Acclimatization day', 'Safe limit (min)', 'Over limit', 'Caution flag', 'Medical hold', 'Heat illness reports']];
  const shifts = db.shifts.filter((s) => s.employerId === employer.id && s.date >= since).toSorted((a, b) => a.date.localeCompare(b.date) || a.workerId.localeCompare(b.workerId));
  for (const s of shifts) {
    const worker = db.workers.find((w) => w.id === s.workerId);
    const site = employer.sites.find((x) => x.id === s.siteId);
    const plan = planForShift(s);
    const check = db.checks.find((c) => c.workerId === s.workerId && c.date === s.date);
    // Yes/no only: the reason is the worker's private health information.
    const caution = check && Object.keys(READINESS_FLAGS).some((k) => check[k]) ? 'yes' : 'no';
    const reports = db.alerts.filter((a) => a.workerId === s.workerId && a.createdAt.slice(0, 10) === s.date).map((a) => a.severity).join('; ');
    rows.push([s.date, worker?.name, s.workerId, site?.name, s.heatMinutes, s.maxHeatIndex, plan.level + 1, plan.allowedMinutes, s.heatMinutes > plan.allowedMinutes ? 'YES' : 'no', caution, plan.hold ? 'yes' : 'no', reports]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  res.type('text/csv').attachment(`heat-log-${employer.id}-${todayISO()}.csv`).send(csv);
});

// ── SMS ─────────────────────────────────────────────────────────

// Twilio webhook (set as the number's "A message comes in" URL).
// For production, verify the X-Twilio-Signature header before trusting the request.
app.post('/api/sms/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  const reply = await handleSms(req.body.From, req.body.Body);
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(reply)}</Message></Response>`);
});

// In-app phone simulator for demos.
app.post('/api/sms/simulate', async (req, res) => {
  res.json({ reply: await handleSms(req.body.from, req.body.body) });
});

// ── Demo controls ───────────────────────────────────────────────

app.get('/api/demo/simulate', (req, res) => res.json({ heatIndex: getSimulatedHeat() }));
app.post('/api/demo/simulate', (req, res) => {
  setSimulatedHeat(req.body.heatIndex);
  res.json({ heatIndex: getSimulatedHeat() });
});

app.post('/api/demo/reset', (req, res) => {
  save(buildSeed());
  setSimulatedHeat(null);
  res.status(204).end();
});

// Production: serve the built client.
const dist = new URL('../dist/', import.meta.url);
if (fs.existsSync(dist)) {
  app.use(express.static(dist.pathname));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(new URL('index.html', dist).pathname));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Heat Passport API on http://localhost:${PORT}`);
  startMonitor();
});
