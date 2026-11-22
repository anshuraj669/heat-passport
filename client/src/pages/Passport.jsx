import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api, formatMinutes, toneFor } from '../api.js';
import { strings, LANGUAGE_NAMES, withEmergency, reasonText } from '../i18n.js';
import { toC, toF, temp } from '../units.js';
import LocationPicker, { EmergencyNumbers } from '../components/LocationPicker.jsx';
import Meter from '../components/Meter.jsx';
import HeatBadge from '../components/HeatBadge.jsx';
import Timeline from '../components/Timeline.jsx';
import HourPlan from '../components/HourPlan.jsx';
import Pictograms from '../components/Pictograms.jsx';
import ListenButton from '../components/ListenButton.jsx';
import Icon from '../components/Icon.jsx';
import { isNative, getMyPassport, setMyPassport, remindersOn, setReminders } from '../config.js';
import { scheduleReminders, cancelReminders } from '../native.js';
import { emergencyNumberOf, sendSos } from '../emergency.js';

export default function Passport() {
  const { id } = useParams();
  // Opened from the "I feel sick" home-screen shortcut: go straight to the symptom list.
  const [search] = useSearchParams();
  const startSick = search.get('sick') === '1';
  // Show the saved plan instantly, then refresh it from the server.
  const [data, setData] = useState(() => api.cachedPassport(id));
  const [error, setError] = useState('');
  const [lang, setLang] = useState(null);

  const load = useCallback(() => {
    api.passport(id)
      .then((d) => { setData(d); setError(''); })
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll so a safety check-in appears without the worker refreshing.
  useEffect(() => {
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !data) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const language = lang ?? data.worker.language;
  // Every '911' in the text becomes the local number (112 until a place is known), also in the offline first aid.
  const t = withEmergency(strings[language] ?? strings.en, emergencyNumberOf(data));
  const { worker, plan, heat, timeline, employers, schedule } = data;
  const unit = data.unit ?? 'F'; // °C or °F, by the country of the place shown
  const tone = toneFor(plan);
  const day = heat && !heat.isToday ? t.tomorrow : t.today;

  return (
    <div className="page narrow">
      <section className={`passport tone-${tone}`}>
        <div className="passport-head">
          <div>
            <p className="passport-kind"><span className="mark" data-mark="arc" aria-hidden="true" />{t.passport}</p>
            <h1>{worker.name}</h1>
            <span className={`status-chip tone-${tone}`}>{t.status[plan.status]}</span>
          </div>
          <div className="qr">
            <QRCodeSVG value={worker.id} size={84} bgColor="#ffffff" fgColor="#1f2b4d" />
          </div>
        </div>
        <dl className="passport-fields">
          <div><dt>ID</dt><dd className="mono">{worker.id}</dd></div>
          <div><dt>{t.acclimatization}</dt><dd className="num">{plan.percent}%</dd></div>
        </dl>
        {data.offlineSince && (
          <p className="offline" role="status">
            <Icon name="wifiOff" size={16} />{t.offline(new Date(data.offlineSince).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}
          </p>
        )}
        <div className="lang-toggle" role="group" aria-label="Language">
          {Object.entries(LANGUAGE_NAMES).map(([l, label]) => (
            <button key={l} type="button" className={language === l ? 'active' : ''} onClick={() => setLang(l)}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted small">{t.belongsToYou}</p>
        {isNative && getMyPassport() !== worker.id && (
          <button type="button" className="ghost" onClick={() => { setMyPassport(worker.id); load(); }}>{t.thisIsMe}</button>
        )}
        <p className="mrz" aria-hidden="true">{mrz(worker)}</p>
      </section>

      {data.buddyAlerts?.map((a) => (
        <section key={a.id} className={`alert-banner ${a.severity === 'emergency' ? 'emergency' : 'exhaustion'}`} role="alert">
          <div>
            <strong><Icon name="alert" size={18} />{t.buddyNeedsHelp(a.workerName?.split(' ')[0] ?? '')}</strong>
            <p className="small">{t.buddyGoNow}{a.location ? ` · ${a.location.name}` : ''}</p>
          </div>
          <a href={`tel:${a.emergencyNumber ?? t.emergencyNumber}`} className="button danger">{t.callEmergency(a.emergencyNumber ?? t.emergencyNumber)}</a>
        </section>
      ))}

      {data.checkin && <CheckinCard checkin={data.checkin} t={t} onDone={load} />}

      <SickButton worker={worker} t={t} lang={language} alerts={data.alerts} onSent={load} startOpen={startSick} />

      <LocationCard workerId={worker.id} location={data.location} emergency={data.emergency} t={t} onSaved={load} />

      <section className="card today">
        <div>
          <p className="eyebrow">{day}</p>
          <p className="big">{formatMinutes(plan.allowedMinutes)}</p>
          <p>{t.safeToday} {t.ofShift(formatMinutes(plan.shiftMinutes))}</p>
          {plan.fraction < 1 && <p className="muted small">{t.restOfShift}</p>}
          <Meter percent={plan.percent} tone={tone} label={t.acclimatization} />
          <ListenButton
            t={t}
            lang={language}
            text={[t.listenPlan(worker.name.split(' ')[0], formatMinutes(plan.allowedMinutes), formatMinutes(plan.shiftMinutes)), ...plan.reasons.map((r) => reasonText(t, r, unit)), t.water].join(' ')}
          />
        </div>
      </section>

      <Pictograms t={t} items={['water', 'shade', 'rest', 'help']} />

      <section className="card">
        <ul className="reasons">
          {plan.reasons.map((r) => (
            <li key={r.code} className={`reason reason-${r.code}`}>{reasonText(t, r, unit)}</li>
          ))}
        </ul>
        {heat?.risk ? (
          <p className="small">{t.heatAt(heat.site.name)}: <HeatBadge heat={heat} unit={unit} /></p>
        ) : (
          <p className="muted small">{t.noHeat}</p>
        )}
      </section>

      {schedule.length > 0 && (
        <section className="card">
          <h2>{t.hourPlan} · {day}</h2>
          <HourPlan schedule={schedule} t={t} unit={unit} />
          <p className="small water"><Icon name="drop" size={18} />{t.water}</p>
          {isNative && getMyPassport() === worker.id && <Reminders passport={data} lang={language} t={t} />}
        </section>
      )}

      <DailyCheck workerId={worker.id} check={data.check} t={t} onSaved={load} />

      {data.kidney?.suggest && (
        <section className="card kidney">
          <h2 className="card-title"><Icon name="heart" />{t.kidneyTitle}</h2>
          <p className="small">{t.kidneyBody(data.kidney.riskyDays)}</p>
          <a href="https://findahealthcenter.hrsa.gov/" target="_blank" rel="noreferrer">{t.kidneyLink}</a>
        </section>
      )}

      <BuddyCard worker={worker} buddy={data.buddy} t={t} lang={language} alerts={data.alerts} onSent={load} />

      <section className="card">
        <h2>{t.last14}</h2>
        <Timeline days={timeline} labels={t} unit={unit} />
        <div className="heat-legend" aria-hidden="true">
          <span><i className="heat-none" />{t.noWork}</span>
          <span><i className="heat-low" />Under {temp(91, unit)}</span>
          <span><i className="heat-mid" />{temp(91, unit)}–{temp(102, unit)}</span>
          <span><i className="heat-high" />{temp(103, unit)}+</span>
        </div>
        {employers.length > 0 && <p className="small muted">{t.workedFor}: {employers.join(' · ')}</p>}
      </section>

      <section className="card">
        <h2>{t.sharing}</h2>
        {data.sharedWith.length ? (
          <ul className="share-list">
            {data.sharedWith.map((e) => (
              <li key={e.id}>
                <span>{e.name}</span>
                <button type="button" className="ghost" onClick={() => api.removeFromCrew(e.id, worker.id).then(load)}>{t.removeAccess}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t.sharingNone}</p>
        )}
        <p className="small muted card-title"><Icon name="message" size={16} />{t.sms}</p>
      </section>

      <WearableCard worker={worker} t={t} onChange={load} />

      <LogShift key={unit} workerId={worker.id} defaultSite={data.lastSiteId} defaultHeat={heat?.planIndex} t={t} unit={unit} onSaved={load} />
    </div>
  );
}

// Phone reminders built from the hour-by-hour plan; refreshed whenever the plan reloads.
function Reminders({ passport, lang, t }) {
  const [on, setOn] = useState(remindersOn());
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!on || passport.offlineSince) return;
    scheduleReminders(passport, lang).then((r) => {
      if (r.ok) setMsg(t.remindersSet(r.count));
      else if (r.reason === 'denied') { setOn(false); setReminders(false); setMsg(t.remindersDenied); }
    });
  }, [on, passport, lang, t]);

  async function toggle(next) {
    setOn(next);
    setReminders(next);
    if (!next) {
      await cancelReminders();
      setMsg('');
    }
  }

  return (
    <div className="reminders">
      <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        <Icon name="bell" size={18} />{t.reminders}
      </label>
      {msg && <p className="small muted">{msg}</p>}
    </div>
  );
}

function CheckinCard({ checkin, t, onDone }) {
  const reply = (ok) => api.replyCheckin(checkin.id, ok).then(onDone);
  return (
    <section className="card checkin" role="alert">
      <h2>{t.checkinTitle}</h2>
      <div className="row">
        <button type="button" onClick={() => reply(true)}><Icon name="check" size={18} />{t.checkinOk}</button>
        <button type="button" className="danger" onClick={() => reply(false)}>{t.checkinHelp}</button>
      </div>
    </section>
  );
}

// Heat stroke can leave someone unable to ask for help, so a buddy can ask for them.
function BuddyCard({ worker, buddy, t, lang, onSent }) {
  return (
    <section className="card">
      <h2 className="card-title"><Icon name="crew" />{t.buddyTitle}</h2>
      {buddy ? (
        <>
          <p><strong>{buddy.name}</strong> <span className="mono small">{buddy.id}</span></p>
          <p className="small muted">{t.buddyHelp(buddy.name.split(' ')[0])}</p>
          <SickButton worker={buddy} reporter={worker} t={t} lang={lang} alerts={[]} onSent={onSent} />
        </>
      ) : (
        <p className="small muted">{t.buddyNone}</p>
      )}
    </section>
  );
}

function WearableCard({ worker, t, onChange }) {
  const [on, setOn] = useState(Boolean(worker.wearableConsent));
  const [msg, setMsg] = useState('');

  async function toggle(next) {
    await api.setWearable(worker.id, next);
    setOn(next);
    setMsg('');
    onChange();
  }

  async function demo() {
    const reading = { heartRate: 168, skinTempF: 100 };
    await api.sendWearable(worker.id, reading);
    await api.sendWearable(worker.id, reading);
    setMsg(t.wearableSent);
    onChange();
  }

  return (
    <section className="card">
      <h2 className="card-title"><Icon name="watch" />{t.wearableTitle}</h2>
      <p className="small muted">{t.wearableHelp}</p>
      <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        {t.wearableOn}
      </label>
      {on && <button type="button" className="ghost small-button" onClick={demo}>{t.wearableDemo}</button>}
      {msg && <p className="small muted" role="status">{msg}</p>}
    </section>
  );
}

function SickButton({ worker, reporter = null, t, lang, alerts, onSent, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  // The shortcut can arrive while this passport is already on screen.
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);
  const [picked, setPicked] = useState([]);
  const [result, setResult] = useState(null);
  const firstAidRef = useRef(null);

  // The first-aid headline (e.g. "possible heat stroke") must be fully on screen.
  useEffect(() => {
    if (result) firstAidRef.current?.scrollIntoView({ block: 'start' });
  }, [result]);

  const toggle = (s) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  // No signal: the alert could not be sent, but first aid must still show.
  const offline = { alert: { severity: 'emergency' }, firstAid: { title: t.noSignalTitle, steps: t.noSignalSteps } };

  async function send() {
    let res;
    try {
      res = await api.reportSick(worker.id, { symptoms: picked, lang, reportedBy: reporter?.id });
    } catch {
      res = offline;
    }
    setResult(res);
    setOpen(false);
    setPicked([]);
    onSent();
  }

  // One tap for someone who cannot read a list: emergency alert now, first aid on screen.
  async function emergency() {
    const res = await sendSos(worker.id, { lang, reportedBy: reporter?.id });
    setResult(res ?? offline);
    setOpen(false);
    setPicked([]);
    onSent();
  }

  // The tel: link opens the dialer at once; the alert goes out alongside it, never before it.
  function callNow() {
    sendSos(worker.id, { lang, reportedBy: reporter?.id }).then((res) => { setResult(res ?? offline); onSent(); });
  }

  const latest = alerts.at(-1);
  const name = worker.name.split(' ')[0];
  return (
    <section className="sick">
      {result ? (
        <div ref={firstAidRef} className={`card first-aid severity-${result.alert.severity}`} role="alert">
          <h2>{result.firstAid.title}</h2>
          <Pictograms t={t} items={result.alert.severity === 'emergency' ? ['call', 'shade', 'cool', 'help'] : ['shade', 'water', 'cool', 'help']} />
          <ol>{result.firstAid.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <ListenButton t={t} lang={lang} text={[result.firstAid.title, ...result.firstAid.steps].join('. ')} autoPlay />
          <div className="row">
            <a href={`tel:${t.emergencyNumber}`} className="button danger">{t.call911}</a>
            <button type="button" className="ghost" onClick={() => setResult(null)}>OK</button>
          </div>
        </div>
      ) : open ? (
        <div className="card">
          <button type="button" className="danger sos-emergency" onClick={emergency}>
            <Icon name="alert" size={20} />{t.sosEmergency}
          </button>
          <h2>{reporter ? t.sickFor(name) : t.whatSymptoms}</h2>
          <div className="symptoms">
            {Object.entries(t.symptoms).map(([k, label]) => (
              <button key={k} type="button" className={`symptom${picked.includes(k) ? ' on' : ''}`} onClick={() => toggle(k)} aria-pressed={picked.includes(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="danger" onClick={send}>{t.sendAlert}</button>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>{t.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="sos">
          {!reporter && (
            <a href={`tel:${t.emergencyNumber}`} className="button danger sos-call-big" onClick={callNow}>
              <Icon name="phone" size={24} />
              <span><strong>{t.sosCall(t.emergencyNumber)}</strong><small>{t.sosAlso}</small></span>
            </a>
          )}
          <button type="button" className={reporter ? 'danger sick-button' : 'ghost sick-button sick-button--secondary'} onClick={() => setOpen(true)}>
            <Icon name="alert" size={22} />{reporter ? t.buddyReport(name) : t.feelSick}
          </button>
        </div>
      )}
      {latest && !result && (
        <p className="small muted center">{t.alerted(new Date(latest.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</p>
      )}
    </section>
  );
}

// Where the worker is, and who to call there. Weather follows this place when they are not on a crew.
function LocationCard({ workerId, location, emergency, t, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  async function pick(place) {
    if (!place) return;
    setError('');
    try {
      await api.setLocation(workerId, { lat: place.lat, lon: place.lon, name: place.name, country: place.country, countryCode: place.countryCode, source: place.source });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card">
      <h2 className="card-title"><Icon name="phone" />{t.emergencyTitle}</h2>
      {location && !editing ? (
        <div className="row location-row">
          <span className="small"><Icon name="pin" size={16} />{location.name}</span>
          <button type="button" className="ghost small-button" onClick={() => setEditing(true)}>{t.locChange}</button>
        </div>
      ) : (
        <>
          <p className="small"><strong>{t.locTitle}</strong></p>
          <LocationPicker t={t} value={null} onPick={pick} />
          {editing && <button type="button" className="ghost small-button" onClick={() => setEditing(false)}>{t.cancel}</button>}
        </>
      )}
      {error && <p className="small error">{error}</p>}
      <EmergencyNumbers emergency={emergency} t={t} />
    </section>
  );
}

function DailyCheck({ workerId, check, t, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(Object.keys(t.checks).map((k) => [k, Boolean(check?.[k])])));
  const [saved, setSaved] = useState(Boolean(check));

  async function submit(e) {
    e.preventDefault();
    await api.saveCheck(workerId, values);
    setSaved(true);
    onSaved();
  }

  return (
    <section className="card">
      <h2>{t.dailyCheck}</h2>
      <p className="small muted">{t.checkHelp}</p>
      <form onSubmit={submit} className="stack">
        {Object.entries(t.checks).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={values[k]} onChange={(e) => { setValues({ ...values, [k]: e.target.checked }); setSaved(false); }} />
            <span>{label}</span>
          </label>
        ))}
        <div className="urine-chart" aria-label={t.urineChart}>
          <span className="urine good">{t.urineGood}</span>
          <span className="urine drink">{t.urineDrink}</span>
          <span className="urine danger-urine">{t.urineDanger}</span>
        </div>
        <button disabled={saved}>{saved ? <><Icon name="check" size={18} />{t.checkSaved}</> : t.saveCheck}</button>
      </form>
    </section>
  );
}

function LogShift({ workerId, defaultSite, defaultHeat, t, unit, onSaved }) {
  const [employers, setEmployers] = useState([]);
  const [siteId, setSiteId] = useState(defaultSite ?? '');
  const [heatMinutes, setHeatMinutes] = useState(120);
  // Typed in the reader's unit, sent to the server in °F.
  const [maxHeatIndex, setMaxHeatIndex] = useState(() => (unit === 'C' ? toC(defaultHeat ?? 95) : defaultHeat ?? 95));
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.employers().then((list) => {
      setEmployers(list);
      setSiteId((s) => s || list[0]?.sites[0]?.id || '');
    });
  }, []);

  async function submit(e) {
    e.preventDefault();
    try {
      await api.logShift(workerId, { siteId, heatMinutes: Number(heatMinutes), maxHeatIndex: unit === 'C' ? toF(Number(maxHeatIndex)) : Number(maxHeatIndex) });
      setMsg(t.saved);
      onSaved();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <section className="card">
      <h2>{t.logShift}</h2>
      <form onSubmit={submit} className="stack">
        <label>
          {t.site}
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {employers.map((emp) => (
              <optgroup key={emp.id} label={emp.name}>
                {emp.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="grid-2 tight">
          <label>
            {t.minutes}
            <input type="number" min="0" max="960" value={heatMinutes} onChange={(e) => setHeatMinutes(e.target.value)} />
          </label>
          <label>
            {t.maxHeat(unit)}
            <input type="number" min={unit === 'C' ? -17 : 1} max={unit === 'C' ? 65 : 149} value={maxHeatIndex} onChange={(e) => setMaxHeatIndex(e.target.value)} />
          </label>
        </div>
        <button>{t.save}</button>
        {msg && <p className="small muted" role="status">{msg}</p>}
      </form>
    </section>
  );
}

// The machine-readable line along the foot of a travel passport, built from the worker's own record.
function mrz(worker) {
  const clean = (x) => x.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]+/g, '<');
  const [first, ...rest] = worker.name.trim().split(/\s+/);
  const line = `HP<${clean(worker.id.replace(/^HP-/, ''))}<<${clean(rest.join(' ') || first)}<<${rest.length ? clean(first) : ''}`;
  return line.padEnd(44, '<').slice(0, 44);
}
