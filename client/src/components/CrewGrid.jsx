import { formatHour } from '../api.js';
import { deg } from '../units.js';

// Supervisor view: who works in the heat, when.
export default function CrewGrid({ hours, crew, unit = 'F' }) {
  if (!hours.length || !crew.length) return null;
  return (
    <div className="crew-grid-wrap">
      <table className="crew-grid">
        <thead>
          <tr>
            <th scope="col">Worker</th>
            {hours.map((h) => (
              <th key={h.hour} scope="col">
                {formatHour(h.hour)}
                <span className={`hi risk-${riskOf(h.heatIndex)}`}>{deg(h.heatIndex, unit)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {crew.map((m) => (
            <tr key={m.worker.id}>
              <th scope="row">{m.worker.name.split(' ')[0]}</th>
              {m.schedule.map((s) => (
                <td key={s.hour} className={s.heatMinutes ? `on risk-${s.risk}` : 'off'} title={s.heatMinutes ? `Heat work ${s.heatMinutes} min, ${s.breakMinutes} min shade break` : 'Shade, indoor or light work'}>
                  {s.heatMinutes ? (s.heatMinutes < 60 ? `${s.heatMinutes}m` : '●') : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted legend">● heat work all hour · 36m partial hour · — shade, indoor or light work. Heat time is placed in the coolest hours.</p>
    </div>
  );
}

const riskOf = (hi) => (hi < 91 ? 'lower' : hi < 103 ? 'moderate' : hi < 115 ? 'high' : 'extreme');
