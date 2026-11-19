import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { niceScale } from "../utils/chartScale";
import { compactNumber, fullNumber } from "../utils/chartFormat";
import { smoothPath } from "../utils/smoothPath";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";
import { useChartPrefs } from "../context/ThemeContext";
import { STACK_GAP_PX, STACK_ROWS, stackGrid } from "../utils/stackGrid";

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
  /// A second, smaller axis line under the label (the day of the week); shown with the label.
  sub?: string;
  /// Tooltip heading.
  title: string;
  /// Accessible name of the focusable column.
  ariaLabel: string;
  /// One value per series key; null = nothing recorded (a gap, never zero).
  values: Record<string, number | null>;
  current?: boolean;
}

/**
 * Multi-series chart (lines, grouped bars or filled areas, per Settings > Appearance > Charts): one mark per series on a shared, round-numbered y
 * scale, a crosshair that snaps to the day under the pointer and one tooltip
 * listing every value. Each day is a focusable column so the same readout opens
 * on keyboard focus and screen readers get the aria label. Days with no entry
 * either join across (default) or are drawn as 0 (`zeroFill`).
 */
/// Narrowest a day's column gets on a phone before the plot scrolls sideways instead.
const PHONE_DAY_WIDTH = 44;


const hasData = (p: FlowPoint) => Object.values(p.values).some((v) => v !== null && v !== undefined);

export function FlowLineChart({
  points,
  series,
  zeroFill = false,
  scrollOnPhone = false,
}: {
  points: FlowPoint[];
  series: FlowSeries[];
  /// Draw a day with no entry as 0, so every curve runs across the whole
  /// window from the baseline. Markers and the tooltip still only show real
  /// readings, so a drawn zero is never presented as a recorded one.
  zeroFill?: boolean;
  /// On a phone, keep every day a readable width and scroll the plot sideways (the y axis
  /// stays put) rather than squeezing a long period into the screen.
  scrollOnPhone?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const { chartType, chartLook } = useChartPrefs();
  const stacked = chartType === "stack";
  const bars = chartType === "bar" || stacked;
  const count = points.length;
  // Whatever draws the plot afresh (another kind of chart, another period) plays the load animation again and
  // is not a live update; after it has played the chart counts as settled and changes arrive as quick, local ones.
  const plotKey = `${chartType}:${points[0]?.key}:${count}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  // The plot's height, for the stacked blocks' pixel grid. Read by an observer, so it also follows a resize or a zoom.
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotHeight, setPlotHeight] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPlotHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [plotKey]);
  const grid = useMemo(() => stackGrid(plotHeight, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1), [plotHeight]);
  const stackRows = grid?.rows ?? STACK_ROWS;
  useEffect(() => {
    const t = setTimeout(() => setSettledKey(plotKey), 1800);
    return () => clearTimeout(t);
  }, [plotKey]);
  const settled = settledKey === plotKey;
  // Days whose figures just changed (someone saved an entry): flashed briefly. Compared while rendering, the way
  // React recommends for state derived from a prop change, and only once the chart has settled.
  const [seen, setSeen] = useState(points);
  const [flash, setFlash] = useState<string[]>([]);
  if (seen !== points) {
    setSeen(points);
    if (settled) {
      const before = new Map(seen.map((p) => [p.key, JSON.stringify(p.values)]));
      const changed = points.filter((p) => before.has(p.key) && before.get(p.key) !== JSON.stringify(p.values)).map((p) => p.key);
      if (changed.length) setFlash(changed);
    }
  }
  useEffect(() => {
    if (!flash.length) return;
    const t = setTimeout(() => setFlash([]), 1500);
    return () => clearTimeout(t);
  }, [flash]);
  const labelEvery = Math.max(1, Math.ceil(count / 7));
  const phone = useReadOnlyPhone();
  // A phone is too narrow for a label under every day: label every few days, counted back from the latest
  // day so that one is always named, and the current day only when no label sits next to it.
  // A scrolling plot has room for a label on every other day.
  const scrolls = phone && scrollOnPhone;
  const phoneEvery = scrolls ? Math.min(2, count) : Math.max(1, Math.ceil(count / 6));
  const chartRef = useRef<HTMLDivElement>(null);
  const lastKey = points[count - 1]?.key;
  // Open on the latest days: that end of the period is the one being watched.
  useEffect(() => {
    const el = chartRef.current;
    if (scrolls && el) el.scrollLeft = el.scrollWidth;
  }, [scrolls, count, lastKey]);
  const labelled = (i: number, p: FlowPoint): boolean => {
    if (!phone) return i % labelEvery === 0 || p.current || (count <= 14 && hasData(p));
    const onGrid = (j: number) => (count - 1 - j) % phoneEvery === 0;
    if (onGrid(i)) return true;
    if (!p.current) return false;
    // Name the current day only when it is at least two days from the nearest grid label (a label is wider than
    // one day's column, so a closer one would run into it).
    const gap = (count - 1 - i) % phoneEvery;
    return Math.min(gap, phoneEvery - gap) >= 2;
  };

  const scale = useMemo(
    () =>
      niceScale(
        Math.max(
          0,
          // Stacked columns reach the day's TOTAL; every other drawing reaches its tallest single value.
          ...(stacked
            ? points.map((p) => series.reduce((sum, s) => sum + Math.max(0, p.values[s.key] ?? 0), 0))
            : points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0))),
        ),
      ),
    [points, series, stacked],
  );
  const x = (i: number) => ((i + 0.5) / count) * 100;
  const y = (v: number) => 100 - (Math.max(0, v) / scale.max) * 100;
  const pct = (v: number) => `${(Math.max(0, v) / scale.max) * 100}%`;

  /// One day's blocks per series: its value in rows (rounded, at least one for any recorded amount), trimmed from
  /// the top so the pile never rises past the plot.
  const stackBlocks = (p: FlowPoint) => {
    let room = stackRows;
    return series.map((s) => {
      const v = Math.max(0, p.values[s.key] ?? 0);
      const wanted = v > 0 ? Math.max(1, Math.round((v / scale.max) * stackRows)) : 0;
      const blocks = Math.min(wanted, room);
      room -= blocks;
      return { s, blocks };
    });
  };

  const paths = useMemo(
    () =>
      series.map((s) => {
        const coords = points.flatMap((p, i) => {
          const v = p.values[s.key] ?? (zeroFill ? 0 : null);
          return v === null ? [] : [{ x: x(i), y: y(v) }];
        });
        const d = smoothPath(coords);
        // The area under the curve: the same path, closed down to the baseline.
        const fill = coords.length > 1 ? `${d} L ${coords[coords.length - 1].x} 100 L ${coords[0].x} 100 Z` : "";
        return {
          s,
          d,
          fill,
          lone: !zeroFill && points.filter((p) => p.values[s.key] !== null && p.values[s.key] !== undefined).length === 1,
        };
      }),
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
      <div
        ref={chartRef}
        className={`${scrolls ? "ae-fl-chart ae-fl-chart--scroll" : "ae-fl-chart"}${points.some((p) => p.sub) ? " ae-fl-chart--sub" : ""}`}
        data-type={chartType}
        data-settled={settled ? "true" : undefined}
        data-look={chartLook}
        style={scrolls ? ({ "--ae-fl-min": `${count * PHONE_DAY_WIDTH}px` } as CSSProperties) : undefined}
        onPointerLeave={() => setActive(null)}
      >
        <div aria-hidden className="ae-fl-yaxis">
          {scale.ticks.map((t) => (
            <span key={t} style={{ bottom: pct(t) }}>
              {compactNumber.format(t)}
            </span>
          ))}
        </div>
        {/* Keyed by the drawing and the days shown, so it plays its load animation whenever the chart is shown or
            its kind or period changes, but not on a live refresh of the same days. */}
        <div className="ae-fl-plot" key={plotKey} ref={plotRef}>
          {scale.ticks.map((t) => (
            <div key={t} aria-hidden className={`ae-fl-grid${t === 0 ? " ae-fl-grid--base" : ""}`} style={{ bottom: pct(t) }} />
          ))}
          {/* Today is still being entered: a softly breathing band behind its column says the figures are live. */}
          {points.map((p, i) =>
            p.current ? <div key="today" aria-hidden className="ae-fl-today" style={{ left: `${(i / count) * 100}%`, width: `${100 / count}%` }} /> : null,
          )}
          {/* Encoding often runs a little behind: a day with nothing entered blinks an amber band, so a gap is noticed
              and can be chased. Not when the whole period is empty (the chart already says so). */}
          {points.some(hasData) &&
            points.map((p, i) =>
              hasData(p) ? null : <div key={`missing-${p.key}`} aria-hidden className="ae-fl-missing" style={{ left: `${(i / count) * 100}%`, width: `${100 / count}%` }} />,
            )}
          {points.map((p, i) =>
            flash.includes(p.key) ? <div key={`flash-${p.key}`} aria-hidden className="ae-fl-flash" style={{ left: `${(i / count) * 100}%`, width: `${100 / count}%` }} /> : null,
          )}
          {bars ? (
            <div aria-hidden className="ae-fl-bars">
              {points.map((p, i) => (
                <div key={p.key} className={stacked ? "ae-fl-bargroup ae-fl-bargroup--stack" : "ae-fl-bargroup"} style={{ left: `${(i / count) * 100}%`, width: `${100 / count}%`, "--ae-d": `${Math.round((i / count) * 420)}ms` } as CSSProperties}>
                  {stacked
                    ? (() => {
                        // The block's place in its pile, bottom first, so the pile can build upward.
                        let place = 0;
                        return stackBlocks(p).flatMap((b) =>
                          Array.from({ length: b.blocks }, (_, n) => (
                            <span
                              key={`${b.s.key}-${n}`}
                              className="ae-fl-bar"
                              style={
                                {
                                  // The measured pixel grid, or (before the height is known) the same thing as percentages.
                                  height: grid ? `${grid.block}px` : `calc(${100 / STACK_ROWS}% - ${STACK_GAP_PX}px)`,
                                  ...(grid ? { marginTop: `${grid.gap}px` } : {}),
                                  background: b.s.color,
                                  "--ae-n": place++,
                                } as CSSProperties
                              }
                            />
                          )),
                        );
                      })()
                    : series.map((s) => {
                        const v = p.values[s.key] ?? (zeroFill ? 0 : null);
                        return <span key={s.key} className="ae-fl-bar" style={{ height: v === null ? 0 : v > 0 ? `max(2px, ${pct(v)})` : 0, background: s.color }} />;
                      })}
                </div>
              ))}
            </div>
          ) : (
            <svg aria-hidden className="ae-fl-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
              {chartType === "area" &&
                paths.map(({ s, fill, lone }) => (fill && !lone ? <path key={`${s.key}-fill`} d={fill} className="ae-fl-area" style={{ fill: s.color, d: `path("${fill}")` } as CSSProperties} /> : null))}
              {paths.map(({ s, d, lone }) =>
                d && !lone ? <path key={s.key} d={d} className="ae-fl-line" vectorEffect="non-scaling-stroke" style={{ stroke: s.color, d: `path("${d}")` } as CSSProperties} /> : null,
              )}
            </svg>
          )}
          {/* Every recorded reading keeps a marker, so a sparse period (a few
              days with entries among empty ones) reads as the real readings it
              is, not as a line drawn out of nothing. */}
          {!bars &&
            series.flatMap((s) =>
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
              {bars ? (
                <div aria-hidden className="ae-fl-cross ae-fl-cross--band" style={{ left: `${(active / count) * 100}%`, width: `${100 / count}%` }} />
              ) : (
                <div aria-hidden className="ae-fl-cross" style={{ left: `${x(active)}%` }} />
              )}
              {!bars && series.map((s) => {
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
                <div className="ae-fl-tip-title">
                  {activePoint.title}
                  {activePoint.current && <span className="ae-fl-tip-live"> · in progress</span>}
                </div>
                {series.some((s) => activePoint.values[s.key] != null) ? (
                  [...series.map((s) => {
                    const v = activePoint.values[s.key];
                    return v === null || v === undefined ? null : (
                      <div key={s.key} className="ae-fl-tip-row">
                        <i aria-hidden className="ae-fl-key" style={{ background: s.color }} />
                        <span>{s.label}</span>
                        <strong>{fullNumber.format(v)}</strong>
                      </div>
                    );
                  }),
                  stacked ? (
                    <div key="total" className="ae-fl-tip-row ae-fl-tip-total">
                      <span>Total</span>
                      <strong>{fullNumber.format(series.reduce((sum, s) => sum + (activePoint.values[s.key] ?? 0), 0))}</strong>
                    </div>
                  ) : null]
                ) : (
                  <div className="ae-fl-tip-empty">No entries recorded</div>
                )}
              </div>
            </>
          )}
        </div>
        <div aria-hidden className="ae-fl-xaxis">
          {points.map((p, i) => {
            const named = labelled(i, p);
            return (
            <span key={p.key} className={p.current ? (named ? "ae-fl-xlabel ae-fl-xlabel--current ae-fl-xlabel--live" : "ae-fl-xlabel ae-fl-xlabel--current") : "ae-fl-xlabel"}>
              {named ? p.label : ""}
              {named && p.sub && <small className="ae-fl-xsub">{p.sub}</small>}
            </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
