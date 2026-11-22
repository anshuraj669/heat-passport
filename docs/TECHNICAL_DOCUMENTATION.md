# Heat Passport: Technical Documentation

**Future Health Digital Innovation Challenge, draft prototype submission**
Version 0.1.0 · 15 November 2026

---

## 1. Summary

Heat Passport is a heat-acclimatization record that belongs to the worker, not the employer, and follows them from job to job.

**The problem.** OSHA reports that almost half of heat-related worker deaths happen on the worker's first day on the job or first day back after time away, and over 70% happen in the first week. Heat adaptation takes 1–2 weeks to build and is mostly lost after a week away. Farmworkers, day laborers, roofers and delivery drivers change employers often, so a new supervisor cannot know whether a "10-year veteran" just spent 8 days away and lost that adaptation. Existing heat apps track the weather or a single employer's crew. None of them follow the worker.

**The solution.** A portable passport (ID + QR code) holds the worker's heat-work history across *all* employers. From that history and the live hourly forecast at the work site, a rules engine based on OSHA guidance works out each worker's safe heat exposure for today and turns it into an hour-by-hour plan. Around that engine sits a safety layer: symptom triage with first aid, supervisor alerts that escalate when ignored, peak-heat check-ins, a buddy system, holds after heat illness, and a compliance heat log.

**Works worldwide.** At sign-up the app reads the phone's location, or the worker types their town. Weather and emergency numbers then follow that place. A worker in Delhi sees ambulance 108 and Delhi's forecast, and a worker in Abu Dhabi gets "Call 998" in their first-aid steps. Temperatures show in °C, except in the few countries that use °F (such as the US).

**Channels.** Mobile web app, a native Android app (same React code via Capacitor) and SMS (Twilio webhook), in English, Spanish and Portuguese.

## 2. Prototype status

| Item | Status |
|---|---|
| Web app (worker passport + supervisor dashboard) | Working |
| Android app (Capacitor) | Working, debug APK builds |
| Acclimatization engine + hour-by-hour scheduler | Working, unit-tested |
| Live weather (Open-Meteo hourly forecast, worldwide) | Working, no API key needed. Checked live for Phoenix, Delhi, Abu Dhabi and Lagos |
| Alert delivery | In-app: supervisor dashboard and the buddy's passport. Push, SMS and voice are planned for the next build (`docs/NOTIFICATION_SERVICE_PLAN.md`) |
| Worker location + local emergency numbers | Working: GPS or city search at sign-up, editable later. 50+ countries in the table, 112 as the fallback |
| SMS | Inbound webhook and an in-app simulator. Outbound SMS comes with the notification service |
| Wearables | API and logic only. No real device is connected (demo button) |
| °C / °F display by country | Working: app, supervisor dashboard and SMS |
| Automated tests | **52 / 52 passing** (`npm test`) |
| Production build | Passing (`npm run build`, 348 kB JS, 112 kB gzipped) |

## 3. Architecture

```
 ┌────────────────────────┐   ┌────────────────────────┐   ┌──────────────────────┐
 │ React web app (Vite)   │   │ Android app            │   │ SMS (Twilio webhook) │
 │ worker + supervisor UI │   │ Capacitor wrapper:     │   │ SICK, OK, passport ID│
 │                        │   │ reminders, QR scan,    │   │ + in-app simulator   │
 │                        │   │ offline cache, share   │   │                      │
 └───────────┬────────────┘   └───────────┬────────────┘   └──────────┬───────────┘
             │  JSON over HTTP (/api/*)   │                           │ inbound       
             └──────────────┬─────────────┘                           │ Twilio webhook
                            ▼                                         ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ Node.js + Express server (server/index.js)                                       │
 │                                                                                  │
 │  service.js ── passport, crew view, privacy filtering, insights, kidney check    │
 │     │                                                                            │
 │     ├─ acclimatization.js  OSHA rules engine: level, today's limit, warnings     │
 │     ├─ schedule.js         spreads the allowance over the coolest hours          │
 │     ├─ heatIndex.js        NWS heat-index formula + OSHA-NIOSH risk bands        │
 │     ├─ conditions.js       sun / workload / clothing adjustment                  │
 │     └─ weather.js ───────► Open-Meteo hourly forecast, worldwide (15-min cache)  │
 │                                                                                  │
 │  location.js city search, GPS → place, emergency numbers by country             │
 │  units.js    °C or °F by country (engine stays in °F)                            │
 │  alerts.js   raise / upgrade / acknowledge alerts, place and clear holds         │
 │  firstAid.js symptom triage + first-aid steps (en/es/pt)                         │
 │  notify.js   who to notify + escalation ──► deliver(): in-app now, push/SMS next │
 │  monitor.js  15-second safety loop: escalation, check-ins, wearable readings     │
 │  sms.js      text channel (plan, SICK, check-in replies)                         │
 │                                                                                  │
 │  db.js ──► data/db.json (JSON file store)                                        │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

### Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, Vite 8, `qrcode.react`, browser Speech Synthesis for the Listen button |
| Mobile | Capacitor 8: Local Notifications, ML Kit barcode scanning, Filesystem, Share |
| Backend | Node.js (ES modules), Express 5 |
| Storage | One JSON file (`data/db.json`), created on first start from relative-date seed data |
| Weather | Open-Meteo forecast API (`api.open-meteo.com`): worldwide, free, no key, times in the site's own time zone |
| Location | City search: Open-Meteo geocoding. GPS → town and country: OpenStreetMap Nominatim. Both free and worldwide, no key. Phone location: browser Geolocation API (Android: location permission) |
| Messaging | Twilio-compatible SMS webhook (inbound). Outbound: in-app now; push/SMS/voice planned |
| Tests | Node's built-in test runner (`node --test`) |

The server has no runtime dependencies other than Express.

## 4. Core algorithms

### 4.1 Acclimatization engine (`server/acclimatization.js`)

Implements OSHA's guidance for new and returning workers.

| Rule | Value | Source |
|---|---|---|
| A day counts as heat work | ≥ 60 min at heat index ≥ 80 °F | Prototype definition |
| Starting exposure (new or returning) | 20% of a normal shift | OSHA |
| Daily increase | +20% per counted day | OSHA |
| Full adaptation | 14 counted days | OSHA (up to 14 days) |
| Short break (≤ 3 days off) | No loss | Prototype default |
| 4–7 days off | Lose 1 level per day | Prototype default |
| > 7 days off | Reset to 0 | OSHA ("absent more than a week") |
| First very hot day (HI ≥ 103 °F and ≥ 10 °F above recent max) | Cut to 50% | OSHA |
| Cool day (HI < 80 °F) | No limit | Prototype default |

**Algorithm.** The engine collects the distinct dates that counted as heat days, then walks each calendar day from the first heat day to yesterday. It adds a level on each heat day (up to 14) and applies the gap rules on days off. This gives `level` (0–14), `daysOff` and `lastHeatDay`. Today's fraction is `min(1, 0.2 × (level + 1))`, adjusted in this order:

1. Cool day: no limit. Heat wave: reduce to 50%.
2. Recent illness from the daily check: −20 percentage points, never below 20%.
3. **Hold** (after a heat-illness report): caps the fraction even on a cool day. Possible heat stroke gives 0% until a medical professional clears the worker. Heat exhaustion or a report without symptoms gives 20%.
4. Warnings only (the limit does not change): 3+ very hot days in a row (HI ≥ 103 °F), or a warm night (low ≥ 80 °F).

The output is `{ level, percent, status, fraction, allowedMinutes, reasons[] }`. Each reason has a machine code (`new`, `returning`, `building`, `heatwave`, `hold`, …) so the client can translate it and show a picture card.

**Why history across employers matters.** Shifts are stored per worker, tagged with an employer. The engine reads *all* of a worker's shifts, so Juan's 10 years of farm work count, and his 8 days away correctly reset him to 20% at a new roofing job.

### 4.2 Heat index and risk (`server/heatIndex.js`, `server/conditions.js`)

- NWS heat index: the simple formula below 80 °F, and the Rothfusz regression with the NWS low- and high-humidity adjustments above that. Tested against NWS table values.
- OSHA-NIOSH Heat Safety Tool risk bands: Lower (< 91), Moderate (91–102), High (103–114), Very High/Extreme (≥ 115), each with protective actions.
- **Job conditions.** Forecasts assume shade and light work, so each site adds °F for sun (shade 0 / partial +7 / full +15, following OSHA's "up to 15 °F"), workload (+0 / +3 / +5) and clothing (+0 / +10).

### 4.3 Hour-by-hour scheduler (`server/schedule.js`)

Input: the site's hourly heat index for the shift, plus today's plan.

1. Hours below 80 °F are free and do not use up the allowance.
2. The remaining hours are sorted coolest first. Allowed minutes are given out 60 at a time until they run out.
3. Each hour of heat work gets a shade break sized to its risk band (5 / 10 / 15 / 20 min per hour).

So a worker on day 1 gets their 96 minutes in the cool early morning, not at 3 PM. Supervisors see the same output as a crew grid.

### 4.4 Triage and first aid (`server/firstAid.js`)

- Symptoms are grouped as **emergency** (confusion, fainting, hot dry skin, seizure) or **exhaustion** (headache, dizziness, nausea, heavy sweating, cramps, weakness, thirst). Any emergency symptom makes the case an emergency.
- First-aid steps follow OSHA/CDC guidance, in en/es/pt.
- If no supervisor is connected, the steps say so and tell the worker to find someone nearby. The app never claims help is coming when nobody was told.
- Text channel (`sms.js`): `SICK` / `MAL` / `AYUDA` … starts a report and one follow-up question ("confused or fainted? 1 = yes"). Words such as *collapsed*, *desmayó* or *911* go straight to emergency.

## 5. Safety layer

### 5.1 Alert lifecycle (`alerts.js`, `notify.js`, `monitor.js`)

```
 raise ─► notify supervisor(s) (+ buddy right away if emergency or missed check-in)
   │
   ├─ worse news? ─► upgrade: severity up, acknowledgement cleared, re-notify
   │
   ├─ "I'm on it" ─► acknowledged (no escalation)
   │
   └─ not acknowledged after ESCALATE_AFTER_MINUTES ─► escalate once to backup contact + buddy
```

- Alert types: `emergency`, `exhaustion`, `reported`, `missed` (check-in), `wearable`.
- An alert message includes the worker, the reporter (if a buddy sent it), symptoms, site name and address, a map link and the time. It **never** includes daily-check answers (covered by a test).
- Every delivery is logged on the alert (role, recipient, channel, time, escalation flag), and the dashboard shows who was notified. Delivery never blocks first aid.
- Delivery goes through one function, `deliver()` in `notify.js`. This build delivers in the app. The next build adds push, SMS and voice there without changing the recipient or escalation rules.
- A heat-illness alert places a **hold**. A hold can only get stricter, and only a person can clear it (`POST /api/workers/:id/hold/clear`).

### 5.2 Background monitor (`monitor.js`)

A 15-second loop that never runs two ticks at once:
- **Escalation** of unacknowledged alerts (once, within 24 hours).
- **Peak-heat check-ins.** For crews the supervisor has marked "on shift today", each worker gets at most one "Are you OK?" per hour, sent only in hours when their plan has them doing heat work at HI ≥ 103 °F. No reply within `CHECKIN_TIMEOUT_MINUTES` creates a `missed` alert to the supervisor and buddy. A late "OK" closes that alert.
- **Wearables.** An alert needs two high readings within 10 minutes (heart rate ≥ 150 bpm or skin temperature ≥ 101 °F), so one bad reading is ignored. After an alert there is a 30-minute cooldown.

### 5.3 Location and emergency numbers (`location.js`)

- **Sign-up.** "Where do you work?" When the worker starts typing their name, the app asks for the phone's location, and there's also a "Use my current location" button. If permission is refused or GPS fails, the worker types their town and picks it from the search results. Approximate location is enough. The worker can change it at any time from the passport.
- **Lookup.** A GPS fix is turned into a town and country with Nominatim (results cached by ~1 km area for 24 h). A place picked from the search already has its country, so no second lookup is needed.
- **Which place is used.** If the worker is checked in to a crew, the **work site** decides the weather and the emergency number. Otherwise the worker's own location does: the app plans a typical 7 AM, 8-hour day there with the Open-Meteo forecast.
- **Emergency numbers.** A table by ISO country code lists the ambulance number first, because heat stroke needs an ambulance, then police and fire. Unknown countries fall back to **112**, which reaches emergency services from most mobile phones, and the app says the numbers couldn't be confirmed. All user-facing text is written with "911" and the local number is swapped in everywhere: app first aid, the offline first-aid fallback, the SOS call button, picture cards, SMS replies and supervisor alerts. Each alert stores the number for its location.
- **Temperature units.** The engine, thresholds and stored data stay in °F, because OSHA and NWS define them in °F (80 °F, 103 °F…), and converting them would introduce rounding drift. The server picks the display unit from the same country as the emergency number: °F for the US, its territories, Liberia, the Bahamas, Belize, the Cayman Islands, Palau, the Marshall Islands and Micronesia, and °C everywhere else, including unknown countries. The passport and crew responses include `unit`. The app converts every reading for display: plan reasons, hourly plan, badges, history and the job-condition offsets (+15 °F → +8 °C). A temperature the worker types in °C is converted back to °F before it is sent. SMS replies are formatted on the server.

### 5.4 Other features

- **Daily check (30 s):** recent illness, alcohol, little sleep, heat-sensitive medicines, dark urine. Supervisors only see a ⚠ caution flag.
- **Kidney prompt:** 8+ risky days in 30 days triggers a private suggestion to get a kidney blood test, with a clinic finder. A risky day is a dark-urine daily check, a heat-illness alert, or 4+ hours of heat work at HI ≥ 103 °F.
- **Crew trends:** nameless 14-day totals, hidden for crews under 3 people so no one can be singled out.
- **Compliance heat log (CSV):** every heat shift with that day's safe limit, flagged when the shift went over the limit, plus caution, hold and illness columns.

## 6. Privacy model

| Data | Worker | Supervisor (with access) |
|---|---|---|
| Acclimatization level, history across employers | ✔ | ✔ only for employers the worker shares with |
| Daily-check answers | ✔ | ✘ caution flag only (`PRIVATE_REASONS` are removed on the server) |
| Kidney prompt | ✔ | ✘ |
| Worker's own location | ✔ | ✘ (supervisors see the work site; an alert from a worker with no site carries their location so help can find them) |
| Alerts | ✔ | ✔ symptoms and location only |
| Crew trends | n/a | Anonymous, crews ≥ 3 only |

Location lookups send coordinates (not names or IDs) to Open-Meteo and Nominatim. The lookup cache is keyed on rounded coordinates.

Employer join codes (which will enroll supervisor devices for notifications) are removed from all public employer responses.

## 7. API reference (main endpoints)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/passport/:id` | Worker passport: plan, schedule, history, heat, open alerts |
| POST | `/api/workers` | Create a passport (new `HP-XXXX` ID), optionally with `location` |
| POST | `/api/workers/:id/location` | Set or change the worker's location |
| GET | `/api/locations/search?q=` | Find a town or city worldwide, with its emergency numbers |
| GET | `/api/locations/reverse?lat=&lon=` | GPS → town, country and emergency numbers |
| POST | `/api/workers/:id/shifts` | Record a shift |
| POST | `/api/workers/:id/check` | Submit the daily check |
| POST | `/api/workers/:id/alerts` | "I feel sick" report (triaged on the server) |
| POST | `/api/workers/:id/hold/clear` | A person clears a hold |
| POST | `/api/workers/:id/buddy` | Pair a buddy |
| POST | `/api/workers/:id/wearable[/consent]` | Wearable readings / opt-in |
| POST | `/api/checkins/:id/reply` | Answer a check-in |
| POST | `/api/alerts/:alertId/acknowledge` · `/resolve` | Alert lifecycle |
| GET | `/api/employers/:id/crew` | Crew grid, hourly heat, insights |
| POST/DELETE | `/api/employers/:id/crew[/:workerId]` | Check a worker in or out by passport ID |
| POST | `/api/sites/:siteId/conditions` | Set sun / workload / clothing |
| POST | `/api/employers/:id/checkins[/now]` | Turn on check-ins for today / send now |
| GET | `/api/employers/:id/heat-log.csv` | Compliance export |
| POST | `/api/sms/twilio` · `/api/sms/simulate` | Text channel |
| POST | `/api/demo/simulate` · `/api/demo/reset` | Demo controls (heat wave, reset) |

## 8. Data model (`data/db.json`)

`employers[]` (with `sites[]`: lat/lon, countryCode, shift start, length, conditions) · `workers[]` (id, name, language, phone, location: lat/lon, name, country, countryCode, source gps|search) · `shifts[]` (workerId, employerId, date, heatMinutes, maxHeatIndex) · `crews{employerId: workerId[]}` · `checks[]` · `alerts[]` · `holds[]` · `checkins[]` · `checkinDays{}` · `buddies{}` · `wearables{}` · `pending{}` (text-triage state).

## 9. Testing

`npm test` runs 52 tests on the engine and the safety logic, including:
- OSHA rules: new worker at 20%, +20% per day, weekend grace, reset after a week, heat-wave 50% cut, no limit on cool days.
- Heat index matches NWS table values.
- Scheduler gives limited time to the coolest hours; cool hours are free.
- Privacy: supervisors never see daily-check details, and alerts never include them.
- Safety: holds outrank cool days; an emergency hold allows 0 minutes; escalation happens exactly once and only if nobody acknowledged; missed check-ins alert the buddy; one high wearable reading is ignored.
- Text triage: `SICK` → question → `1` upgrades to emergency; a coworker can report in plain words.
- Location: a worker with no crew gets weather and emergency numbers for their own place, while the crew site wins when they're on one. Supervisors never see a worker's own location. First aid, alerts and SMS use the local number (e.g. 998 in Abu Dhabi), never a hardcoded 911.
- Units: °C outside the Fahrenheit countries, in the passport and SMS; US sites stay in °F.
- Time zones: the site's hour follows the site, not the server. Forecasts start at the site's local hour, including half-hour offsets such as India (+05:30).

## 10. Running the prototype

```bash
npm install
npm run dev          # API :3001, app http://localhost:5173
npm test
npm run build && npm start   # production-style on http://localhost:3001
```

Optional: set the alert timing values in `.env` (see `.env.example`). Android: `npm run android:apk` (needs JDK 21 and the Android SDK). Demo passports: `HP-JM24`, `HP-ML07`, `HP-AB52`, `HP-DC11`, `HP-RK90`. A 3-minute demo script is in `README.md`.

## 11. Known limitations (prototype)

1. **No authentication.** Anyone with a passport ID can read that passport. Fix: worker PIN or OTP login, employer accounts, and access scoped by sharing consent.
2. **JSON file storage**, single process. Fix: PostgreSQL with an audit log for the compliance record.
3. **Weather provider.** Open-Meteo covers every location, but its free tier is for non-commercial use. A commercial deployment needs an Open-Meteo API plan or a national met service feed. Only `server/weather.js` would change.
4. **QR passports are not signed**, so a record could be forged. Fix: signed QR payloads.
5. **Alerts are delivered in the app only** (dashboard and buddy's passport), so a supervisor has to have the dashboard open. Push, SMS and voice delivery are the next build: see `docs/NOTIFICATION_SERVICE_PLAN.md`.
6. **Clinical thresholds.** Holds, the illness cut, workload and clothing values, check-in, wearable and kidney thresholds are conservative prototype defaults, **not OSHA rules**. They need review by an occupational-health clinician.
7. **Emergency-number table** covers 50+ countries and is prototype data. Every number must be checked with local authorities before release, and some countries have regional numbers (e.g. Saudi Arabia's unified 911 in some regions).
8. **Heat rules.** The rules follow US OSHA guidance everywhere. Regions such as India and the GCC have their own rules (e.g. the UAE midday work ban). Temperatures already display in °C there.
9. CORS is open and the Android build allows cleartext HTTP, both for running the demo on a local network. These must be closed down before production.

## 12. Roadmap

**Next build: notification service.** Push (FCM / web push), then SMS, then voice escalation, behind the existing `deliver()` hook, with delivery receipts and acknowledgement from the notification itself. The full plan is in Appendix A (`docs/NOTIFICATION_SERVICE_PLAN.md`).

Then: Authentication and consent controls → PostgreSQL → signed QR → WhatsApp and voice channels for workers who can't read → region-specific heat rules (India heat action plans, GCC midday work bans) → real wearable integrations → staffing-agency integration → human-reviewed translations, including Indigenous languages → log exports formatted for state heat rules and the proposed OSHA heat standard.

---

*Guidance only. Heat Passport does not replace medical advice or an employer's heat-illness prevention plan.*
