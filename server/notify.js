// Outbound alert delivery: decides WHO must hear about an alert and records it.
// This build delivers in the app only: the supervisor dashboard and the buddy's passport
// both poll for open alerts. The next build adds push and SMS at deliver() below
// (see docs/NOTIFICATION_SERVICE_PLAN.md); the recipient and escalation rules stay here.
import { getDb, save } from './db.js';
import { findWorker, employerName } from './service.js';
import { withNumber } from './firstAid.js';

const HEADLINE = {
  emergency: '🚨 POSSIBLE HEAT STROKE: call 911 now and start cooling',
  exhaustion: '⚠️ Possible heat exhaustion: stop work, shade, water, stay with them',
  reported: '⚠️ Reported feeling unwell: check on them now',
  missed: '❓ Missed a safety check-in: go and find them now',
  wearable: '⌚ Wearable shows signs of heat strain: check on them now',
};

export function alertText(alert, { escalation = false } = {}) {
  const worker = findWorker(alert.workerId);
  const reporter = alert.reportedBy && findWorker(alert.reportedBy);
  const loc = alert.location;
  return [
    escalation ? '‼️ ESCALATED: nobody has acknowledged this alert yet.' : null,
    withNumber(HEADLINE[alert.severity], alert.emergencyNumber ?? '911'),
    `Worker: ${worker?.name} (${alert.workerId})`,
    reporter ? `Reported by: ${reporter.name}` : null,
    alert.symptoms.length ? `Symptoms: ${alert.symptoms.join(', ')}` : null,
    loc ? `Location: ${loc.name}${loc.address ? `, ${loc.address}` : ''}` : 'Location: unknown',
    loc ? `Map: https://www.google.com/maps?q=${loc.lat},${loc.lon}` : null,
    `Reported: ${new Date(alert.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
  ].filter(Boolean).join('\n');
}

// Severe alerts also go straight to the buddy, who is usually closest.
const BUDDY_NOW = new Set(['emergency', 'missed']);

// Who should hear about this alert now. On escalation the backup contact (dashboard
// "backup" role) and the buddy are added, because the supervisor has not responded.
export function recipients(alert, { escalation = false } = {}) {
  const list = alert.employers.map((employerId) => ({
    role: escalation ? 'backup' : 'supervisor', employerId, label: `${escalation ? 'backup' : 'supervisor'}: ${employerName(employerId)}`,
  }));
  const buddyId = getDb().buddies[alert.workerId];
  if (buddyId && (escalation || BUDDY_NOW.has(alert.severity))) list.push({ role: 'buddy', workerId: buddyId, label: 'buddy' });
  return list;
}

// The one place a real channel (push, SMS, voice) will plug in. In-app delivery always succeeds:
// the dashboard and passports read open alerts on their next poll.
async function deliver(recipient, text) {
  return { channel: 'in-app', ok: true };
}

export async function notifyAlert(alert, { escalation = false } = {}) {
  const text = alertText(alert, { escalation });
  const results = await Promise.all(recipients(alert, { escalation }).map(async (r) => ({
    role: r.label, recipient: r.employerId ?? r.workerId, escalation, text, ...(await deliver(r, text)), at: new Date().toISOString(),
  })));
  (alert.notifications ??= []).push(...results); // older demo data has no list yet
  save();
  return results;
}
