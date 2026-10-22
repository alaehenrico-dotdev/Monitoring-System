import { useMemo, useState } from "react";
import { niceScale } from "../utils/chartScale";
import { compactNumber, fullNumber } from "../utils/chartFormat";
import { smoothPath } from "../utils/smoothPath";

export interface FlowSeries {
  key: string;
  label: string;
  /// CSS colour (a token like var(--ae-viz-online)).
  color: string;
}

export interface FlowPoint {
  key: string;
  /// Axis text; thinned out when there are many points.
  label: string;
  /// Tooltip heading.
  title: string;
  /// Accessible name of the focusable column.
  ariaLabel: string;
  /// One value per series key; null = nothing recorded (a gap, never zero).
  values: Record<string, number | null>;
  current?: boolean;
}

/**
 * Smooth multi-line chart: one curve per series on a shared, round-numbered y
 * scale, a crosshair that snaps to the day under the pointer and one tooltip
 * listing every value. Each day is a focusable column so the same readout opens
 * on keyboard focus and screen readers get the aria label. Days with no entry
 * either join across (default) or are drawn as 0 (`zeroFill`).
 */
const hasData = (p: FlowPoint) => Object.values(p.values).some((v) => v !== null && v !== undefined);

export function FlowLineChart({
  points,
  series,
  zeroFill = false,
}: {
  points: FlowPoint[];
  series: FlowSeries[];
  /// Draw a day with no entry as 0, so every curve runs across the whole
  /// window from the baseline. Markers and the tooltip still only show real
  /// readings, so a drawn zero is never presented as a recorded one.
  zeroFill?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const count = points.length;
  const labelEvery = Math.max(1, Math.ceil(count / 7));

  const scale = useMemo(
    () => niceScale(Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)))),
    [points, series],
  );
  const x = (i: number) => ((i + 0.5) / count) * 100;
  const y = (v: number) => 100 - (Math.max(0, v) / scale.max) * 100;
  const pct = (v: number) => `${(Math.max(0, v) / scale.max) * 100}%`;

  const paths = useMemo(
    () =>
      series.map((s) => ({
        s,
        d: smoothPath(
          points.flatMap((p, i) => {
            const v = p.values[s.key] ?? (zeroFill ? 0 : null);
            return v === null ? [] : [{ x: x(i), y: y(v) }];
          }),
        ),
        lone: !zeroFill && points.filter((p) => p.values[s.key] !== null && p.values[s.key] !== undefined).length === 1,
      })),
    // x / y close over count and scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, series, scale, zeroFill],
  );

  const activePoint = active === null ? null : points[active];

  return (
    <>
      <div className="ae-fl-legend">
        {series.map((s) => (
          <span key={s.key} className="ae-fl-legend-item">
            <i aria-hidden className="ae-fl-key" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="ae-fl-chart" onPointerLeave={() => setActive(null)}>
        <div aria-hidden className="ae-fl-yaxis">
          {scale.ticks.map((t) => (
            <span key={t} style={{ bottom: pct(t) }}>
              {compactNumber.format(t)}
            </span>
          ))}
        </div>
        <div className="ae-fl-plot">
          {scale.ticks.map((t) => (
            <div key={t} aria-hidden className={`ae-fl-grid${t === 0 ? " ae-fl-grid--base" : ""}`} style={{ bottom: pct(t) }} />
          ))}
          <svg aria-hidden className="ae-fl-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            {paths.map(({ s, d, lone }) =>
              d && !lone ? <path key={s.key} d={d} className="ae-fl-line" vectorEffect="non-scaling-stroke" style={{ stroke: s.color }} /> : null,
            )}
          </svg>
          {/* Every recorded reading keeps a marker, so a sparse period (a few
              days with entries among empty ones) reads as the real readings it
              is, not as a line drawn out of nothing. */}
          {series.flatMap((s) =>
            points.flatMap((p, i) =>
              p.values[s.key] === null || p.values[s.key] === undefined
                ? []
                : [<span key={`${s.key}-${i}`} aria-hidden className="ae-fl-dot ae-fl-dot--sm" style={{ left: `${x(i)}%`, bottom: pct(p.values[s.key] as number), background: s.color }} />],
            ),
          )}
          <div className="ae-fl-cols">
            {points.map((p, i) => (
              <div
                key={p.key}
                tabIndex={0}
                role="img"
                aria-label={p.ariaLabel}
                className="ae-fl-col"
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
          </div>
          {active !== null && activePoint && (
            <>
              <div aria-hidden className="ae-fl-cross" style={{ left: `${x(active)}%` }} />
              {series.map((s) => {
                const v = activePoint.values[s.key];
                return v === null || v === undefined ? null : (
                  <span key={s.key} aria-hidden className="ae-fl-dot" style={{ left: `${x(active)}%`, bottom: pct(v), background: s.color }} />
                );
              })}
              <div
                className="ae-fl-tip"
                role="presentation"
                style={
                  active < count / 2
                    ? { left: `calc(${x(active)}% + 14px)` }
                    : { right: `calc(${100 - x(active)}% + 14px)` }
                }
              >
                <div className="ae-fl-tip-title">{activePoint.title}</div>
                {series.some((s) => activePoint.values[s.key] != null) ? (
                  series.map((s) => {
                    const v = activePoint.values[s.key];
                    return v === null || v === undefined ? null : (
                      <div key={s.key} className="ae-fl-tip-row">
                        <i aria-hidden className="ae-fl-key" style={{ background: s.color }} />
                        <span>{s.label}</span>
                        <strong>{fullNumber.format(v)}</strong>
                      </div>
                    );
                  })
                ) : (
                  <div className="ae-fl-tip-empty">No entries recorded</div>
                )}
              </div>
            </>
          )}
        </div>
        <div aria-hidden className="ae-fl-xaxis">
          {points.map((p, i) => (
            <span key={p.key} className={p.current ? "ae-fl-xlabel ae-fl-xlabel--current" : "ae-fl-xlabel"}>
              {i % labelEvery === 0 || p.current || (count <= 14 && hasData(p)) ? p.label : ""}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
