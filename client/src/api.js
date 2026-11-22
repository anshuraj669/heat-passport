import { apiBase, readCache, writeCache } from './config.js';

async function request(path, { timeout = 12_000, ...options } = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// fetch() rejects (rather than returning a response) when the network is down.
const isNetworkError = (err) => err.name === 'TypeError' || err.name === 'TimeoutError' || err.name === 'AbortError';

const enc = encodeURIComponent;

export const api = {
  employers: () => request('/employers'),
  // Passports are cached so a worker can still see their plan with no signal in the field.
  cachedPassport(id) {
    return readCache(`passport.${String(id).toUpperCase()}`)?.data ?? null;
  },
  async passport(id) {
    const key = `passport.${String(id).toUpperCase()}`;
    try {
      const data = await request(`/passport/${enc(id)}`);
      writeCache(key, data);
      return data;
    } catch (err) {
      const cached = isNetworkError(err) && readCache(key);
      if (!cached) throw isNetworkError(err) ? new Error('Cannot reach the Heat Passport server. Check your connection or the server address in Settings.') : err;
      return { ...cached.data, offlineSince: cached.at };
    }
  },
  createWorker: (body) => request('/workers', { method: 'POST', body }),
  searchPlaces: (q) => request(`/locations/search?q=${enc(q)}`),
  reversePlace: (lat, lon) => request(`/locations/reverse?lat=${enc(lat)}&lon=${enc(lon)}`),
  setLocation: (id, place) => request(`/workers/${enc(id)}/location`, { method: 'POST', body: place }),
  logShift: (id, body) => request(`/workers/${enc(id)}/shifts`, { method: 'POST', body }),
  saveCheck: (id, body) => request(`/workers/${enc(id)}/check`, { method: 'POST', body }),
  // Short timeout: on a weak signal, first aid must not wait on the network.
  reportSick: (id, body) => request(`/workers/${enc(id)}/alerts`, { method: 'POST', body, timeout: 5_000 }),
  resolveAlert: (alertId) => request(`/alerts/${enc(alertId)}/resolve`, { method: 'POST', body: {} }),
  acknowledgeAlert: (alertId) => request(`/alerts/${enc(alertId)}/acknowledge`, { method: 'POST', body: { by: 'Dashboard' } }),
  clearHold: (id, by, note) => request(`/workers/${enc(id)}/hold/clear`, { method: 'POST', body: { by, note } }),
  setBuddy: (id, buddyId) => request(`/workers/${enc(id)}/buddy`, { method: 'POST', body: { buddyId } }),
  replyCheckin: (checkinId, ok) => request(`/checkins/${enc(checkinId)}/reply`, { method: 'POST', body: { ok } }),
  setCheckins: (employerId, on) => request(`/employers/${enc(employerId)}/checkins`, { method: 'POST', body: { on } }),
  checkinsNow: (employerId) => request(`/employers/${enc(employerId)}/checkins/now`, { method: 'POST', body: {} }),
  setConditions: (siteId, body) => request(`/sites/${enc(siteId)}/conditions`, { method: 'POST', body }),
  setWearable: (id, on) => request(`/workers/${enc(id)}/wearable/consent`, { method: 'POST', body: { on } }),
  sendWearable: (id, body) => request(`/workers/${enc(id)}/wearable`, { method: 'POST', body }),
  crew: (employerId) => request(`/employers/${enc(employerId)}/crew`),
  checkIn: (employerId, workerId) => request(`/employers/${enc(employerId)}/crew`, { method: 'POST', body: { workerId } }),
  removeFromCrew: (employerId, workerId) => request(`/employers/${enc(employerId)}/crew/${enc(workerId)}`, { method: 'DELETE' }),
  sms: (from, body) => request('/sms/simulate', { method: 'POST', body: { from, body } }),
  getSimulation: () => request('/demo/simulate'),
  setSimulation: (heatIndex) => request('/demo/simulate', { method: 'POST', body: { heatIndex } }),
  resetDemo: () => request('/demo/reset', { method: 'POST' }),
  heatLogUrl: (employerId) => `${apiBase()}/employers/${enc(employerId)}/heat-log.csv`,
  async heatLogCsv(employerId) {
    const res = await fetch(api.heatLogUrl(employerId), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Could not download the heat log (${res.status})`);
    return res.text();
  },
};

export function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatHour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;

export function toneFor(plan) {
  if (plan.fraction <= 0.4) return 'danger';
  if (plan.fraction < 1) return 'warn';
  return 'ok';
}

