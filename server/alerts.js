// Alert lifecycle: raise, notify, acknowledge, and the hold that follows heat illness.
import { getDb, save } from './db.js';
import { createAlert, activeHold } from './service.js';
import { notifyAlert } from './notify.js';

const HOLD_SEVERITIES = new Set(['emergency', 'exhaustion', 'reported']);

function placeHold(workerId, severity, alertId) {
  const db = getDb();
  const hold = activeHold(workerId);
  if (hold) {
    // Only ever gets stricter until a person clears it.
    if (severity === 'emergency') hold.severity = 'emergency';
    return hold;
  }
  const created = { workerId, severity, alertId, createdAt: new Date().toISOString(), clearedAt: null, clearedBy: null, note: null };
  db.holds.push(created);
  return created;
}

export function raiseAlert(worker, { symptoms = [], severity, source, reportedBy = null }) {
  const alert = createAlert(worker, symptoms, severity, source, reportedBy);
  if (HOLD_SEVERITIES.has(severity)) placeHold(worker.id, severity, alert.id);
  save();
  // Never make first aid wait on the network.
  notifyAlert(alert).catch((err) => console.error('Alert delivery failed:', err.message));
  return alert;
}

// Worse news restarts the clock, even if someone already acknowledged the milder report.
export function upgradeAlert(alert, severity) {
  alert.severity = severity;
  alert.acknowledgedAt = null;
  alert.acknowledgedBy = null;
  alert.escalatedAt = null;
  alert.upgradedAt = new Date().toISOString();
  placeHold(alert.workerId, severity, alert.id);
  save();
  notifyAlert(alert).catch((err) => console.error('Alert delivery failed:', err.message));
  return alert;
}

export function acknowledgeAlert(alertId, by) {
  const alert = getDb().alerts.find((a) => a.id === alertId);
  if (!alert) return null;
  alert.acknowledgedAt ??= new Date().toISOString();
  alert.acknowledgedBy ??= by;
  save();
  return alert;
}

export function clearHold(workerId, by, note) {
  const hold = activeHold(workerId);
  if (!hold) return null;
  hold.clearedAt = new Date().toISOString();
  hold.clearedBy = String(by).slice(0, 80);
  hold.note = String(note ?? '').slice(0, 200);
  save();
  return hold;
}
