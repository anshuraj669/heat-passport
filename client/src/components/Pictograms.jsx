// Picture cards for workers who read little or not in these languages.
const ICONS = { water: '💧', shade: '⛱️', rest: '🪑', help: '🗣️', cool: '🧊', call: '📞' };

export default function Pictograms({ t, items }) {
  return (
    <ul className="pictograms">
      {items.map((k) => (
        <li key={k}>
          <span aria-hidden>{ICONS[k]}</span>
          {t.pictures[k]}
        </li>
      ))}
    </ul>
  );
}
