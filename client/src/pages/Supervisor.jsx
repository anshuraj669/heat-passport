import { useCallback, useEffect, useState } from 'react';
import { api, formatHour, formatMinutes, toneFor } from '../api.js';
import Meter from '../components/Meter.jsx';
import HeatBadge from '../components/HeatBadge.jsx';
import Timeline from '../components/Timeline.jsx';
import CrewGrid from '../components/CrewGrid.jsx';
import { isNative } from '../config.js';
import { scanPassport, shareFile } from '../native.js';
import { temp, tempDelta } from '../units.js';
import Icon from '../components/Icon.jsx';

const SEVERITY = {
  emergency: { label: 'Possible HEAT STROKE: call 911 now and start cooling', className: 'emergency' },
  exhaustion: { label: 'Possible heat exhaustion: stop work, shade, water, stay with them', className: 'exhaustion' },
  reported: { label: 'Reported feeling unwell: check on them now', className: 'exhaustion' },
  missed: { label: 'Missed a safety check-in: go and find them now', className: 'exhaustion' },
  wearable: { label: 'Wearable shows signs of heat strain: check on them now', className: 'exhaustion' },
};

const SOURCE = { sms: 'text message', app: 'app', checkin: 'safety check-in', wearable: 'wearable' };
const CHECKIN = { pending: 'Waiting for reply', ok: 'Replied OK', missed: 'Missed check-in', help: 'Asked for help' };
const CONDITION_LABELS = { sun: 'Sun', workload: 'Workload', clothing: 'Clothing' };
const TREND_WARNINGS = {
  illness: 'Repeated heat illness reports: review breaks, shade and water at this site.',
  overLimit: 'Several shifts went over safe limits: review how heat time is assigned.',
  missedCheckins: 'Several missed check-ins: confirm workers can reach their phones.',
};

export default function Supervisor() {
  const [employers, setEmployers] = useState([]);
  const [employerId, setEmployerId] = useState('copperline');
  const [simHeat, setSimHeat] = useState(null);
  const [data, setData] = useState(null);
  const [checkInId, setCheckInId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.employers().then(setEmployers);
    api.getSimulation().then((s) => setSimHeat(s.heatIndex));
  }, []);

  const load = useCallback(() => {
    api.crew(employerId)
      .then((d) => { setData(d); setError(''); })
      .catch((err) => setError(err.message));
  }, [employerId]);

  useEffect(() => {
    load();
  }, [load, simHeat]);

  // Poll so alerts sent from a worker's phone show up on their own.
  useEffect(() => {
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function simulate(value) {
    const s = await api.setSimulation(value);
    setSimHeat(s.heatIndex);
  }

  async function checkIn(e) {
    e.preventDefault();
    try {
      await api.checkIn(employerId, checkInId);
      setCheckInId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function scan() {
    try {
      const id = await scanPassport();
      if (!id) return;
      await api.checkIn(employerId, id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function shareHeatLog() {
    try {
      const csv = await api.heatLogCsv(employerId);
      await shareFile(`heat-log-${employerId}.csv`, csv, 'Heat log');
    } catch (err) {
      setError(err.message);
    }
  }

  async function logShift(member) {
    const heatMinutes = member.schedule.length
      ? member.schedule.reduce((sum, h) => sum + h.heatMinutes, 0)
      : member.plan.allowedMinutes;
    await api.logShift(member.worker.id, { siteId: data.heat.site.id, heatMinutes, maxHeatIndex: data.heat.planIndex ?? 95 });
    load();
  }

  async function remove(member) {
    await api.removeFromCrew(employerId, member.worker.id);
    load();
  }

  const act = (fn) => async (...args) => {
    try {
      await fn(...args);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const setCondition = act((key, value) => api.setConditions(data.heat.site.id, { [key]: value }));
  const setBuddy = act((workerId, buddyId) => api.setBuddy(workerId, buddyId || null));
  const toggleCheckins = act((on) => api.setCheckins(employerId, on));
  const checkinsNow = act(() => api.checkinsNow(employerId));
  const clearHold = act((member) => {
    const severe = member.plan.hold.severity === 'emergency';
    const by = window.prompt(severe ? 'Name of the medical professional who cleared this worker:' : 'Your name, to clear this worker:');
    return by?.trim() ? api.clearHold(member.worker.id, by.trim()) : null;
  });

  async function resetDemo() {
    await api.resetDemo();
    setSimHeat(null);
    load();
  }

  const unit = data?.unit ?? 'F'; // °C or °F, by the site's country
  const crew = data ? data.crew.toSorted((a, b) => a.plan.fraction - b.plan.fraction) : [];
  const restricted = crew.filter((m) => m.plan.fraction < 1).length;
  const cautions = crew.filter((m) => m.caution).length;
  const holds = crew.filter((m) => m.plan.hold).length;
  const heat = data?.heat;
  const day = heat && !heat.isToday ? 'Tomorrow' : 'Today';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Crew dashboard</p>
          <select value={employerId} onChange={(e) => setEmployerId(e.target.value)} aria-label="Employer" className="title-select">
            {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {heat && <p className="muted small site-line"><Icon name="pin" size={15} />{heat.site.name} · shift from {heat.site.shiftStart}:00, {heat.site.shiftHours} h</p>}
        </div>
        <div className="check-in">
          {isNative && <button type="button" className="scan-button" onClick={scan}><Icon name="scan" /> Scan passport QR</button>}
          <form onSubmit={checkIn} className="row">
            <input value={checkInId} onChange={(e) => setCheckInId(e.target.value)} placeholder="Passport ID, e.g. HP-JM24" aria-label="Passport ID to check in" required />
            <button>Check in</button>
          </form>
        </div>
      </header>

      {data && (
        <dl className="readout">
          <div><dt>On crew</dt><dd>{crew.length}</dd></div>
          <div className={restricted ? 'is-danger' : ''}><dt>Limited heat work {day.toLowerCase()}</dt><dd>{restricted}</dd></div>
          <div className={cautions ? 'is-warn' : ''}><dt>Caution flags</dt><dd>{cautions}</dd></div>
          <div className={holds ? 'is-danger' : ''}><dt>On hold</dt><dd>{holds}</dd></div>
        </dl>
      )}

      {error && <p className="error">{error}</p>}

      {data?.alerts.map((a) => (
        <div key={a.id} className={`alert-banner ${SEVERITY[a.severity].className}`} role="alert">
          <div>
            <strong><Icon name="alert" size={18} />{a.workerName}</strong> · {new Date(a.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} via {SOURCE[a.source] ?? a.source}
            <p>{(SEVERITY[a.severity]?.label ?? SEVERITY.reported.label).replaceAll('911', a.emergencyNumber ?? data.emergency?.primary ?? '911')}</p>
            {a.symptoms.length > 0 && <p className="small">Symptoms: {a.symptoms.join(', ')}</p>}
            {a.location && <p className="small"><Icon name="pin" size={14} /> {a.location.name}{a.location.address ? `, ${a.location.address}` : ''}</p>}
            <p className="small">
              {a.acknowledgedAt ? `${a.acknowledgedBy} is on it` : a.escalatedAt ? 'Escalated: not acknowledged yet' : 'Not acknowledged yet'}
              {a.notifications?.some((n) => n.ok) && ` · Notified: ${[...new Set(a.notifications.filter((n) => n.ok).map((n) => n.role))].join(', ')}`}
            </p>
          </div>
          <div className="alert-actions">
            {!a.acknowledgedAt && <button type="button" onClick={() => api.acknowledgeAlert(a.id).then(load)}>I'm on it</button>}
            <button type="button" className="ghost" onClick={() => api.resolveAlert(a.id).then(load)}>Mark handled</button>
          </div>
        </div>
      ))}

      {heat && (
        <section className={`section site-heat risk-panel-${heat.risk?.level ?? 'none'}`}>
          <div>
            <p className="eyebrow">Site heat index · {day.toLowerCase()}'s shift</p>
            {heat.risk ? (
              <>
                <p className="big">{temp(heat.planIndex, unit)}</p>
                <HeatBadge heat={heat} unit={unit} />
                {heat.adjustment > 0 && <p className="small">Forecast <span className="num">{temp(heat.baseIndex, unit)}</span> + <span className="num">{tempDelta(heat.adjustment, unit)}</span> for sun and job</p>}
                <p className="muted small">
                  {heat.simulated != null
                    ? 'Simulated heat wave (demo)'
                    : heat.source === 'open-meteo' ? `Peak during the shift, Open-Meteo hourly forecast. Now ${temp(heat.now, unit)}.` : 'Live weather unavailable'}
                </p>
              </>
            ) : (
              <p className="muted">Live weather unavailable. Turn on simulation to plan.</p>
            )}
          </div>
          <div>
            <p className="eyebrow">What to do</p>
            <ul className="actions">
              {heat.risk?.actions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </div>
          <div className="simulate">
            <p className="eyebrow">Demo and records</p>
            <label className="switch">
              <input type="checkbox" checked={simHeat != null} onChange={(e) => simulate(e.target.checked ? 110 : null)} />
              Simulate heat wave
            </label>
            {simHeat != null && (
              <label className="small">
                Peak {temp(simHeat, unit)}
                <input type="range" min="85" max="125" value={simHeat} onChange={(e) => setSimHeat(Number(e.target.value))} onPointerUp={(e) => simulate(e.target.value)} onKeyUp={(e) => simulate(e.target.value)} />
              </label>
            )}
            <div className="btn-row">
              {isNative ? (
                <button type="button" className="ghost small-button" onClick={shareHeatLog}><Icon name="share" size={16} /> Share heat log</button>
              ) : (
                <a href={api.heatLogUrl(employerId)} className="button ghost small-button" download><Icon name="download" size={16} /> Heat log (CSV)</a>
              )}
              <button type="button" className="ghost small-button" onClick={resetDemo}>Reset demo</button>
            </div>
          </div>
        </section>
      )}

      {heat && crew.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Heat work by hour</h2>
            <div className="heat-legend" aria-hidden="true">
              <span><i className="risk-lower" />Lower</span>
              <span><i className="risk-moderate" />Moderate</span>
              <span><i className="risk-high" />High</span>
              <span><i className="risk-extreme" />Extreme</span>
            </div>
          </div>
          <CrewGrid hours={heat.hours} crew={crew} unit={unit} />
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Crew <span className="num muted">{crew.length}</span></h2>
          {crew.length > 0 && <p className="small muted">Least adapted first</p>}
        </div>
        {crew.length > 0 && (
          <div className="crew-row crew-row--head" aria-hidden="true">
            <span>Worker</span><span>Heat adaptation</span><span>Safe heat work {day.toLowerCase()}</span><span>Last 14 days</span><span />
          </div>
        )}
        <div className="crew" role="list">
          {crew.map((m) => {
            const tone = toneFor(m.plan);
            return (
              <article key={m.worker.id} className={`crew-row tone-${tone}`} role="listitem">
                <div className="cr-who">
                  <strong>{m.worker.name}</strong>
                  <span className="mono muted">{m.worker.id}</span>
                  <div className="cr-flags">
                    <span className={`pill tone-${tone}`}>{m.plan.status}</span>
                    {m.caution && <span className="pill tone-warn">Caution</span>}
                    {m.plan.hold && <span className="pill tone-danger">Hold</span>}
                    {m.checkin && <span className={`pill tone-${m.checkin.status === 'ok' ? 'ok' : m.checkin.status === 'pending' ? 'warn' : 'danger'}`}>{CHECKIN[m.checkin.status]}</span>}
                  </div>
                </div>
                <div className="cr-meter"><Meter percent={m.plan.percent} tone={tone} label="Heat adaptation" compact /></div>
                <div className="cr-time">
                  <span className="cr-label">Safe heat work {day.toLowerCase()}</span>
                  <span className="num cr-big">{formatMinutes(m.plan.allowedMinutes)}</span>
                  <span className="num muted"> / {formatMinutes(m.plan.shiftMinutes)}</span>
                </div>
                <div className="cr-days"><Timeline days={m.timeline} compact unit={unit} /></div>
                <div className="member-actions">
                  <button type="button" className="small-button" onClick={() => logShift(m)} disabled={m.loggedToday}>
                    {m.loggedToday ? 'Logged today' : 'Log today'}
                  </button>
                  {m.plan.hold && <button type="button" className="ghost small-button" onClick={() => clearHold(m)}>Clear hold</button>}
                  <button type="button" className="ghost small-button" onClick={() => remove(m)}>Remove</button>
                </div>
                <div className="cr-notes">
                  {m.plan.reasons.map((r) => <p key={r.code}>{r.text}</p>)}
                  {m.caution && <p>Extra caution today: start with lighter work, extra water, check on them often. Details stay private to the worker.</p>}
                  {m.otherEmployers.length > 0 && <p className="carried"><Icon name="link" size={15} />History carried over from {m.otherEmployers.join(', ')}</p>}
                  <label className="buddy-select">
                    Buddy
                    <select value={m.buddyId ?? ''} onChange={(e) => setBuddy(m.worker.id, e.target.value)}>
                      <option value="">None</option>
                      {crew.filter((c) => c.worker.id !== m.worker.id).map((c) => <option key={c.worker.id} value={c.worker.id}>{c.worker.name}</option>)}
                    </select>
                  </label>
                </div>
              </article>
            );
          })}
          {data && !crew.length && <p className="muted">No one checked in yet. Enter a passport ID above (try HP-JM24).</p>}
        </div>
      </section>

      {heat && data && (
        <section className="section safety-panel">
          <div>
            <h2>Job conditions</h2>
            <p className="small muted">Forecasts assume shade and light work. These planning estimates are added to the heat index.</p>
            <div className="condition-row">
              {Object.entries(data.jobConditions).map(([key, options]) => (
                <label key={key} className="small">
                  {CONDITION_LABELS[key]}
                  <select value={heat.site.conditions?.[key] ?? Object.keys(options)[0]} onChange={(e) => setCondition(key, e.target.value)}>
                    {Object.entries(options).map(([value, add]) => <option key={value} value={value}>{value} (+{tempDelta(add, unit)})</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <div>
            <h2>Peak-heat check-ins</h2>
            <p className="small muted">Asks each worker "Are you OK?" in high heat. No reply alerts their buddy and you.</p>
            <label className="switch">
              <input type="checkbox" checked={data.checkinsOn} onChange={(e) => toggleCheckins(e.target.checked)} />
              Crew is on shift today
            </label>
            <button type="button" className="ghost small-button" onClick={checkinsNow}>Send check-in now</button>
          </div>
          <div>
            <h2>Alerts</h2>
            <p className="small muted">Alerts appear at the top of this dashboard and on the buddy's passport. Ignored alerts escalate to the backup contact and the buddy. Phone push and SMS notifications are planned for the next build.</p>
          </div>
        </section>
      )}

      {data?.insights && !data.insights.hidden && (
        <section className={`section trends${data.insights.warnings.length ? ' has-warning' : ''}`}>
          <div className="section-head">
            <h2>Crew trends · last <span className="num">{data.insights.days}</span> days</h2>
            <p className="small muted">Totals only, with no names.</p>
          </div>
          <dl className="readout readout--plain">
            <div><dt>Heat illness reports</dt><dd>{data.insights.illnessReports}</dd></div>
            <div><dt>Most reports around</dt><dd>{data.insights.peakCount > 0 ? formatHour(data.insights.peakHour) : '—'}</dd></div>
            <div><dt>Shifts over limit</dt><dd>{data.insights.overLimitShifts}</dd></div>
            <div><dt>Missed check-ins</dt><dd>{data.insights.missedCheckins}</dd></div>
          </dl>
          {data.insights.warnings.map((w) => <p key={w} className="small text-warn"><Icon name="alert" size={16} /> {TREND_WARNINGS[w]}</p>)}
        </section>
      )}
    </div>
  );
}
