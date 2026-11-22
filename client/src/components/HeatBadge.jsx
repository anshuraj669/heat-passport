import { temp } from '../units.js';

export default function HeatBadge({ heat, unit = 'F' }) {
  if (!heat?.risk) return null;
  return (
    <span className={`heat-badge risk-${heat.risk.level}`}>
      {temp(heat.planIndex, unit)} · {heat.risk.label}
      {heat.simulated != null && <em> (simulated)</em>}
    </span>
  );
}
