// Worker location: weather at their own place, and local emergency numbers everywhere.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heat-passport-loc-'));
process.env.HEAT_DB_FILE = path.join(dir, 'db.json');

const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  if (String(url).includes('nominatim')) {
    return { ok: true, status: 200, json: async () => ({ address: { city: 'New Delhi', state: 'Delhi', country: 'India', country_code: 'in' } }) };
  }
  throw new Error('no network in tests');
};

const { getDb, save } = await import('./db.js');
const { buildSeed } = await import('./seed.js');
const { emergencyNumbers, resolveLocation, validCoords } = await import('./location.js');
const { firstAid } = await import('./firstAid.js');
const { handleSms } = await import('./sms.js');
const { raiseAlert } = await import('./alerts.js');
const { alertText } = await import('./notify.js');
const { findWorker, heatForWorker, passport, crewMember, emergencyFor, setSimulatedHeat } = await import('./service.js');
const { unitFor, formatTemp } = await import('./units.js');

const DELHI = { lat: 28.6139, lon: 77.209, name: 'New Delhi, Delhi, India', country: 'India', countryCode: 'IN', source: 'search' };

beforeEach(() => {
  save(buildSeed());
  requests.length = 0;
  setSimulatedHeat(110);
});

test('emergency numbers follow the country, with 112 when the country is unknown', () => {
  assert.equal(emergencyNumbers('US').primary, '911');
  assert.equal(emergencyNumbers('in').primary, '108');
  assert.equal(emergencyNumbers('AE').primary, '998');
  assert.equal(emergencyNumbers('GB').primary, '999');
  const unknown = emergencyNumbers(null);
  assert.equal(unknown.primary, '112');
  assert.equal(unknown.unknown, true);
});

test('coordinates are validated', () => {
  assert.deepEqual(validCoords('28.61394', '77.20902'), { lat: 28.6139, lon: 77.209 });
  assert.equal(validCoords(95, 0), null);
  assert.equal(validCoords('', 10), null);
  assert.equal(validCoords('abc', 10), null);
});

test('a place picked from search keeps its country without another lookup', async () => {
  const loc = await resolveLocation(DELHI);
  assert.equal(loc.countryCode, 'IN');
  assert.equal(loc.source, 'search');
  assert.equal(requests.length, 0);
});

test('a GPS fix is looked up to find the town and country', async () => {
  const loc = await resolveLocation({ lat: 28.61, lon: 77.2, source: 'gps' });
  assert.equal(loc.countryCode, 'IN');
  assert.equal(loc.name, 'New Delhi, Delhi, India');
  assert.ok(requests.some((u) => u.includes('nominatim')));
});

test('a worker with no crew gets weather and numbers for their own location', async () => {
  const worker = { id: 'HP-NEW1', name: 'Priya Sharma', language: 'en', location: await resolveLocation(DELHI) };
  getDb().workers.push(worker);
  const heat = await heatForWorker(worker);
  assert.equal(heat.site.name, 'New Delhi, Delhi, India');
  assert.equal(heat.site.lat, 28.6139);
  assert.equal(heat.employer, null);
  const p = passport(worker, heat, { self: true });
  assert.equal(p.emergency.primary, '108');
  assert.equal(p.location.countryCode, 'IN');
  assert.ok(p.schedule.length > 0, 'gets an hour-by-hour plan');
});

test('on a crew, the work site decides the weather and the emergency number', async () => {
  const devon = findWorker('HP-DC11'); // on the Copperline crew in Phoenix
  devon.location = await resolveLocation(DELHI);
  const heat = await heatForWorker(devon);
  assert.equal(heat.site.id, 'phx-1');
  assert.equal(emergencyFor(devon, heat).primary, '911');
});

test('supervisors never see a worker\'s own location', async () => {
  const devon = findWorker('HP-DC11');
  devon.location = await resolveLocation(DELHI);
  const heat = await heatForWorker(devon);
  const member = crewMember(devon, heat, getDb().employers[0]);
  assert.equal(member.worker.location, undefined);
  assert.equal(passport(devon, heat).worker.location, undefined);
});

test('first aid, alerts and texts use the local number instead of 911', async () => {
  const aid = firstAid('emergency', 'en', { emergencyNumber: '108' });
  assert.match(aid.steps[0], /108/);
  assert.ok(!aid.steps.join(' ').includes('911'));

  const worker = { id: 'HP-NEW2', name: 'Ali Hassan', language: 'en', location: { ...DELHI, name: 'Abu Dhabi', countryCode: 'AE', lat: 24.45, lon: 54.38 } };
  getDb().workers.push(worker);
  save();
  const alert = raiseAlert(worker, { symptoms: ['confusion'], severity: 'emergency', source: 'app' });
  assert.equal(alert.emergencyNumber, '998');
  assert.equal(alert.location.name, 'Abu Dhabi');
  assert.match(alertText(alert), /call 998 now/);

  const reply = await handleSms('+971500000000', 'HP-NEW2 collapsed');
  assert.match(reply, /998/);
  assert.ok(!reply.includes('911'));

  const plan = await handleSms('+971500000000', 'HP-NEW2');
  assert.match(plan, /Emergency: call 998/);
});

test('temperatures show in °C outside the few Fahrenheit countries', () => {
  assert.equal(unitFor('US'), 'F');
  assert.equal(unitFor('IN'), 'C');
  assert.equal(unitFor('AE'), 'C');
  assert.equal(unitFor(null), 'C');
  assert.equal(formatTemp(104, 'C'), '40°C');
  assert.equal(formatTemp(104, 'F'), '104°F');
});

test('the passport and texts use the unit of the place shown', async () => {
  const priya = { id: 'HP-NEW3', name: 'Priya Sharma', language: 'en', phone: '+919800000000', location: await resolveLocation(DELHI) };
  getDb().workers.push(priya);
  save();
  const heat = await heatForWorker(priya);
  assert.equal(passport(priya, heat).unit, 'C');
  const text = await handleSms('+919800000000', 'HP-NEW3');
  assert.match(text, /°C/);
  assert.ok(!text.includes('°F'));

  const devon = findWorker('HP-DC11'); // Phoenix crew
  assert.equal(passport(devon, await heatForWorker(devon)).unit, 'F');
});
