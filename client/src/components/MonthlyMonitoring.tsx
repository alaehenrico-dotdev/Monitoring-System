import { useEffect, useRef, useState } from "react";
import {
  getMonthlyOverview,
  type MonthlyOverviewEntry,
} from "../api/dashboard";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { Button } from "./ui";
import { BarsSkeleton } from "./Skeleton";
import { colors } from "../theme";

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
// Each month stretches to fill this chart's own column (the dashboard's
// hero row gives it the wide right-hand column, see .ae-dash-hero-row) -
// this is only the floor it won't shrink below, so on a narrow screen the
// row scrolls sideways instead of squeezing every month unreadably thin.
const MONTH_MIN_WIDTH = 40;

// A function, not a module-level constant - this chunk, once loaded, stays
// in memory for as long as the tab is open (no re-import to re-evaluate a
// `const` against), so a `const CURRENT_YEAR = new Date().getFullYear()`
// would freeze at whatever year the Dashboard first happened to load in and
// never notice a real New Year's rollover for a tab left open that long.
function currentYear(): number {
  return new Date().getFullYear();
}

const ONLINE_COLOR = colors.yellow;
const OFFLINE_COLOR = colors.gold;

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Dashboard > Monthly Monitoring - a year-at-a-glance trend, on top of the
 * page's today-only stat cards above. Online and Offline are separate
 * stock pools (Section 2.1) that aren't expected to tally with each other,
 * so each month gets its own Online bar and Offline bar rather than one
 * bar that quietly adds them together - the combined figure only ever
 * shows up in the tooltip, explicitly labeled "Total", never as its own
 * unlabeled bar. Each bar is a snapshot as of that month's last recorded
 * entry (see services/dashboardAnalytics.service.ts).
 */
export function MonthlyMonitoring() {
  const [year, setYear] = useState(currentYear);
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

  // One shared scale for both series, so an Online bar and an Offline bar
  // in the same (or a different) month are visually comparable to each
  // other - a per-series scale would make e.g. a small Offline pool look
  // artificially as "full" as a much larger Online one.
  const max = data
    ? Math.max(
        1,
        ...data.flatMap((d) => [
          d.onlineRemainingStock ?? 0,
          d.offlineRemainingStock ?? 0,
        ]),
      )
    : 1;

  return (
    <section className="ae-dash-section">
      {/* The title row lives inside the card (not above it) so the card's top
          edge lines up with the stat cards in the column beside it. */}
      <div className="ae-dash-card">
        <h3
          className="ae-dash-heading"
          style={{ margin: 0, padding: "14px 20px 0" }}
        >
          Monthly Monitoring
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Previous year"
            >
              ‹
            </Button>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                minWidth: 44,
                textAlign: "center",
              }}
            >
              {year}
            </span>
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
        </h3>
        {error ? (
          <p
            style={{
              padding: 16,
              margin: 0,
              fontSize: 13,
              color: colors.danger,
            }}
          >
            {error}
          </p>
        ) : !data ? (
          <BarsSkeleton count={12} chartHeight={CHART_HEIGHT} />
        ) : (
          <div
            style={{
              padding: "8px 20px 12px",
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            <Legend />
            {/* Months stretch to fill the available width (see MonthBars'
                own flex:1) with no blank space; overflow-x: auto only
                kicks in once they've all shrunk to MONTH_MIN_WIDTH and
                still don't fit, scrolling sideways rather than squeezing
                further. */}
            <div
              style={{
                display: "flex",
                flex: 1,
                minHeight: CHART_HEIGHT,
                overflowX: "auto",
                overflowY: "hidden",
                marginTop: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  gap: 10,
                  minWidth: "100%",
                }}
              >
                {data.map((entry) => (
                  <MonthBars
                    key={entry.month}
                    entry={entry}
                    year={year}
                    max={max}
                    isCurrent={
                      year === currentYear() &&
                      entry.month === new Date().getMonth() + 1
                    }
                  />
                ))}
              </div>
            </div>
            <p
              style={{
                margin: "14px 0 0",
                fontSize: 11.5,
                color: colors.subtleInk,
              }}
            >
              Each bar pair is that month's Online/Offline remaining stock as of
              its last recorded entry - the two pools aren't expected to match.
              Hover a pair for the combined total and variance-flag count.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        fontSize: 11.5,
        color: colors.subtleInk,
      }}
    >
      <LegendItem color={ONLINE_COLOR} label="Online" />
      <LegendItem color={OFFLINE_COLOR} label="Offline" />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        aria-hidden
        style={{ width: 9, height: 9, borderRadius: 2, background: color }}
      />
      {label}
    </span>
  );
}

function MonthBars({
  entry,
  year,
  max,
  isCurrent,
}: {
  entry: MonthlyOverviewEntry;
  year: number;
  max: number;
  isCurrent: boolean;
}) {
  const hasData =
    entry.onlineRemainingStock !== null && entry.offlineRemainingStock !== null;
  const monthName = new Date(
    Date.UTC(year, entry.month - 1, 1),
  ).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const title = hasData
    ? `${monthName} — Online: ${entry.onlineRemainingStock!.toLocaleString()} · Offline: ${entry.offlineRemainingStock!.toLocaleString()} · Total: ${entry.totalRemainingStock!.toLocaleString()} · Variance flags: ${entry.varianceFlags}`
    : `${monthName} — No entries recorded yet`;

  return (
    // Focusable + labelled so the per-month figures (otherwise only a
    // mouse-hover tooltip) are reachable by keyboard and screen readers.
    <div
      title={title}
      tabIndex={0}
      role="img"
      aria-label={title}
      style={{
        flex: "1 1 0",
        minWidth: MONTH_MIN_WIDTH,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          width: "100%",
        }}
      >
        <ChannelBar
          value={entry.onlineRemainingStock}
          max={max}
          color={ONLINE_COLOR}
        />
        <ChannelBar
          value={entry.offlineRemainingStock}
          max={max}
          color={OFFLINE_COLOR}
        />
      </div>
      {entry.varianceFlags !== null && entry.varianceFlags > 0 && (
        <span
          aria-hidden
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: colors.danger,
            marginTop: 4,
          }}
        />
      )}
      <span
        style={{
          fontSize: 11,
          // The month still in progress reads as "now" in the same gold as
          // the rest of the dashboard's accents.
          fontWeight: isCurrent ? 800 : undefined,
          color: isCurrent ? colors.ink : colors.subtleInk,
          borderBottom: isCurrent ? `2px solid ${colors.gold}` : undefined,
          paddingBottom: isCurrent ? 1 : undefined,
          marginTop: entry.varianceFlags ? 3 : 6,
        }}
      >
        {MONTH_LABELS[entry.month - 1]}
      </span>
    </div>
  );
}

function ChannelBar({
  value,
  max,
  color,
}: {
  value: number | null;
  max: number;
  color: string;
}) {
  const hasData = value !== null;
  const heightPct = hasData ? Math.max(3, (value / max) * 100) : 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
        height: "100%",
      }}
    >
      {hasData && (
        <span
          style={{
            fontSize: 10.5,
            color: colors.subtleInk,
            marginBottom: 4,
            whiteSpace: "nowrap",
          }}
        >
          {compactNumber.format(value)}
        </span>
      )}
      <div
        style={{
          width: "100%",
          // Bars widen with their column (up to 44px) so a wide desktop chart
          // isn't a row of thin sticks with empty space around them.
          maxWidth: 44,
          height: hasData ? `${heightPct}%` : 2,
          borderRadius: 2,
          background: hasData ? color : "transparent",
          border: hasData ? undefined : `1px dashed ${colors.border}`,
          transition: "height 0.3s ease",
        }}
      />
    </div>
  );
}
