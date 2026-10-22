import { compactNumber, fullNumber } from "../utils/chartFormat";

export interface ShareSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

const R = 40;
const C = 2 * Math.PI * R;

/**
 * A ring showing each slice's share of the total (the total in the middle) with
 * a legend row per slice: value and percentage. Slices with nothing in them stay
 * in the legend at 0% so the reader sees they exist, but draw no arc.
 */
export function ShareDonut({ slices, centerLabel }: { slices: ShareSlice[]; centerLabel: string }) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  let offset = 0;
  return (
    <div className="ae-donut">
      <div
        className="ae-donut-ring"
        role="img"
        aria-label={`${centerLabel} ${fullNumber.format(total)}: ${slices.map((s) => `${s.label} ${total ? ((s.value / total) * 100).toFixed(1) : 0}%`).join(", ")}`}
      >
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={R} className="ae-donut-track" />
          {total > 0 &&
            slices.map((s) => {
              const len = (Math.max(0, s.value) / total) * C;
              const arc = (
                <circle
                  key={s.key}
                  cx="50"
                  cy="50"
                  r={R}
                  className="ae-donut-arc"
                  style={{ stroke: s.color }}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return len > 0 ? arc : null;
            })}
        </svg>
        <div className="ae-donut-center">
          <strong>{compactNumber.format(total)}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="ae-donut-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <i aria-hidden className="ae-fl-key" style={{ background: s.color }} />
            <span className="ae-donut-name">{s.label}</span>
            <strong>{compactNumber.format(s.value)}</strong>
            <span className="ae-donut-pct">{total ? ((s.value / total) * 100).toFixed(1) : "0.0"}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
