import { useEffect, useMemo, useState } from "react";
import { getStockFlow, type StockFlowEntry } from "../api/stockFlow";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { addDaysIso } from "../utils/dateMath";
import { formatDateDisplay } from "../utils/dateFormat";
import { fullNumber } from "../utils/chartFormat";
import { getCurrentShiftAndDate } from "../utils/shift";
import { FlowLineChart, type FlowPoint, type FlowSeries } from "./FlowLineChart";
import { ShareDonut } from "./ShareDonut";
import { BarsSkeleton } from "./Skeleton";

const DAY_OPTIONS = [7, 14, 30];
const DEFAULT_DAYS = 14;
const CHART_HEIGHT = 240;

/// "2026-10-06" -> "Oct 6", built from the parts so a timezone behind UTC
/// can't shift the day.
function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SERIES: FlowSeries[] = [
  { key: "production", label: "Produced", color: "var(--ae-viz-produced)" },
  { key: "fulfillment", label: "Fulfilled online", color: "var(--ae-viz-online)" },
  { key: "delivery", label: "Delivered offline", color: "var(--ae-viz-offline)" },
];

function flowPoints(rows: StockFlowEntry[], today: string): FlowPoint[] {
  return rows.map((e) => {
    const empty = e.production === null && e.fulfillment === null && e.delivery === null;
    const side = (label: string, v: number | null) => `${label}: ${v === null ? "no entry" : fullNumber.format(v)}`;
    return {
      key: e.date,
      label: shortDate(e.date),
      title: formatDateDisplay(e.date),
      ariaLabel: empty
        ? `${formatDateDisplay(e.date)} — No entries recorded`
        : `${formatDateDisplay(e.date)} — ${side("Produced", e.production)} · ${side("Fulfilled online", e.fulfillment)} · ${side("Delivered offline", e.delivery)}`,
      values: { production: e.production, fulfillment: e.fulfillment, delivery: e.delivery },
      current: e.date === today,
    };
  });
}

/**
 * Dashboard > Stock flow - how stock moved day by day: what was produced, what
 * Online fulfilled and what Offline delivered, as three smooth lines on one
 * scale so they are directly comparable, with the split of what went out
 * between the two channels underneath. A day nobody encoded is drawn at 0 so
 * every line runs across the whole window; only recorded days get a marker and
 * figures in the tooltip.
 */
export function StockFlowChart() {
  const today = getCurrentShiftAndDate().date;
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [rows, setRows] = useState<StockFlowEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realtimeVersion = useRealtimeVersion();
  const from = addDaysIso(today, -(days - 1));

  useEffect(() => {
    // Also re-runs on every realtime tick so today follows the entry grids; a
    // refetch keeps the old chart on screen, and a failed one is ignored when
    // there is already data.
    let cancelled = false;
    getStockFlow(from, today)
      .then((d) => {
        if (cancelled) return;
        setRows(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows((cur) => {
          if (cur === null) setError(e instanceof Error ? e.message : "Unable to load stock flow");
          return cur;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [from, today, realtimeVersion]);

  const points = useMemo(() => (rows ? flowPoints(rows, today) : null), [rows, today]);
  const anyData = rows?.some((r) => r.production !== null || r.fulfillment !== null || r.delivery !== null) ?? false;
  const daysWithData = rows?.filter((r) => r.production !== null || r.fulfillment !== null || r.delivery !== null).length ?? 0;
  const outOnline = rows?.reduce((sum, r) => sum + (r.fulfillment ?? 0), 0) ?? 0;
  const outOffline = rows?.reduce((sum, r) => sum + (r.delivery ?? 0), 0) ?? 0;

  return (
    <section className="ae-dash-section">
      <div className="ae-dash-card">
        <h3 className="ae-dash-heading ae-mm-heading">
          Stock flow, last {days} days
          <span className="ae-mm-controls">
            <span className="ae-mm-view" role="group" aria-label="Days shown">
              {DAY_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="ae-mm-view-btn"
                  aria-pressed={days === n}
                  onClick={() => {
                    if (n === days) return;
                    setRows(null);
                    setError(null);
                    setDays(n);
                  }}
                >
                  {n}d
                </button>
              ))}
            </span>
          </span>
        </h3>
        {error ? (
          <p className="ae-mm-error">{error}</p>
        ) : !points ? (
          <BarsSkeleton count={Math.min(days, 14)} chartHeight={CHART_HEIGHT} label="Loading stock flow…" />
        ) : (
          <div className="ae-mm-body">
            <FlowLineChart points={points} series={SERIES} zeroFill />
            <p className="ae-mm-note">
              {anyData
                ? `Units per day, each product counted in its own unit. ${daysWithData} of ${days} days have entries; days without entries are drawn at 0. Hover or focus a day for the figures.`
                : "Nothing was recorded in this period."}
            </p>
            {anyData && (
              <div className="ae-fl-split">
                <h4 className="ae-fl-split-title">
                  Out by channel <span>Share of the last {days} days</span>
                </h4>
                <ShareDonut
                  centerLabel="Total out"
                  slices={[
                    { key: "online", label: "Online fulfilled", value: outOnline, color: "var(--ae-viz-online)" },
                    { key: "offline", label: "Offline delivered", value: outOffline, color: "var(--ae-viz-offline)" },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
