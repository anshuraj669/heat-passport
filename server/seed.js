// Demo data, dated relative to today so the story always works on stage.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDays, todayISO } from './dates.js';
import { conditionAdjustment } from './conditions.js';

export function buildSeed(today = todayISO()) {
  const employers = [
    { id: 'copperline', name: 'Copperline Roofing', joinCode: 'COPPER-2841', sites: [{ id: 'phx-1', name: 'Phoenix, AZ – Camelback job', address: 'E Camelback Rd, Phoenix, AZ', countryCode: 'US', lat: 33.5092, lon: -112.0261, shiftStart: 6, shiftHours: 8, conditions: { sun: 'full', workload: 'heavy', clothing: 'normal' } }] },
    { id: 'greenfield', name: 'GreenField Farms', joinCode: 'FIELD-7315', sites: [{ id: 'fresno-12', name: 'Fresno, CA – Field 12', address: 'Field 12, Fresno, CA', countryCode: 'US', lat: 36.7378, lon: -119.7871, shiftStart: 6, shiftHours: 8, conditions: { sun: 'full', workload: 'moderate', clothing: 'normal' } }] },
    { id: 'quickdrop', name: 'QuickDrop Delivery', joinCode: 'DROP-5096', sites: [{ id: 'hou-4', name: 'Houston, TX – Route 4', address: 'Route 4, Houston, TX', countryCode: 'US', lat: 29.7604, lon: -95.3698, shiftStart: 9, shiftHours: 8, conditions: { sun: 'partial', workload: 'moderate', clothing: 'normal' } }] },
  ];

  const workers = [
    { id: 'HP-JM24', name: 'Juan Martinez', language: 'es', phone: '+15595550124', note: '10 years of farm work, just back from a family visit' },
    { id: 'HP-ML07', name: 'Maria Lopez', language: 'es', note: 'Switched from farm work to delivery driving' },
    { id: 'HP-AB52', name: 'Aisha Brown', language: 'en', phone: '+16025550152', note: 'Started 3 days ago' },
    { id: 'HP-DC11', name: 'Devon Carter', language: 'en', note: 'First day on the job' },
    { id: 'HP-RK90', name: 'Ray Kowalski', language: 'en', note: 'Veteran roofer, used to mid-80s/low-90s days' },
  ];

  const shifts = [];
  let n = 0;
  const sites = Object.fromEntries(employers.flatMap((e) => e.sites).map((s) => [s.id, s]));
  // Heat minutes follow OSHA's ramp (20% more per day) from `startDay` of a streak.
  const work = (workerId, employerId, siteId, fromAgo, toAgo, heatIndexes, { skip = [], startDay = 0, minutes = {} } = {}) => {
    let day = startDay;
    for (let ago = fromAgo; ago >= toAgo; ago--) {
      if (skip.includes(ago)) continue;
      shifts.push({
        id: `s${++n}`, workerId, employerId, siteId,
        date: addDays(today, -ago),
        heatMinutes: minutes[ago] ?? Math.min(420, 96 * (day + 1)),
        // Logged the same way the app logs live shifts: adjusted for sun and job.
        maxHeatIndex: heatIndexes[ago % heatIndexes.length] + conditionAdjustment(sites[siteId].conditions),
      });
      day++;
    }
  };

  // Juan: 12 days at GreenField, then 8 days off. Experienced, but adaptation is gone.
  work('HP-JM24', 'greenfield', 'fresno-12', 20, 9, [96, 99, 101, 97]);
  // Maria: two weeks across two employers. Fully adapted, and it carried over.
  work('HP-ML07', 'greenfield', 'fresno-12', 16, 11, [94, 98, 100]);
  work('HP-ML07', 'quickdrop', 'hou-4', 8, 1, [97, 101, 99], { startDay: 6 });
  // Aisha: 3 days in. Day 2 ran long (300 min vs a 192 min limit): the heat log flags it.
  work('HP-AB52', 'copperline', 'phx-1', 3, 1, [92, 95, 98], { minutes: { 2: 300 } });
  // Ray: two weeks of milder heat; a sudden 110°F day is a heat wave for him.
  work('HP-RK90', 'copperline', 'phx-1', 16, 1, [88, 90, 92, 89], { skip: [8, 9] });

  const crews = {
    copperline: ['HP-RK90', 'HP-AB52', 'HP-DC11'],
    greenfield: [],
    quickdrop: ['HP-ML07'],
  };

  // Aisha reported a stomach bug yesterday in her daily check.
  const checks = [{ workerId: 'HP-AB52', date: today, sick: true, alcohol: false, poorSleep: false, meds: false }];

  // Past reports so the crew trends panel has something to show. Afternoon at the site.
  const pastAlert = (workerId, ago, symptoms, n) => ({
    id: `seed-${n}`, workerId, symptoms, severity: 'exhaustion', source: 'app', employers: ['copperline'],
    createdAt: `${addDays(today, -ago)}T20:1${n}:00.000Z`, resolvedAt: `${addDays(today, -ago)}T21:00:00.000Z`, resolution: 'Rested in shade',
  });
  const alerts = [
    pastAlert('HP-RK90', 9, ['headache', 'cramps'], 1),
    pastAlert('HP-AB52', 3, ['dizziness'], 2),
    pastAlert('HP-RK90', 2, ['heavySweating', 'weakness'], 3),
  ];

  // Buddies check on each other, and can report for a worker who cannot.
  const buddies = { 'HP-DC11': 'HP-RK90', 'HP-AB52': 'HP-RK90' };

  return { employers, workers, shifts, crews, checks, alerts, holds: [], checkins: [], checkinDays: {}, buddies, pending: {}, wearables: {} };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('../data/db.json', import.meta.url);
  fs.mkdirSync(new URL('.', file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(buildSeed(), null, 2));
  console.log('Seeded demo data');
}
