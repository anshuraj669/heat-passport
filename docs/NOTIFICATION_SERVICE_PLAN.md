# Notification Service: Plan for the Next Build

**Status:** planned · **Target:** before the 20 November 2026 final submission and beyond · Replaces the removed Telegram bot

## 1. Why

A heat-stroke alert is only useful if a person near the worker sees it within minutes. This build delivers alerts **in the app only**: the supervisor dashboard and the buddy's passport. That works when someone has the app open, but not when the supervisor's phone is in their pocket. The next build adds real phone notifications that reach people **without the app open**, **without a data plan**, and **in any country**.

The Telegram bot was removed because:
- it needed every supervisor and worker to install Telegram and pair a chat by hand;
- Telegram is blocked or little used in some target regions;
- it gave no delivery receipts, so the system could not tell whether a message arrived.

## 2. What is already in place

The safety logic does not change. Only the last step, delivery, is new.

| Piece | Where | Status |
|---|---|---|
| Who to notify (supervisor per employer, backup on escalation, buddy for emergency or missed check-in) | `recipients()` in `server/notify.js` | Done, tested |
| Escalation once, after `ESCALATE_AFTER_MINUTES` without "I'm on it" | `server/monitor.js` | Done, tested |
| Message text with the local emergency number, map link, no private daily-check data | `alertText()` in `server/notify.js` | Done, tested |
| Check-in question in the worker's language | `checkin.message` in `server/monitor.js` | Done |
| Delivery log per alert (role, recipient, channel, time) | `alert.notifications` | Done |
| **Single delivery hook** | `deliver(recipient, text)` in `server/notify.js` | In-app only. **The new service plugs in here** |
| Inbound SMS (SICK, OK, 1/2 answers) | `POST /api/sms/twilio`, `server/sms.js` | Done |
| Phone reminders from the hourly plan | Android local notifications | Done (offline, no server needed) |

## 3. Requirements

1. **Fast:** a supervisor gets an emergency alert within 10 seconds of the report.
2. **Reaches people without data or a smartphone:** SMS and voice fallbacks.
3. **Worldwide:** providers and sender rules that work in India, the GCC, the Americas and Africa.
4. **Confirmed:** delivery receipts, retries, and a fallback to the next channel when one fails.
5. **Acknowledged from the notification itself:** "I'm on it" from the push action, an SMS reply or a key press on a voice call.
6. **Accessible:** the worker's language, with voice calls for workers who can't read.
7. **Private:** never include daily-check answers or medical details beyond the reported symptoms.
8. **Auditable:** every attempt is logged for the compliance record.

## 4. Channels

| Channel | Use | Provider (to confirm) | Notes |
|---|---|---|---|
| **Push** (primary) | Supervisors, backups, buddies and workers with the Android app; web push for the dashboard | Firebase Cloud Messaging (Android), Web Push (VAPID) | Free. Action buttons: "I'm on it", "OK", "I need help". High-priority notifications for emergencies |
| **SMS** (fallback, and primary for feature phones) | Anyone without the app, or when push isn't delivered | Twilio globally; regional routes where cheaper or required (India and the GCC have registration rules) | India needs DLT-registered templates and sender IDs, the UAE needs a registered sender ID, and the US needs 10DLC registration. Non-Latin text halves the SMS length |
| **Voice call** (escalation) | Emergency not acknowledged; workers who can't read | Twilio Programmable Voice (text-to-speech in the worker's language) | "Press 1 if you are on your way" acknowledges |
| **WhatsApp** (later) | Very common in India, the Gulf and Latin America | WhatsApp Business Platform | Needs pre-approved templates; good for check-ins and plans |
| **In-app** (always) | Dashboard and passport | Existing | Stays as the baseline that never fails |

## 5. Delivery policy (fallback chains)

| Alert | Immediately | If not delivered or acknowledged |
|---|---|---|
| `emergency` (possible heat stroke) | Push **and** SMS to the supervisor; push to the buddy | 60 s without acknowledgement: voice call to the supervisor. Escalation timer: backup gets push + SMS + voice, buddy gets SMS |
| `missed` check-in | Push to the supervisor and buddy | Push not delivered in 30 s: SMS. Escalation as today |
| `exhaustion`, `reported`, `wearable` | Push to the supervisor | Push not delivered in 60 s: SMS. Escalation: backup + buddy |
| Check-in question | Push to the worker with OK / Need help buttons | No app or not delivered: SMS with `checkin.message`; replies go through the existing `sms.js` |

Emergencies ignore quiet hours and do-not-disturb. On Android they use a high-importance notification channel.

## 6. Architecture

```
 alerts.js / monitor.js
        │  notifyAlert(alert)            (unchanged)
        ▼
 notify.js: recipients() + alertText()   (unchanged)
        │  deliver(recipient, message)
        ▼
 Notification service
   ├─ Outbox table: one row per (alert, recipient, channel, attempt)
   │    status: queued → sent → delivered | failed → acknowledged
   ├─ Worker: picks queued rows, sends through a channel adapter,
   │    retries with backoff, schedules the next fallback step
   ├─ Channel adapters (same interface: send(contact, message) → { ok, providerId })
   │    push-fcm · webpush · sms-twilio · voice-twilio · (whatsapp)
   └─ Webhooks: delivery receipts + replies → update the outbox, acknowledge the alert
```

- **Storage:** move from the JSON file to PostgreSQL (already on the roadmap). The outbox table is also the audit log.
- **Queue:** a Postgres-backed queue (e.g. pg-boss), so there is no extra infrastructure. Redis/BullMQ only if volume needs it.
- **Idempotency:** one key per alert, recipient and attempt, so a retry never sends twice.
- **Timers:** fallback steps are scheduled jobs. The existing 15-second monitor keeps handling escalation.

## 7. Contacts and devices

- **Device registration:** the Android app registers its FCM token after the worker opens their passport. Supervisors enroll their phone with the employer's **join code** (already in the data model and kept private): `POST /api/devices { token, platform, role, employerId | workerId }`.
- **Phone numbers:** stored in E.164 format and verified by a one-time code before any SMS or call. Each person has a priority list of contacts (push, then SMS, then voice).
- **Backup contact:** each employer sets one or more backup contacts on the dashboard.
- **Consent and opt-out:** explicit opt-in at enrollment, STOP / PARAR / PARE handled, preferred language stored per contact.

## 8. API additions

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/devices` | Register or refresh a push token |
| DELETE | `/api/devices/:id` | Remove a device |
| POST | `/api/contacts` · `/api/contacts/:id/verify` | Add a phone number, verify it with a one-time code |
| POST | `/api/notify/status/:provider` | Delivery receipts (signature-checked) |
| POST | `/api/notify/actions` | Push action buttons: acknowledge, check-in OK / help |
| GET | `/api/alerts/:id/deliveries` | Delivery timeline for the dashboard and the audit log |

## 9. Security

- Depends on **authentication** (roadmap item 1): device and contact endpoints require a logged-in worker or supervisor.
- Every provider webhook is signature-checked (e.g. Twilio's request signature) before it is trusted.
- Provider keys live only in server environment variables. Push payloads hold just the alert ID and short text, and the app fetches details over the authenticated API.

## 10. Testing

- Fake adapters in unit tests, the same way the tests already fake the network: assert on the outbox, not on a provider.
- Fallback tests: push fails, then SMS is sent; nothing is acknowledged, then a voice call follows; a late acknowledgement cancels pending steps.
- Live checks on real phones in at least the US, India and the UAE: delivery time, sender ID and language.
- Metrics: time to deliver, time to acknowledge, delivery rate per channel and country.

## 11. Milestones

| # | Scope | Done when |
|---|---|---|
| M1 | Push: FCM in the Android app, web push on the dashboard, device registration, "I'm on it" action button | An emergency reaches a locked phone in under 10 s and can be acknowledged from the notification |
| M2 | SMS out: Twilio adapter, outbox + retries + delivery receipts, fallback chains, verified phone numbers | Push failure falls back to SMS automatically; receipts show on the dashboard |
| M3 | Voice: text-to-speech escalation calls in en/es/pt, press-1 acknowledgement | An ignored emergency produces a call within 60 s |
| M4 | Regional compliance + WhatsApp: India DLT templates, UAE sender ID, WhatsApp check-ins | Live delivery confirmed in the US, India and the UAE |

## 12. Open decisions

1. SMS and voice providers per region (one global provider or regional routes), and who pays per message: the employer, a staffing agency or a program sponsor.
2. Whether workers without a smartphone get check-ins by SMS by default, or only on opt-in.
3. Data residency for contact data (e.g. India's DPDP Act, UAE rules).
4. How long delivery logs are kept for compliance.
