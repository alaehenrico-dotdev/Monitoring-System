import { useEffect, useMemo, useRef, useState } from "react";
import {
  getMonthlyOverview,
  type MonthlyOverviewEntry,
} from "../api/dashboard";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { fullNumber } from "../utils/chartFormat";
import { ComboChart } from "./ComboChart";
import { hasLines, type ComboPoint } from "../utils/comboChartData";
import { Button } from "./ui";
import { BarsSkeleton } from "./Skeleton";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
// Floor for the plot height - the chart itself grows to fill whatever height
// the dashboard's hero row gives this card (see .ae-dash-hero-row).
const CHART_HEIGHT = 240;

// A function, not a module-level constant - this chunk, once loaded, stays
// in memory for as long as the tab is open (no re-import to re-evaluate a
// `const` against), so a `const CURRENT_YEAR = new Date().getFullYear()`
// would freeze at whatever year the Dashboard first happened to load in and
// never notice a real New Year's rollover for a tab left open that long.
function currentYear(): number {
  return new Date().getFullYear();
}

type View = "chart" | "table";

function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function describeMonth(year: number, entry: MonthlyOverviewEntry): string {
  const name = monthName(year, entry.month);
  if (entry.onlineRemainingStock === null || entry.offlineRemainingStock === null) {
    return `${name} — No entries recorded yet`;
  }
  return `${name} — Online: ${fullNumber.format(entry.onlineRemainingStock)} · Offline: ${fullNumber.format(entry.offlineRemainingStock)} · Total: ${fullNumber.format(entry.totalRemainingStock ?? 0)} · Variance flags: ${entry.varianceFlags ?? 0}`;
}

function monthPoints(data: MonthlyOverviewEntry[], year: number): ComboPoint[] {
  const now = new Date();
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : null;
  return data.map((entry) => {
    const hasData = entry.onlineRemainingStock !== null && entry.offlineRemainingStock !== null;
    const flags = entry.varianceFlags ?? 0;
    return {
      key: entry.month,
      label: MONTH_LABELS[entry.month - 1],
      ariaLabel: describeMonth(year, entry),
      bar: entry.totalRemainingStock,
      online: entry.onlineRemainingStock,
      offline: entry.offlineRemainingStock,
      flag: flags > 0,
      current: entry.month === currentMonth,
      tooltip: {
        title: monthName(year, entry.month),
        ...(hasData
          ? {
              rows: [
                { label: "Total", value: entry.totalRemainingStock ?? 0 },
                { label: "Online", value: entry.onlineRemainingStock!, series: "online" as const },
                { label: "Offline", value: entry.offlineRemainingStock!, series: "offline" as const },
              ],
              footer: {
                text: flags === 0 ? "No variance flags" : `${flags} variance ${flags === 1 ? "flag" : "flags"}`,
                alert: flags > 0,
              },
            }
          : { empty: "No entries recorded yet" }),
      },
    };
  });
}

/**
 * Dashboard > Monthly Monitoring - a year-at-a-glance trend, on top of the
 * page's today-only stat cards above. Online and Offline are separate
 * stock pools (Section 2.1) that aren't expected to tally with each other,
 * so each month gets its own Online column and Offline column rather than one
 * column that quietly adds them together - the combined figure only ever
 * shows up in the tooltip and the table view, explicitly labeled "Total",
 * never as its own unlabeled bar. Each column is a snapshot as of that
 * month's last recorded entry (see services/dashboardAnalytics.service.ts).
 */
export function MonthlyMonitoring() {
  const [year, setYear] = useState(currentYear);
  const [view, setView] = useState<View>("chart");
  const [data, setData] = useState<MonthlyOverviewEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realtimeVersion = useRealtimeVersion();
  // Lets the fetch below tell "nothing to show yet" (surface the error)
  // from "a refresh failed but the bars are already on screen" (ignore it).
  const hasDataRef = useRef(false);
  useEffect(() => {
    hasDataRef.current = data !== null;
  });

  useResetOnKeyChange(String(year), () => {
    setData(null);
    setError(null);
  });
  useEffect(() => {
    // Also re-runs on every realtime "data changed" tick so the current
    // month's bars follow the stat cards instead of going stale while the
    // page stays open. A refetch keeps the old bars on screen (only a year
    // change resets to the skeleton), and a failed refetch is ignored when
    // there is already data to show.
    let cancelled = false;
    getMonthlyOverview(year)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (cancelled || hasDataRef.current) return;
        setError(
          e instanceof Error ? e.message : "Unable to load monthly monitoring",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [year, realtimeVersion]);

  const points = useMemo(() => (data ? monthPoints(data, year) : null), [data, year]);

  return (
    <section className="ae-dash-section">
      {/* The title row lives inside the card (not above it) so the card's top
          edge lines up with the stat cards in the column beside it. */}
      <div className="ae-dash-card">
        <h3 className="ae-dash-heading ae-mm-heading">
          Monthly Monitoring
          <span className="ae-mm-controls">
            <span className="ae-mm-view" role="group" aria-label="Chart view">
              {(["chart", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="ae-mm-view-btn"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "chart" ? "Chart" : "Table"}
                </button>
              ))}
            </span>
            <span className="ae-mm-year">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setYear((y) => y - 1)}
                aria-label="Previous year"
              >
                ‹
              </Button>
              <span className="ae-mm-year-label">{year}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setYear((y) => y + 1)}
                disabled={year >= currentYear()}
                aria-label="Next year"
              >
                ›
              </Button>
            </span>
          </span>
        </h3>
        {error ? (
          <p className="ae-mm-error">{error}</p>
        ) : !data ? (
          <BarsSkeleton count={12} chartHeight={CHART_HEIGHT} />
        ) : (
          <div className="ae-mm-body">
            {view === "chart" && points ? (
              <ComboChart
                points={points}
                barLabel="Total"
                lineLabels={{ online: "Online", offline: "Offline" }}
              />
            ) : (
              <MonthTable data={data} year={year} />
            )}
            <p className="ae-mm-note">
              Lines are each pool's remaining stock as of that month's last
              recorded entry - the two pools aren't expected to match. Bars are
              their combined total. Hover or focus a month for the figures.
              {view === "chart" && points && !hasLines(points) &&
                " A line needs two consecutive months with entries, so until then each month shows as a dot."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/// The same figures as the chart, for anyone who'd rather read than hover:
/// nothing the tooltip shows is gated behind it.
function MonthTable({
  data,
  year,
}: {
  data: MonthlyOverviewEntry[];
  year: number;
}) {
  const cell = (v: number | null) => (v === null ? "—" : fullNumber.format(v));
  return (
    <div className="ae-mm-tablewrap">
      <table className="ae-table ae-table--compact">
        <thead>
          <tr>
            {["Month", "Online", "Offline", "Total", "Variance flags"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.month}>
              <td>{monthName(year, entry.month)}</td>
              <td>{cell(entry.onlineRemainingStock)}</td>
              <td>{cell(entry.offlineRemainingStock)}</td>
              <td>{cell(entry.totalRemainingStock)}</td>
              <td>{cell(entry.varianceFlags)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
