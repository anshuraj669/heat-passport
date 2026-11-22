# 🔥 Heat Passport

**A heat-acclimatization record that belongs to the worker and travels with them from job to job.**

## The problem

OSHA reports that almost half of heat-related worker deaths happen on a worker's **first day** on the job or their first day back after time away, and **over 70% happen in the first week**. The body needs about 1–2 weeks of gradual exposure to adapt to heat, and loses that adaptation after about a week away.

OSHA's fix is the **20% rule**: new and returning workers start at 20% of a normal heat-exposed shift and add no more than 20% per day.

The gap: farmworkers, day laborers, roofers and gig drivers **switch employers constantly**. A new boss has no way to know that a "10-year veteran" just spent 8 days away and has lost their heat adaptation. Existing heat apps track the weather or an employer's own crew, but none of them follow the worker.

## The solution

**Works anywhere:** at sign-up the app uses the phone's location (or the worker types their town) to show local weather and local emergency numbers, e.g. ambulance 108 in India or 998 in the UAE. First aid and alerts use that number instead of 911, and temperatures show in °C outside the US and the few other °F countries.

**For workers** (mobile web, English/Spanish/Portuguese, works by SMS too)
- **Passport with QR code:** heat adaptation %, a 14-day history across *all* employers, and control over which employers can see it.
- **Hour-by-hour plan:** which hours to work in the heat (the coolest ones) and when to take shade breaks, from the Open-Meteo hourly forecast (worldwide, no API key).
- **🆘 "I feel sick" button:** symptom triage separates possible heat stroke (call 911, cool them fast) from heat exhaustion, shows first-aid steps, and alerts the supervisor instantly.
- **30-second daily check:** recent illness, alcohol, little sleep, heat-sensitive medicines, or dark urine raise the risk. Recent illness also lowers the day's limit. The supervisor sees only a caution flag, never the details.
- **Text messages:** send an ID (or anything, from a registered phone) to get today's plan, or send `SICK` / `MAL` for first aid plus a supervisor alert. One follow-up question spots possible heat stroke, and words like "collapsed" go straight to an emergency.
- **Buddy system:** a paired coworker can report for someone too confused to ask for help (`SICK HP-DC11`, or the button on their own passport).
- **Peak-heat check-ins:** "Are you OK?" during high heat. No reply alerts the buddy and supervisor.
- **Hold after heat illness:** a report reduces the worker's limit until a person clears them. Possible heat stroke means no heat work until a medical professional does.
- **Kidney prompt:** after repeated hard days, a private suggestion to get a kidney blood test, with a low-cost clinic finder.
- **Low-literacy support:** picture cards and a Listen button that reads the plan and first aid aloud.
- **Wearable warnings (opt-in):** an API that takes heart-rate and skin-temperature readings. No real device is connected yet; the passport has a demo button.

**For supervisors**
- **Check-in by passport ID:** the worker's history from other employers carries over.
- **Crew grid:** who works in the heat in which hour, with the site's hourly heat index.
- **Alerts that reach someone:** alerts with symptoms, site address and map link appear on the dashboard right away, and on the buddy's passport for emergencies. "I'm on it" acknowledges them, and ignored alerts escalate to a backup contact and the buddy. Phone push and SMS delivery come in the next build ([plan](docs/NOTIFICATION_SERVICE_PLAN.md)).
- **Job conditions:** sun, workload and clothing raise the working heat index, because forecasts assume shade and light work.
- **Crew trends:** nameless 14-day totals (illness reports, peak hour, over-limit shifts, missed check-ins), hidden for crews under 3.
- **Compliance heat log (CSV):** every heat shift with the worker's safe limit that day, flagged when a shift **went over the limit**, plus caution yes/no, holds and illness reports. This is the record state heat rules (CA, WA, OR, MD, NV) and OSHA inspectors ask for.

**Acclimatization engine** (`server/acclimatization.js`) implements OSHA guidance:
- A day counts when the worker does ≥ 60 min of work at a heat index ≥ 80°F.
- Each counted day adds 20% more allowed exposure; full adaptation is reached at 14 days.
- Up to 3 days off costs nothing, after that one level is lost per day, and more than 7 days off resets to zero.
- On the first very hot day (heat index ≥ 103°F and ≥ 10°F hotter than recent work), exposure is cut to 50%.
- On a cool day (heat index < 80°F), no limit applies.
- Warnings are added after 3 very hot days in a row (heat index ≥ 103°F) or before a shift following a warm night (low ≥ 80°F).

Holds, the recent-illness cut, job-condition values (other than OSHA's "up to 15°F" for full sun), and the check-in, wearable and kidney thresholds are conservative prototype defaults, **not OSHA rules**. They need review by an occupational health clinician before real use.

## Run it

```bash
npm install
npm run dev        # API on :3001, app on http://localhost:5173
npm test           # engine + heat-index tests
```

Production-style: `npm run build && npm start`, then open http://localhost:3001.
Demo data is generated relative to today on first start (`data/db.json`). Run `npm run reset` to restore it. **Existing demo data predates these features, so press Reset demo once.**

## Alert timing

For a live demo, `cp .env.example .env` and set both timing values to `1`, so escalation and missed check-ins happen within a minute.

## Android app

The worker app is a native Android app (Capacitor) built from the same React code.

**What the app adds:** it opens straight to the worker's saved passport, sends phone reminders from the hourly plan (heat work, water at :20/:40, "heat time done", morning daily check) in the work site's time zone, shows the last plan offline, keeps the SOS first aid working with no signal, scans passport QR codes for supervisor check-in, and shares the heat-log CSV through Android's share sheet.

**Build it** (needs the Android SDK and **JDK 21**; newer JDKs can't run this Gradle version):

```bash
cp .env.android.example .env.android   # set VITE_API_URL to your laptop's Wi-Fi IP, e.g. http://192.168.1.20:3001
export JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=$HOME/Android/Sdk
npm run android:apk                     # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:run                     # build + install on an emulator or USB phone
```

**Run the demo on a real phone:** start the server (`npm start`), put the phone on the same Wi-Fi as the laptop, and install the APK (`adb install`, or copy the file to the phone). If the laptop's IP changes, update it in the app under **Settings → Server**.

## 3-minute demo script

1. **Hook:** "Juan has picked crops for 10 years. Today is his first day at a new roofing job in Phoenix. Is he safe to work a full day in the heat?"
2. Open **Supervisor → Copperline Roofing** and turn on **Simulate heat wave** (110°F). Point at the crew grid: The heat index includes +20°F for full sun and heavy work. Devon (first day) works in the heat only 6:00–7:36 AM, while Ray (veteran) is cut to 50% because a heat wave is dangerous even for experienced workers. Aisha has a ⚠ recent-illness flag from her daily check.
3. **Check in `HP-JM24`.** Juan's GreenField Farms history carries over, and the app shows he's been away 8 days, so his adaptation has reset to **20%**. Without the passport, the new boss would have treated him as a veteran on day one.
4. Open **Juan's passport** on a phone, in Spanish: his hour-by-hour plan, the QR code, and who can see his record. Tap **Listen**.
5. On the **SMS** page, text "MAL" from Juan's number, then "1". The dashboard shows a heat-stroke alert with the location. Ignore it, and it escalates to the backup and the buddy.
6. Press **Send check-in now** and don't answer: the buddy and supervisor are alerted, because someone with heat stroke may not be able to ask for help.
7. Download the **heat log CSV**: Aisha's day 2 is flagged "over limit". This is the record employers need for compliance.
8. Close: "Most heat deaths happen in a worker's first week. Heat Passport makes that first week visible, on any phone, in their language."

Use **Reset demo** on the dashboard (or `npm run reset`) between runs.

Demo passports: `HP-JM24` Juan (returning, Spanish, registered phone +1 559-555-0124), `HP-ML07` Maria (changed employers, fully adapted), `HP-AB52` Aisha (day 4, recent illness), `HP-DC11` Devon (new), `HP-RK90` Ray (veteran).

## Notifications

This build delivers alerts in the app: the supervisor dashboard and the buddy's passport. The Twilio inbound webhook is at `POST /api/sms/twilio`. Push, SMS and voice delivery are planned in [docs/NOTIFICATION_SERVICE_PLAN.md](docs/NOTIFICATION_SERVICE_PLAN.md) and plug into `deliver()` in `server/notify.js`.

## Roadmap ideas

- Logins and access control: the API is open, so anyone with a passport ID can read that passport, including daily-check answers
- WhatsApp channel, and voice calls for workers who can't read
- Human-reviewed translations, including Indigenous languages such as Mixteco
- Offline-first PWA for fields with no signal
- Passport verification (signed QR) so records can't be faked
- Staffing-agency integration (OSHA has cited both host employers and temp agencies in heat deaths)
- Connect real wearables to the readings API
- Exportable logs for state heat rules (California, Washington, Oregon, Maryland, Nevada) and a future OSHA heat standard

> Guidance only. Heat Passport does not replace medical advice or an employer's heat illness prevention plan.

## License

Copyright (c) 2026 Anshu Raj. All rights reserved. This code is shared for viewing only — see [LICENSE](LICENSE). No permission is granted to copy, modify, reuse, or distribute it.
