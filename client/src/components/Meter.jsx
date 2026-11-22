// Heat adaptation as five segments: OSHA's 20% rule adds one step per day of heat work,
// so each segment is one step of the ramp, not decoration.
export default function Meter({ percent, tone = 'ok', label, compact = false }) {
  const fill = (i) => Math.min(1, Math.max(0, (percent - i * 20) / 20));
  return (
    <div className={`meter tone-${tone}${compact ? ' compact' : ''}`} role="img" aria-label={`${label ?? 'Heat adaptation'}: ${percent}%`}>
      {!compact && (
        <div className="meter-top">
          <span>{label}</span>
          <span className="num">{percent}%</span>
        </div>
      )}
      <div className="meter-bar" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i}><i style={{ transform: `scaleX(${fill(i)})` }} /></span>
        ))}
      </div>
      {compact && <span className="num" aria-hidden="true">{percent}%</span>}
    </div>
  );
}
