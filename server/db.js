// Tiny JSON-file store; good enough for a demo, swap for Postgres later.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSeed } from './seed.js';

// HEAT_DB_FILE lets tests use a throwaway file instead of the demo data.
const FILE = process.env.HEAT_DB_FILE ? pathToFileURL(process.env.HEAT_DB_FILE) : new URL('../data/db.json', import.meta.url);
let db;

export function getDb() {
  if (!db) {
    if (!fs.existsSync(FILE)) save(buildSeed());
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db.checks ??= [];
    db.alerts ??= [];
    db.holds ??= [];
    db.checkins ??= [];
    db.checkinDays ??= {};
    db.buddies ??= {};
    db.pending ??= {};
    db.wearables ??= {};
    delete db.telegram; // the Telegram bot was removed
    // Older demo data has no site countries; the demo sites are all in the US.
    const seedCountry = new Map(buildSeed().employers.flatMap((e) => e.sites.map((s) => [s.id, s.countryCode])));
    for (const site of db.employers.flatMap((e) => e.sites)) site.countryCode ??= seedCountry.get(site.id) ?? null;
  }
  return db;
}

export function save(data = db) {
  db = data;
  fs.mkdirSync(new URL('.', FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
