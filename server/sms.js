// Text access for workers without a data plan. The same logic serves the Twilio webhook and
// the in-app simulator. Text your passport ID (or anything, from a connected phone or
// chat) to get today's plan; text SICK / MAL for first aid and to alert your supervisor.
import { getDb, save } from './db.js';
import { findWorker, heatForWorker, passport, workerByContact, emergencyFor, tempUnitFor } from './service.js';
import { firstAid, withNumber } from './firstAid.js';
import { formatTemp } from './units.js';
import { heatHoursLabel } from './schedule.js';
import { raiseAlert, upgradeAlert } from './alerts.js';
import { pendingCheckin, replyCheckin } from './monitor.js';

const SICK_WORDS = ['SICK', 'HELP', 'MAL', 'ENFERMO', 'ENFERMA', 'AUXILIO', 'AYUDA', 'AJUDA', 'SOCORRO', 'DOENTE', '911', '112', '999'];
const OK_WORDS = ['OK', 'BIEN', 'BEM', 'FINE', 'GOOD'];
const YES_WORDS = ['1', 'YES', 'SI', 'SÍ', 'SIM'];
const NO_WORDS = ['2', 'NO', 'NAO', 'NÃO'];
// Words that mean heat stroke even if nobody answers the follow-up question.
const EMERGENCY_WORDS = /\b(911|112|999|CONFUS\w*|FAINT\w*|PASSED OUT|COLLAPS\w*|SEIZ\w*|UNCONSCIOUS|DESMAY\w*|DESMAI\w*|DESMAIO|INCONSCIENTE|CONVULS\w*)\b/;
const TRIAGE_WINDOW_MS = 15 * 60_000;

const fmt = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

const HELP =
  'Heat Passport: text your passport ID (example: HP-JM24) for today\'s safe heat plan. Text SICK + ID if you feel unwell. Emergency: call your local emergency number (112 works on most mobiles).\n' +
  'Pasaporte de Calor: envíe su ID (ejemplo: HP-JM24) para su plan de hoy. Envíe MAL + ID si se siente mal. Emergencia: llame al número de emergencias local (112 funciona en la mayoría de celulares).\n' +
  'Passaporte de Calor: envie seu ID (exemplo: HP-JM24) para seu plano de hoje. Envie MAL + ID se não estiver bem. Emergência: ligue para o número de emergência local (112 funciona na maioria dos celulares).';

const TEXT = {
  en: {
    today: 'today', tomorrow: 'tomorrow',
    max: (m) => `max ${m} of heat work`, full: 'full shift OK', adaptation: (p) => `heat adaptation ${p}%`,
    hours: (h) => `Heat work hours: ${h}. Rest of shift: shade or light work.`,
    caution: 'Extra caution today from your daily check: start with light work.',
    heat: (i) => `Heat index up to ${i}. Drink water every 15-20 min.`,
    sick: 'Feel unwell? Text SICK. Emergency: call 911.',
    holdEmergency: 'Medical hold: no heat work until a medical professional clears you.',
    holdOther: (m) => `Hold after a heat illness report: max ${m} of heat work until your supervisor clears you.`,
    triage: 'Reply 1 if the person is confused, fainted, had a seizure or stopped sweating. Reply 2 if not.',
    triageNo: 'OK. Stay in the shade and keep sipping water. If you get worse, text 1 or call 911.',
    checkinOk: 'Thanks. Stay safe and keep drinking water.',
  },
  es: {
    today: 'hoy', tomorrow: 'mañana',
    max: (m) => `máximo ${m} de trabajo en el calor`, full: 'turno completo permitido', adaptation: (p) => `adaptación al calor ${p}%`,
    hours: (h) => `Horas en el calor: ${h}. El resto del turno: sombra o trabajo ligero.`,
    caution: 'Precaución extra hoy por su chequeo diario: empiece con trabajo ligero.',
    heat: (i) => `Índice de calor hasta ${i}. Tome agua cada 15-20 min.`,
    sick: 'Si se siente mal envíe MAL. Emergencia: 911.',
    holdEmergency: 'Suspensión médica: nada de trabajo en el calor hasta que un profesional médico lo autorice.',
    holdOther: (m) => `Restricción por enfermedad por calor: máximo ${m} de trabajo en el calor hasta que su supervisor lo autorice.`,
    triage: 'Responda 1 si la persona está confundida, se desmayó, tuvo una convulsión o dejó de sudar. Responda 2 si no.',
    triageNo: 'Bien. Quédese en la sombra y siga tomando agua a sorbos. Si empeora, envíe 1 o llame al 911.',
    checkinOk: 'Gracias. Cuídese y siga tomando agua.',
  },
  pt: {
    today: 'hoje', tomorrow: 'amanhã',
    max: (m) => `máximo de ${m} de trabalho no calor`, full: 'turno completo liberado', adaptation: (p) => `adaptação ao calor ${p}%`,
    hours: (h) => `Horas no calor: ${h}. Resto do turno: sombra ou trabalho leve.`,
    caution: 'Cuidado extra hoje pela sua verificação diária: comece com trabalho leve.',
    heat: (i) => `Índice de calor até ${i}. Beba água a cada 15-20 min.`,
    sick: 'Se não estiver bem, envie MAL. Emergência: 911.',
    holdEmergency: 'Suspensão médica: nada de trabalho no calor até um profissional de saúde liberar você.',
    holdOther: (m) => `Restrição após doença pelo calor: máximo de ${m} de trabalho no calor até seu supervisor liberar você.`,
    triage: 'Responda 1 se a pessoa estiver confusa, desmaiou, teve convulsão ou parou de suar. Responda 2 se não.',
    triageNo: 'Certo. Fique na sombra e continue bebendo água aos poucos. Se piorar, envie 1 ou ligue para o 911.',
    checkinOk: 'Obrigado. Cuide-se e continue bebendo água.',
  },
};

const aidText = (severity, language, alert) => {
  const aid = firstAid(severity, language, { supervisorAlerted: alert.employers.length > 0, emergencyNumber: alert.emergencyNumber ?? '911' });
  return `${aid.title}.\n${aid.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
};

// Answer to "are they confused or fainting?", sent after a SICK message.
function triageReply(from, first, t, language) {
  const db = getDb();
  const pending = db.pending[from];
  if (!pending) return null;
  const fresh = Date.now() - Date.parse(pending.at) < TRIAGE_WINDOW_MS;
  const yes = YES_WORDS.includes(first);
  if (!fresh || !(yes || NO_WORDS.includes(first))) {
    if (!fresh) { delete db.pending[from]; save(); }
    return null;
  }
  delete db.pending[from];
  save();
  const alert = db.alerts.find((a) => a.id === pending.alertId);
  if (!alert) return null;
  if (!yes) return withNumber(t.triageNo, alert.emergencyNumber ?? '911');
  upgradeAlert(alert, 'emergency');
  return aidText('emergency', language, alert);
}

export async function handleSms(from, body) {
  const text = String(body ?? '').trim();
  const upper = text.toUpperCase();
  const first = upper.split(/\s+/)[0];
  const sender = workerByContact(from);
  const senderTexts = TEXT[sender?.language] ?? TEXT.en;
  const key = String(from ?? '');

  const triage = triageReply(key, first, senderTexts, sender?.language ?? 'en');
  if (triage) return triage;

  const idMatch = upper.match(/\bHP-?([A-Z0-9]{4})\b/);
  const worker = idMatch ? findWorker(`HP-${idMatch[1]}`) : sender;
  if (!worker) return HELP;

  const emergency = EMERGENCY_WORDS.test(upper);
  const sick = emergency || SICK_WORDS.includes(first);

  if (sick) {
    const reportedBy = sender && sender.id !== worker.id ? sender.id : null;
    const openCheckin = pendingCheckin(worker.id);
    if (openCheckin) { openCheckin.status = 'help'; openCheckin.answeredAt = new Date().toISOString(); }
    const severity = emergency ? 'emergency' : 'reported';
    const alert = raiseAlert(worker, { severity, source: 'sms', reportedBy });
    const language = sender?.language ?? worker.language;
    if (emergency) return aidText('emergency', language, alert);
    getDb().pending[key] = { alertId: alert.id, at: new Date().toISOString() };
    save();
    return `${aidText('reported', language, alert)}\n\n${(TEXT[language] ?? TEXT.en).triage}`;
  }

  const open = pendingCheckin(worker.id);
  if (open && OK_WORDS.includes(first)) {
    replyCheckin(open.id, true);
    return senderTexts.checkinOk;
  }

  const t = TEXT[worker.language] ?? TEXT.en;
  const heat = await heatForWorker(worker);
  const { plan, schedule, caution } = passport(worker, heat);
  const name = worker.name.split(' ')[0];
  const when = heat && !heat.isToday ? t.tomorrow : t.today;
  const hours = heatHoursLabel(schedule);
  // Limited only if the hour-by-hour plan actually holds the worker out of some heat.
  const limited = schedule.length ? schedule.some((h) => h.heatMinutes < 60) : plan.fraction < 1;
  const holdLine = plan.hold ? (plan.hold.severity === 'emergency' ? t.holdEmergency : t.holdOther(fmt(plan.allowedMinutes))) : '';

  return [
    `${name} (${worker.id}), ${when}: ${limited || plan.hold ? t.max(fmt(plan.allowedMinutes)) : t.full} (${t.adaptation(plan.percent)}).`,
    holdLine,
    hours && limited ? t.hours(hours) : '',
    caution ? t.caution : '',
    heat?.planIndex ? t.heat(formatTemp(heat.planIndex, tempUnitFor(worker, heat))) : '',
    withNumber(t.sick, emergencyFor(worker, heat).primary),
  ].filter(Boolean).join(' ');
}

export const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
