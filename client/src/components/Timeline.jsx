const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });

import { temp } from '../units.js';

export default function Timeline({ days, compact = false, labels = {}, unit = 'F' }) {
  return (
    <ol className={`timeline${compact ? ' compact' : ''}`}>
      {days.map((d) => {
        const hot = d.heatMinutes > 0;
        const title = hot
          ? `${d.date}: ${labels.heatDay ?? 'Heat work'} ${Math.round(d.heatMinutes / 60)} h, ${temp(d.maxHeatIndex, unit)} (${d.employers.join(', ')})`
          : `${d.date}: ${labels.noWork ?? 'No heat work'}`;
        const intensity = !hot ? 'none' : d.maxHeatIndex >= 103 ? 'high' : d.maxHeatIndex >= 91 ? 'mid' : 'low';
        return (
          <li key={d.date} title={title} className={`day heat-${intensity}`}>
            {!compact && <span>{weekday(d.date)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
