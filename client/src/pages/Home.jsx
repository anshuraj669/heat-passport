import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { isNative, setMyPassport } from '../config.js';
import { strings } from '../i18n.js';
import LocationPicker from '../components/LocationPicker.jsx';
import Icon from '../components/Icon.jsx';

const DEMO = [
  { id: 'HP-JM24', who: 'Juan, experienced, back after 8 days off' },
  { id: 'HP-ML07', who: 'Maria, changed employers, fully adapted' },
  { id: 'HP-DC11', who: 'Devon, first day on the job' },
];

export default function Home() {
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [location, setLocation] = useState(null);
  const [skipLocation, setSkipLocation] = useState(false);
  // Ask for the phone's location as soon as someone starts making a passport.
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const t = strings[language] ?? strings.en;

  async function open(e) {
    e.preventDefault();
    setError('');
    try {
      const { worker } = await api.passport(id);
      setMyPassport(worker.id);
      navigate(`/passport/${worker.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      const place = location && { lat: location.lat, lon: location.lon, name: location.name, country: location.country, countryCode: location.countryCode, source: location.source };
      const worker = await api.createWorker({ name, language, location: place || undefined });
      setMyPassport(worker.id);
      navigate(`/passport/${worker.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <section className="intro">
        <h1 aria-label="Your heat safety record, carried from job to job.">
          <span className="enter-mask" aria-hidden="true"><span>Your heat safety record,</span></span>
          <span className="enter-mask" aria-hidden="true"><span>carried from job to job.</span></span>
        </h1>
        <p className="lead enter-follow">
          Most heat deaths at work happen in the first week, before the body adapts. Farmworkers, roofers and day
          laborers switch bosses constantly, so no one knows who is ready for a full day in the heat. The passport
          goes with the worker and tells the next supervisor.
        </p>
      </section>

      <div className="split">
        <section>
          <h2>Open a passport</h2>
          <form onSubmit={open} className="row">
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Passport ID, e.g. HP-JM24" aria-label="Passport ID" required />
            <button>Open</button>
          </form>
          <ul className="demo-list">
            {DEMO.map((d) => (
              <li key={d.id}>
                <Link to={`/passport/${d.id}`}><span className="mono">{d.id}</span><span>{d.who}</span><Icon name="arrow" size={16} /></Link>
              </li>
            ))}
          </ul>

          <h3>New here? Get a passport</h3>
          <form onSubmit={create} className="stack">
            <input value={name} onChange={(e) => setName(e.target.value)} onFocus={() => setStarted(true)} placeholder="Your name" aria-label="Your name" required />
            <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="pt">Português</option>
            </select>
            <p className="small"><strong>{t.locTitle}</strong></p>
            {!skipLocation && <LocationPicker t={t} value={location} onPick={setLocation} autoLocate={started} />}
            {!location && !skipLocation && (
              <button type="button" className="ghost small-button" onClick={() => setSkipLocation(true)}>{t.locSkip}</button>
            )}
            <button disabled={!location && !skipLocation}>Create my passport</button>
          </form>
        </section>

        <section>
          <h2>Run a crew</h2>
          <p>
            Check workers in by passport ID or QR code. See each person's heat adaptation, the heat index at your site,
            and how long each worker can safely work in the heat today.
          </p>
          <Link to="/supervisor" className="button">Open the crew dashboard</Link>
          <dl className="spec">
            <div><dt>Hour-by-hour plan</dt><dd>Heat time goes into the coolest hours, with shade breaks.</dd></div>
            <div><dt>Alerts</dt><dd>A worker taps "I feel sick" or texts SICK, and you see it with their location. Unanswered alerts escalate.</dd></div>
            <div><dt>Compliance log</dt><dd>A CSV heat log that flags any shift over a worker's safe limit.</dd></div>
            <div><dt>Heat waves</dt><dd>Even adapted workers cut exposure by half on the first very hot day.</dd></div>
          </dl>
        </section>
      </div>

      <section className="section">
        <div className="section-head"><h2>Why the first week matters</h2><p className="small muted">OSHA heat guidance</p></div>
        <dl className="readout readout--plain readout--facts">
          <div><dt>Heat deaths at work in a worker's first week</dt><dd>70%+</dd></div>
          <div><dt>Of a normal heat shift on day one, then 20% more each day</dt><dd>20%</dd></div>
          <div><dt>Away from the heat before the body's adaptation is gone</dt><dd>~1 week</dd></div>
        </dl>
      </section>

      {!isNative && (
        <section className="section sms-callout">
          <div>
            <h2>No smartphone needed</h2>
            <p className="muted">Workers text their passport ID for today's plan in English, Spanish or Portuguese, or text SICK for help.</p>
          </div>
          <Link to="/sms" className="button ghost"><Icon name="message" size={18} /> Try the text demo</Link>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
