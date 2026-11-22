import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

// Local emergency numbers as tap-to-call links. Ambulance comes first.
export function EmergencyNumbers({ emergency, t }) {
  if (!emergency) return null;
  return (
    <div className="emergency">
      <ul className="emergency-list">
        {emergency.services.map((s) => (
          <li key={`${s.service}-${s.number}`}>
            <a href={`tel:${s.number}`} className="emergency-number">
              <span>{t.services[s.service] ?? s.service}</span>
              <strong>{s.number}</strong>
            </a>
          </li>
        ))}
      </ul>
      {emergency.unknown && <p className="small muted">{t.emergencyUnknown}</p>}
    </div>
  );
}

// Pick where the worker is: the phone's location, or a town typed by hand.
// `autoLocate` asks for the phone's location once, as soon as it turns true.
export default function LocationPicker({ t, value, onPick, autoLocate = false }) {
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const tried = useRef(false);

  function locate() {
    tried.current = true;
    if (!navigator.geolocation) { setMessage(t.locUnavailable); return; }
    setStatus('finding');
    setMessage('');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = coords.latitude;
        const lon = coords.longitude;
        try {
          const place = await api.reversePlace(lat, lon);
          onPick({ ...place, lat, lon, source: 'gps' });
        } catch {
          // The server will look the place up again when the location is saved.
          onPick({ lat, lon, name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, source: 'gps', emergency: null });
        }
        setStatus('idle');
      },
      (err) => {
        setStatus('idle');
        setMessage(err.code === 1 ? t.locDenied : t.locUnavailable);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  }

  useEffect(() => {
    if (autoLocate && !value && !tried.current) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, value]);

  async function search() {
    if (query.trim().length < 2) return;
    setStatus('searching');
    setMessage('');
    try {
      const found = await api.searchPlaces(query);
      setResults(found);
      if (!found.length) setMessage(t.locNoResults);
    } catch (err) {
      setMessage(err.message);
    }
    setStatus('idle');
  }

  if (value) {
    return (
      <div className="location-chosen">
        <div className="row location-row">
          <span><Icon name="pin" size={16} /><strong>{value.name}</strong></span>
          <button type="button" className="ghost small-button" onClick={() => { onPick(null); setResults(null); }}>{t.locChange}</button>
        </div>
        {value.emergency && (
          <>
            <p className="small muted">{t.emergencyTitle}</p>
            <EmergencyNumbers emergency={value.emergency} t={t} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="location-picker stack">
      <button type="button" className="secondary" onClick={locate} disabled={status === 'finding'}>
        {status === 'finding' ? t.locFinding : t.locUseGps}
      </button>
      <div className="row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder={t.locSearch}
          aria-label={t.locSearch}
        />
        <button type="button" onClick={search} disabled={status === 'searching'}>{t.locSearchBtn}</button>
      </div>
      {results?.length > 0 && (
        <ul className="place-results">
          {results.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" className="ghost place" onClick={() => { onPick({ ...p, source: 'search' }); setResults(null); setQuery(''); }}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="small error">{message}</p>}
      <p className="small muted">{t.locWhy}</p>
    </div>
  );
}
