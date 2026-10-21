import { useMemo, useState } from "react";
import { niceScale, type ChartScale } from "../utils/chartScale";
import { compactNumber, fullNumber } from "../utils/chartFormat";
import { runs, SERIES, type ComboPoint, type ComboTooltip, type Series } from "../utils/comboChartData";

/// Past this many points the columns get slimmer and the axis labels thin out.
const DENSE_FROM = 16;

/**
 * A muted bar per point with two lines over it, a crosshair that snaps to the
 * point under the pointer, and one tooltip listing every value. Everything
 * shares one y scale. Each point is a focusable column, so the same readout
 * opens on keyboard focus and screen readers get the aria label.
 */
export function ComboChart({
  points,
  barLabel,
  lineLabels,
}: {
  points: ComboPoint[];
  barLabel: string;
  lineLabels: Record<Series, string>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const count = points.length;
  const dense = count > DENSE_FROM;
  const labelEvery = dense ? Math.ceil(count / 10) : 1;

  // One scale for the bars and both lines, so values are comparable with each
  // other and across points. The bar (a total) is usually the tallest, so it
  // normally sets the top.
  const scale: ChartScale = useMemo(
    () =>
      niceScale(
        Math.max(0, ...points.flatMap((p) => [p.bar ?? 0, p.online ?? 0, p.offline ?? 0])),
      ),
    [points],
  );

  const pct = (v: number) => `${(Math.max(0, v) / scale.max) * 100}%`;
  // Columns have no gap between them (the air is padding inside each), so a
  // point's centre is exactly (i + 0.5) / count of the plot - the same x for
  // its bar, its line points and its crosshair.
  const x = (i: number) => ((i + 0.5) / count) * 100;
  const y = (v: number) => 100 - (Math.max(0, v) / scale.max) * 100;
  const activePoint = active === null ? null : points[active];

  return (
    <>
      <div className="ae-mm-legend">
        <span className="ae-mm-legend-item">
          <span aria-hidden className="ae-mm-swatch" />
          {barLabel}
        </span>
        {SERIES.map((s) => (
          <span key={s} className="ae-mm-legend-item">
            <span aria-hidden className={`ae-mm-key ae-mm-key--${s}`} />
            {lineLabels[s]}
          </span>
        ))}
      </div>
      <div className="ae-mm-scroll">
        <div
          className={`ae-mm-chart${dense ? " ae-mm-chart--dense" : ""}`}
          style={dense ? { minWidth: `max(560px, ${count * 22}px)` } : undefined}
          onPointerLeave={() => setActive(null)}
        >
          <div aria-hidden className="ae-mm-yaxis">
            {scale.ticks.map((t) => (
              <span key={t} style={{ bottom: pct(t) }}>
                {compactNumber.format(t)}
              </span>
            ))}
          </div>
          <div className="ae-mm-plot">
            {scale.ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className={`ae-mm-grid${t === 0 ? " ae-mm-grid--base" : ""}`}
                style={{ bottom: pct(t) }}
              />
            ))}
            <div className="ae-mm-cols">
              {points.map((p, i) => (
                <div
                  key={p.key}
                  // Focusable + labelled so the figures (otherwise only a
                  // pointer tooltip) are reachable by keyboard and screen
                  // readers. Also the hit target: it spans the full height,
                  // so the pointer only has to be in the column.
                  tabIndex={0}
                  role="img"
                  aria-label={p.ariaLabel}
                  className={`ae-mm-col${active === i ? " ae-mm-col--active" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  {p.bar !== null && (
                    <span
                      className="ae-mm-bar"
                      style={{ height: pct(p.bar), minHeight: p.bar > 0 ? 2 : 0 }}
                    />
                  )}
                </div>
              ))}
            </div>
            <svg aria-hidden className="ae-mm-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
              {SERIES.flatMap((series) =>
                runs(points, series)
                  .filter((run) => run.length > 1)
                  .map((run) => (
                    <polyline
                      key={`${series}-${run[0].i}`}
                      className={`ae-mm-line ae-mm-line--${series}`}
                      vectorEffect="non-scaling-stroke"
                      points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                    />
                  )),
              )}
            </svg>
            {/* A lone point between two gaps has no line to show it, so it
                gets its dot permanently. */}
            {SERIES.flatMap((series) =>
              runs(points, series)
                .filter((run) => run.length === 1)
                .map(([p]) => (
                  <Dot key={`${series}-${p.i}`} series={series} left={x(p.i)} bottom={pct(p.v)} />
                )),
            )}
            {active !== null && activePoint && (
              <>
                <div aria-hidden className="ae-mm-cross" style={{ left: `${x(active)}%` }} />
                {SERIES.map((series) => {
                  const v = activePoint[series];
                  return v === null ? null : (
                    <Dot key={series} series={series} left={x(active)} bottom={pct(v)} />
                  );
                })}
                <Tooltip tip={activePoint.tooltip} index={active} count={count} />
              </>
            )}
          </div>
          <div aria-hidden className="ae-mm-xaxis">
            {points.map((p, i) => (
              <span
                key={p.key}
                className={`ae-mm-xlabel${p.current ? " ae-mm-xlabel--current" : ""}`}
              >
                <span className="ae-mm-xlabel-text">
                  {i % labelEvery === 0 || p.current ? p.label : ""}
                </span>
                {p.flag ? <span className="ae-mm-flag" /> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/// A line marker: at least 8px, with a 2px ring in the surface color so it
/// stays legible where it crosses the line or a bar.
function Dot({ series, left, bottom }: { series: Series; left: number; bottom: string }) {
  return (
    <span
      aria-hidden
      className={`ae-mm-dot ae-mm-dot--${series}`}
      style={{ left: `${left}%`, bottom }}
    />
  );
}

/// One readout for the point under the pointer or focus, listing every
/// series. Sits beside the crosshair (to the right in the first half of the
/// range, left in the second) so it never covers the point it describes.
/// Pointer-transparent, so it cannot steal the hover that opened it.
function Tooltip({ tip, index, count }: { tip: ComboTooltip; index: number; count: number }) {
  const side =
    index < count / 2
      ? { left: `calc(${((index + 0.5) / count) * 100}% + 14px)` }
      : { right: `calc(${((count - index - 0.5) / count) * 100}% + 14px)` };

  return (
    <div className="ae-mm-tip" style={side} role="presentation">
      <div className="ae-mm-tip-title">{tip.title}</div>
      {tip.rows ? (
        <>
          {tip.rows.map((r) => (
            <div key={r.label} className="ae-mm-tip-row">
              <span
                aria-hidden
                className={`ae-mm-dotkey${r.series ? ` ae-mm-dotkey--${r.series}` : ""}`}
              />
              <span className="ae-mm-tip-label">{r.label}</span>
              <strong>{fullNumber.format(r.value)}</strong>
            </div>
          ))}
          {tip.footer && (
            <div className={`ae-mm-tip-flags${tip.footer.alert ? " ae-mm-tip-flags--alert" : ""}`}>
              {tip.footer.text}
            </div>
          )}
        </>
      ) : (
        <div className="ae-mm-tip-empty">{tip.empty ?? "No entries recorded"}</div>
      )}
    </div>
  );
}
