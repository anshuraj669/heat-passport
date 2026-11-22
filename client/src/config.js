// Device-level settings. Storage can throw (private mode, blocked site data), so
// every access is guarded and the app still works without it.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
};

// The web build talks to its own origin; the app talks to a server set at build time
// (VITE_API_URL) or in Settings.
export const defaultServer = import.meta.env.VITE_API_URL ?? '';
export const getServer = () => read('hp.server') ?? defaultServer;
export const setServer = (url) => write('hp.server', url ? url.trim().replace(/\/+$/, '') : null);
export const apiBase = () => `${getServer()}/api`;

export const getMyPassport = () => read('hp.passport');
export const setMyPassport = (id) => write('hp.passport', id);

export const remindersOn = () => read('hp.reminders') === 'on';
export const setReminders = (on) => write('hp.reminders', on ? 'on' : null);

export const readCache = (key) => {
  try { return JSON.parse(read(`hp.cache.${key}`)); } catch { return null; }
};
export const writeCache = (key, data) => write(`hp.cache.${key}`, JSON.stringify({ at: Date.now(), data }));
