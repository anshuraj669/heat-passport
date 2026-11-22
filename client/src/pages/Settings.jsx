import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { defaultServer, getMyPassport, getServer, setMyPassport, setServer, setReminders } from '../config.js';
import { cancelReminders } from '../native.js';

export default function Settings() {
  const navigate = useNavigate();
  const [server, setServerInput] = useState(getServer());
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(getMyPassport());

  async function save(e) {
    e.preventDefault();
    setServer(server);
    setStatus('Checking…');
    try {
      await api.employers();
      setStatus('✓ Connected');
    } catch {
      setStatus('✗ Cannot reach the server at that address');
    }
  }

  async function forget() {
    await cancelReminders();
    setReminders(false);
    setMyPassport(null);
    setMine(null);
    navigate('/');
  }

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="card">
        <h2>My passport</h2>
        {mine ? (
          <>
            <p>This phone opens <strong className="mono">{mine}</strong> on launch.</p>
            <button type="button" className="ghost" onClick={forget}>Forget this passport on this phone</button>
          </>
        ) : (
          <p className="muted">No passport saved on this phone yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Server</h2>
        <p className="small muted">The Heat Passport server this phone talks to.</p>
        <form onSubmit={save} className="stack">
          <input value={server} onChange={(e) => setServerInput(e.target.value)} placeholder="http://192.168.1.20:3001" inputMode="url" aria-label="Server address" />
          <div className="chips">
            {defaultServer && <button type="button" className="chip" onClick={() => setServerInput(defaultServer)}>Default ({defaultServer})</button>}
            <button type="button" className="chip" onClick={() => setServerInput('http://10.0.2.2:3001')}>Android emulator</button>
          </div>
          <button>Save and test</button>
          {status && <p className="small" role="status">{status}</p>}
        </form>
      </section>

      <p className="small muted center">
        Guidance follows OSHA heat acclimatization recommendations. It does not replace medical advice or an employer's heat illness prevention plan.
      </p>
    </div>
  );
}
