// Android-only features. Every function is a no-op (or reports unsupported) on the web.
import { LocalNotifications } from '@capacitor/local-notifications';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './config.js';

const TEXT = {
  en: {
    heatStart: (m, b) => ({ title: '🔥 Heat work this hour', body: `Up to ${m} min in the heat${b ? `, plus a ${b}-min shade break` : ''}. Drink water every 15–20 min.` }),
    water: { title: '💧 Water break', body: 'Drink a cup of water now, even if you are not thirsty.' },
    done: { title: '🛑 Heat time done for today', body: 'Move to shade, indoor or light work for the rest of your shift.' },
    check: { title: '☀️ Daily check (30 seconds)', body: 'Tell us if you were sick, drank alcohol or slept badly. It keeps you safe today.' },
  },
  es: {
    heatStart: (m, b) => ({ title: '🔥 Trabajo en calor esta hora', body: `Hasta ${m} min en el calor${b ? `, más ${b} min de descanso en sombra` : ''}. Tome agua cada 15–20 min.` }),
    water: { title: '💧 Descanso para agua', body: 'Tome un vaso de agua ahora, aunque no tenga sed.' },
    done: { title: '🛑 Terminó su tiempo en el calor', body: 'Pase el resto del turno en la sombra, adentro o en trabajo ligero.' },
    check: { title: '☀️ Chequeo diario (30 segundos)', body: 'Díganos si estuvo enfermo, tomó alcohol o durmió mal. Así se cuida hoy.' },
  },
  pt: {
    heatStart: (m, b) => ({ title: '🔥 Trabalho no calor nesta hora', body: `Até ${m} min no calor${b ? `, mais ${b} min de pausa na sombra` : ''}. Beba água a cada 15–20 min.` }),
    water: { title: '💧 Pausa para água', body: 'Beba um copo de água agora, mesmo sem sede.' },
    done: { title: '🛑 Seu tempo no calor acabou', body: 'Passe o resto do turno na sombra, em local fechado ou em trabalho leve.' },
    check: { title: '☀️ Verificação diária (30 segundos)', body: 'Diga se esteve doente, bebeu álcool ou dormiu mal. Isso protege você hoje.' },
  },
};

// Times are in the work site's time zone when the server knows it, else the phone's.
const at = (date, hour, minute = 0, offset = '') =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`);

// Turn the hour-by-hour plan into phone reminders.
export function buildReminders(passport, lang = 'en') {
  const t = TEXT[lang] ?? TEXT.en;
  const { schedule, plan, heat } = passport;
  if (!heat?.planDate || !schedule.length) return [];
  const date = heat.planDate;
  const tz = heat.utcOffset ?? '';
  const items = [{ at: at(date, heat.site.shiftStart - 1, 30, tz), ...t.check }];

  const heatHours = schedule.filter((h) => h.heatMinutes > 0 && h.heatIndex >= 80);
  for (const h of heatHours) {
    items.push({ at: at(date, h.hour, 0, tz), ...t.heatStart(h.heatMinutes, h.breakMinutes) });
    for (const m of [20, 40]) if (m < h.heatMinutes) items.push({ at: at(date, h.hour, m, tz), ...t.water });
  }
  const last = heatHours.at(-1);
  if (last && plan.fraction < 1) items.push({ at: at(date, last.hour, Math.min(last.heatMinutes, 59), tz), ...t.done });

  const now = Date.now();
  // Inexact alarms (within a few minutes) are fine for water breaks, and asking for exact
  // ones sends the worker to an Android settings screen on 14+.
  return items
    .filter((n) => n.at.getTime() > now)
    .map((n, i) => ({ id: i + 1, title: n.title, body: n.body, isExactNotification: false, schedule: { at: n.at, allowWhileIdle: true } }));
}

export async function scheduleReminders(passport, lang) {
  if (!isNative) return { ok: false, reason: 'web' };
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return { ok: false, reason: 'denied' };
  await cancelReminders();
  const notifications = buildReminders(passport, lang);
  if (notifications.length) await LocalNotifications.schedule({ notifications });
  return { ok: true, count: notifications.length };
}

export async function cancelReminders() {
  if (!isNative) return;
  const { notifications } = await LocalNotifications.getPending();
  if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
}

// Scan a worker's passport QR code. Returns the passport ID, or null if cancelled.
export async function scanPassport() {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    throw new Error('Installing the QR scanner. Try again in a moment.');
  }
  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
  if (!barcodes.length) return null;
  const id = barcodes[0].rawValue.toUpperCase().match(/HP-[A-Z0-9]{4}/)?.[0];
  if (!id) throw new Error('That QR code is not a Heat Passport.');
  return id;
}

// Save a text file and open Android's share sheet (email, Drive, WhatsApp...).
export async function shareFile(filename, text, title) {
  const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title, url: uri, dialogTitle: title });
}

// Home-screen shortcuts (long-press the app icon): "Call emergency" and "I feel sick".
// Each opens com.heatpassport.app://<action>; `handler` gets 'call' or 'sick'.
// The launch link is read once per app start, and the same action within 5 s counts once,
// so one tap never sends two alerts.
let launchHandled = false;
let last = { action: null, at: 0 };
export async function onShortcut(handler) {
  if (!isNative) return () => {};
  const { App } = await import('@capacitor/app');
  const route = (url) => {
    const action = url?.match(/^com\.heatpassport\.app:\/\/([a-z]+)/)?.[1];
    if (action !== 'call' && action !== 'sick') return;
    const now = Date.now();
    if (last.action === action && now - last.at < 5_000) return;
    last = { action, at: now };
    handler(action);
  };
  if (!launchHandled) {
    launchHandled = true;
    route((await App.getLaunchUrl())?.url);
  }
  const listener = await App.addListener('appUrlOpen', ({ url }) => route(url));
  return () => listener.remove();
}
