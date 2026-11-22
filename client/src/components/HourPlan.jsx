import { formatHour } from '../api.js';
import { temp } from '../units.js';

// One worker's day: which hours are heat work, which are shade/light work.
export default function HourPlan({ schedule, t, unit = 'F' }) {
  return (
    <ol className="hour-plan">
      {schedule.map((h) => (
        <li key={h.hour} className={h.heatMinutes ? `work risk-${h.risk}` : 'shade'}>
          <span className="hp-time">{formatHour(h.hour)}</span>
          <span className="hp-heat">{temp(h.heatIndex, unit)}</span>
          <span className="hp-what">
            {h.heatMinutes ? t.heatWork(h.heatMinutes) : t.shadeWork}
            {h.breakMinutes > 0 && <small> {t.breakMin(h.breakMinutes)}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}
