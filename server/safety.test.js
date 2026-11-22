// End-to-end safety rules, with a throwaway database and no network.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heat-passport-'));
process.env.HEAT_DB_FILE = path.join(dir, 'db.json');
globalThis.fetch = async () => {
  throw new Error('no network in tests');
};

const { getDb, save } = await import('./db.js');
const { buildSeed } = await import('./seed.js');
const { handleSms } = await import('./sms.js');
const { raiseAlert, acknowledgeAlert, clearHold } = await import('./alerts.js');
const { tick, sendCheckinsNow, replyCheckin, recordWearable, setCheckinsDay } = await import('./monitor.js');
const service = await import('./service.js');
const { todayPlan, hotStreak } = await import('./acclimatization.js');
const { conditionAdjustment } = await import('./conditions.js');
const { firstAid } = await import('./firstAid.js');
const { findWorker, crewMember, passport, heatFor, insights, kidneyCheck, setSimulatedHeat, siteHour } = service;

const T = '2026-07-20';
const copperline = () => getDb().employers[0];
const flush = () => new Promise((r) => setTimeout(r, 5));
const MINUTE = 60_000;
// Every notification recorded for an alert, as [role, recipient].
const sentTo = (alert, filter = () => true) => (alert.notifications ?? []).filter(filter).map((n) => `${n.role.split(':')[0]}:${n.recipient}`).toSorted();

beforeEach(async () => {
  save(buildSeed());
  setSimulatedHeat(110);
});

test('supervisor view has a caution flag but no daily-check details', async () => {
  const heat = await heatFor('phx-1');
  const member = crewMember(findWorker('HP-AB52'), heat, copperline());
  const json = JSON.stringify(member);
  assert.equal(member.caution, true);
  assert.ok(!('flags' in member) && !('check' in member));
  assert.ok(!/fever|vomiting|diarrhea|stomach|illness makes|"sick"/.test(json), json);
});

test('the worker still sees their own daily-check reason', async () => {
  const heat = await heatFor('phx-1');
  const own = passport(findWorker('HP-AB52'), heat, { self: true });
  assert.deepEqual(own.flags, ['sick']);
  assert.ok(own.plan.reasons.some((r) => r.code === 'readiness'));
});

test('recent illness lowers the limit, but not below 20%', () => {
  const shifts = [1, 2, 3].map((n) => ({ date: `2026-07-${20 - n}`, heatMinutes: 200, maxHeatIndex: 95 }));
  assert.equal(todayPlan(shifts, T, 95, 480, { recentIllness: true }).fraction, 0.6);
  assert.equal(todayPlan([], T, 95, 480, { recentIllness: true }).fraction, 0.2);
});

test('a hold outranks a cool day, and an emergency hold allows no heat work', () => {
  assert.equal(todayPlan([], T, 70, 480, { hold: { severity: 'exhaustion' } }).fraction, 0.2);
  const plan = todayPlan([], T, 70, 480, { hold: { severity: 'emergency' } });
  assert.equal(plan.allowedMinutes, 0);
});

test('a heat illness report limits the next plan until a person clears it', async () => {
  const ray = findWorker('HP-RK90');
  raiseAlert(ray, { symptoms: ['cramps'], severity: 'exhaustion', source: 'app' });
  const heat = await heatFor('phx-1');
  assert.equal(passport(ray, heat).plan.fraction, 0.2);
  assert.equal(clearHold(ray.id, 'Site lead').clearedBy, 'Site lead');
  assert.ok(passport(ray, heat).plan.fraction > 0.2);
});

test('an alert reaches the supervisor with where to send help', async () => {
  const alert = raiseAlert(findWorker('HP-AB52'), { symptoms: ['confusion'], severity: 'emergency', source: 'app' });
  await flush();
  const toSupervisor = alert.notifications.find((n) => n.role.startsWith('supervisor'));
  assert.equal(toSupervisor.recipient, 'copperline');
  assert.match(toSupervisor.text, /HEAT STROKE/);
  assert.match(toSupervisor.text, /Camelback/);
  assert.match(toSupervisor.text, /google\.com\/maps/);
});

test('an alert never includes daily-check details', async () => {
  const alert = raiseAlert(findWorker('HP-AB52'), { severity: 'reported', source: 'sms' });
  await flush();
  assert.ok(alert.notifications.length > 0);
  assert.ok(alert.notifications.every((n) => !/stomach|fever|alcohol|medicine/i.test(n.text)));
});

test('an unacknowledged alert escalates once, to the backup and buddy', async () => {
  const alert = raiseAlert(findWorker('HP-AB52'), { severity: 'exhaustion', source: 'app' });
  await flush();
  assert.deepEqual(sentTo(alert), ['supervisor:copperline']);
  const later = Date.parse(alert.createdAt) + 4 * MINUTE;
  await tick(later);
  assert.deepEqual(sentTo(alert, (n) => n.escalation), ['backup:copperline', `buddy:${getDb().buddies['HP-AB52']}`]);
  assert.ok(alert.notifications.filter((n) => n.escalation).every((n) => /ESCALATED/.test(n.text)));
  const count = alert.notifications.length;
  await tick(later + MINUTE);
  assert.equal(alert.notifications.length, count);
});

test('an acknowledged alert does not escalate', async () => {
  const alert = raiseAlert(findWorker('HP-AB52'), { severity: 'exhaustion', source: 'app' });
  await flush();
  acknowledgeAlert(alert.id, 'Sam');
  await tick(Date.parse(alert.createdAt) + 10 * MINUTE);
  assert.ok(!alert.notifications.some((n) => n.escalation));
});

test('SICK asks one question, and answering 1 upgrades to an emergency', async () => {
  const reply = await handleSms('+16025550152', 'SICK');
  assert.match(reply, /Reply 1/);
  assert.equal(getDb().alerts.at(-1).severity, 'reported');
  const emergency = await handleSms('+16025550152', '1');
  assert.match(emergency, /HEAT STROKE/);
  assert.equal(getDb().alerts.at(-1).severity, 'emergency');
  assert.equal(service.activeHold('HP-AB52').severity, 'emergency');
  await flush();
  assert.ok(getDb().alerts.at(-1).notifications.some((n) => n.role.startsWith('supervisor') && /HEAT STROKE/.test(n.text)));
});

test('answering 2 keeps the report as it was', async () => {
  await handleSms('+16025550152', 'MAL');
  await handleSms('+16025550152', '2');
  assert.equal(getDb().alerts.at(-1).severity, 'reported');
});

test('a coworker can report an emergency in plain words', async () => {
  const reply = await handleSms('+16025550152', 'HP-RK90 collapsed on the roof');
  assert.match(reply, /HEAT STROKE/);
  const alert = getDb().alerts.at(-1);
  assert.equal(alert.workerId, 'HP-RK90');
  assert.equal(alert.reportedBy, 'HP-AB52');
  assert.equal(alert.severity, 'emergency');
});

test('a held worker is never told a full shift is fine', async () => {
  setSimulatedHeat(null);
  raiseAlert(findWorker('HP-RK90'), { severity: 'emergency', source: 'app' });
  const reply = await handleSms('x', 'HP-RK90');
  assert.ok(!/full shift OK/.test(reply), reply);
  assert.match(reply, /max 0m/);
});

test('first aid does not claim the supervisor knows when nobody was told', () => {
  const aid = firstAid('exhaustion', 'en', { supervisorAlerted: false });
  assert.match(aid.steps[0], /No supervisor is connected/);
  assert.ok(!aid.steps.slice(1).some((s) => /supervisor/i.test(s)));
});

test('a missed check-in alerts the supervisor and buddy', async () => {
  await sendCheckinsNow(copperline());
  assert.match(getDb().checkins.find((c) => c.workerId === 'HP-RK90').message, /are you OK/);
  const checkin = getDb().checkins.find((c) => c.workerId === 'HP-DC11');
  await tick(Date.parse(checkin.sentAt) + 6 * MINUTE);
  await flush();
  assert.equal(checkin.status, 'missed');
  const alert = getDb().alerts.find((a) => a.workerId === 'HP-DC11' && a.severity === 'missed');
  assert.ok(alert);
  assert.deepEqual(sentTo(alert), [`buddy:${getDb().buddies['HP-DC11']}`, 'supervisor:copperline']);
  const buddy = findWorker(getDb().buddies['HP-DC11']);
  assert.ok(passport(buddy, null, { self: true }).buddyAlerts.some((a) => a.id === alert.id), 'the buddy sees it on their passport');
  assert.equal(service.activeHold('HP-DC11'), null);
});

test('replying OK closes the check-in, and a late OK closes the missed alert', async () => {
  await sendCheckinsNow(copperline());
  const checkin = getDb().checkins.find((c) => c.workerId === 'HP-DC11');
  await tick(Date.parse(checkin.sentAt) + 6 * MINUTE);
  replyCheckin(checkin.id, true);
  assert.equal(checkin.status, 'ok');
  assert.ok(getDb().alerts.find((a) => a.severity === 'missed' && a.workerId === 'HP-DC11').resolvedAt);
});

test('text OK answers a pending check-in', async () => {
  await sendCheckinsNow(copperline());
  findWorker('HP-RK90').phone = '+16025550190';
  assert.match(await handleSms('+1 602-555-0190', 'ok'), /Thanks/);
  assert.equal(getDb().checkins.find((c) => c.workerId === 'HP-RK90').status, 'ok');
});

test('"I need help" on a check-in raises an alert', async () => {
  await sendCheckinsNow(copperline());
  replyCheckin(getDb().checkins.find((c) => c.workerId === 'HP-DC11').id, false);
  assert.equal(getDb().alerts.at(-1).severity, 'reported');
});

test('check-ins only start for crews marked on shift today', async () => {
  await tick();
  assert.equal(getDb().checkins.length, 0);
  setCheckinsDay('copperline', true);
  assert.equal(getDb().checkinDays.copperline != null, true);
});

test('job conditions raise the working heat index', async () => {
  assert.equal(conditionAdjustment({ sun: 'full', workload: 'heavy', clothing: 'normal' }), 20);
  assert.equal(conditionAdjustment(undefined), 0);
  const heat = await heatFor('phx-1');
  assert.equal(heat.baseIndex, 109); // the shift ends before the 110°F mid-afternoon peak
  assert.equal(heat.planIndex, 129);
  assert.equal(heat.risk.level, 'extreme');
});

test('hot streaks and warm nights add warnings', () => {
  const shifts = [1, 2, 3].map((n) => ({ date: `2026-07-${20 - n}`, heatMinutes: 200, maxHeatIndex: 106 }));
  assert.equal(hotStreak(shifts, T), 3);
  const codes = todayPlan(shifts, T, 106, 480, { nightLowF: 85 }).reasons.map((r) => r.code);
  assert.ok(codes.includes('hotStreak') && codes.includes('warmNight'));
  assert.ok(!todayPlan([], T, 90, 480, { nightLowF: 70 }).reasons.some((r) => r.code === 'warmNight'));
});

test('the demo story still holds with job conditions', async () => {
  const heat = await heatFor('phx-1');
  assert.equal(passport(findWorker('HP-RK90'), heat).plan.fraction, 0.5);
  assert.equal(passport(findWorker('HP-DC11'), heat).plan.allowedMinutes, 96);
  assert.ok(passport(findWorker('HP-RK90'), heat).plan.reasons.some((r) => r.code === 'hotStreak'));
});

test('kidney check suggests a clinic visit after many risky days', () => {
  assert.equal(kidneyCheck('HP-DC11').suggest, false);
  const db = getDb();
  for (let i = 1; i <= 8; i++) db.checks.push({ workerId: 'HP-DC11', date: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), darkUrine: true });
  assert.equal(kidneyCheck('HP-DC11').suggest, true);
});

test('crew trends have no names and are hidden for tiny crews', () => {
  const trends = insights(copperline(), getDb().crews.copperline, '-07:00');
  assert.equal(trends.illnessReports, 3);
  assert.equal(trends.peakHour, 13);
  assert.ok(trends.warnings.includes('illness'));
  assert.ok(!/HP-|Ray|Aisha/.test(JSON.stringify(trends)));
  assert.equal(insights(copperline(), ['HP-RK90'], '-07:00').hidden, true);
});

test('site hour follows the site, not the server', () => {
  assert.equal(siteHour('-07:00', new Date('2026-07-20T20:30:00Z')), 13);
  assert.equal(siteHour('+05:30', new Date('2026-07-20T20:30:00Z')), 2);
});

test('one high wearable reading is ignored, two in a row raise one alert', () => {
  const ray = findWorker('HP-RK90');
  ray.wearableConsent = true;
  const before = getDb().alerts.length;
  recordWearable(ray, { heartRate: 165, skinTempF: 98 });
  assert.equal(getDb().alerts.length, before);
  recordWearable(ray, { heartRate: 170, skinTempF: 98 });
  assert.equal(getDb().alerts.at(-1).severity, 'wearable');
  recordWearable(ray, { heartRate: 170, skinTempF: 98 });
  assert.equal(getDb().alerts.length, before + 1);
  assert.equal(service.activeHold(ray.id), null);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
