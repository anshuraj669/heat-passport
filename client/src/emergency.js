// The fastest way to help: one tap opens the phone's dialer on the local emergency number,
// and, when this phone belongs to a worker, raises an emergency alert to their supervisor and buddy.
import { api } from './api.js';
import { getMyPassport } from './config.js';

// 112 reaches the local emergency service from most mobile phones worldwide,
// so it is the fallback until the passport has told us the local number.
export const FALLBACK_NUMBER = '112';

// One rule everywhere, so the header and the passport never show two different numbers.
export const emergencyNumberOf = (passport) => passport?.emergency?.primary ?? FALLBACK_NUMBER;

export function myEmergencyNumber() {
  const id = getMyPassport();
  return emergencyNumberOf(id ? api.cachedPassport(id) : null);
}

// Never waits on the network: the call must go through even with no signal.
// Resolves with the server's answer (alert and first aid), or null when it could not be sent.
export function sendSos(workerId, { lang, reportedBy } = {}) {
  if (!workerId) return Promise.resolve(null);
  return api.reportSick(workerId, { emergency: true, lang, reportedBy }).catch(() => null);
}

export function dial(number) {
  window.location.href = `tel:${number}`;
}
