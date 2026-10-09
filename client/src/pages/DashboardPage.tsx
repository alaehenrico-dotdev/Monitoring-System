import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getTotalStocks } from "../api/totalStocks";
import { listProducts } from "../api/products";
import { listChangeLog } from "../api/changeLog";
import type { ChangeLogEntry, Product, TotalStockRow } from "../types";
import { ACTION_COLOR, TABLE_LABELS } from "../config/changeLog";
import { formatRelativeTime } from "../utils/dateFormat";
import { StatCardsSkeleton, TableSkeleton } from "../components/Skeleton";
import { MonthlyMonitoring } from "../components/MonthlyMonitoring";
import {
  EntryStatusCard,
  LowStockCard,
  VarianceTopCard,
} from "../components/DashboardInsights";
import {
  LowestDaysLeftCard,
  NeedsRestockCard,
  useDaysOfStock,
} from "../components/RestockCards";
import { DatePicker } from "../components/DatePicker";
import { Toolbar } from "../components/Toolbar";
import { Button } from "../components/ui";
import { EndOfDayPackDialog } from "../components/EndOfDayPackDialog";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import {
  TagIcon,
  BoxIcon,
  LayersIcon,
  ReportIcon,
  ChevronRightIcon,
} from "../components/icons";
import { colors } from "../theme";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { getCurrentShiftAndDate } from "../utils/shift";

type Totals = {
  /// Online and Offline are separate stock pools (Section 2.1) - each gets
  /// its own card rather than a combined sum, since summing them implies a
  /// single pool that doesn't really exist.
  online: number;
  offline: number;
};

// Fetched 8; CSS shows 5 on short windows and all 8 on tall ones.
const RECENT_ACTIVITY_LIMIT = 8;
const COUNT_UP_DURATION_MS = 700;
// The active-SKU count barely ever changes, so realtime ticks (one per
// burst of encoder saves) reuse the last answer instead of re-requesting the
// whole product list every time.
const PRODUCTS_REFRESH_MS = 60_000;
// The change log endpoint returns the whole log (the dashboard keeps only
// the newest few), so realtime refreshes of the feed wait for a burst of
// saves to settle instead of re-downloading it on every tick.
const ACTIVITY_REFRESH_DELAY_MS = 3_000;

// The app's major day-to-day pages (mirrors the nav drawer's own "Data
// Entry" section, minus Dashboard itself) - one-click shortcuts so landing
// here doesn't require opening the nav drawer first for the common case.
const QUICK_LINKS: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/online", label: "Online Entry", icon: <BoxIcon /> },
  { to: "/offline", label: "Offline Entry", icon: <BoxIcon /> },
  { to: "/manual-count", label: "Manual Count", icon: <LayersIcon /> },
  { to: "/total-stocks", label: "Total Stocks", icon: <LayersIcon /> },
  { to: "/daily-report", label: "Daily Report", icon: <ReportIcon /> },
];

// Animates a displayed number from its previous value up (or down) to
// `target` whenever `target` changes, instead of the digits just snapping
// in - used by the stat cards so the headline numbers count up on first load
// and re-count if a value changes underneath them.
//
// `prevRef` (not `useState`) holds the animation's start point: it has to
// survive across renders without triggering one. It is updated on every
// frame, so if `target` changes mid-animation the next count starts from
// what's on screen rather than jumping back to the last finished value.
//
// `target === undefined` (data hasn't loaded yet) leaves the displayed value
// alone - the cards render "—" for that case instead.
function useCountUp(
  target: number | undefined,
  duration = COUNT_UP_DURATION_MS,
) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // Respect the OS "reduce motion" setting: show the number immediately,
  // the instant `target` changes - done during render (not the animation
  // effect below) since there's no animation to run in that case at all.
  const [snappedTo, setSnappedTo] = useState<number | undefined>(undefined);
  if (reducedMotion && target !== undefined && target !== snappedTo) {
    setSnappedTo(target);
    setDisplay(target);
  }
  // Refs can't be written during render itself (only state can) - keeping
  // prevRef in sync with a just-snapped value happens here instead, so a
  // later animation (reduced-motion turned back off, or target changes
  // again) still starts from what's actually on screen.
  useEffect(() => {
    if (snappedTo !== undefined) prevRef.current = snappedTo;
  }, [snappedTo]);

  useEffect(() => {
    if (target === undefined || reducedMotion) return;
    const targetValue = target;
    const start = prevRef.current;
    const delta = targetValue - start;
    if (delta === 0) return;

    const startTime = performance.now();
    let frame: number;

    function tick(now: number) {
      const progress = Math.min((now - startTime) / duration, 1);
      // Ease-out cubic: fast at the start, settles gently into the final number.
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(start + delta * eased);
      prevRef.current = value;
      setDisplay(value);

      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reducedMotion]);

  return display;
}

function summarize(rows: TotalStockRow[]): Totals {
  return {
    online: rows.reduce(
      (sum, row) => sum + Number(row.onlineRemainingStock || 0),
      0,
    ),
    offline: rows.reduce(
      (sum, row) => sum + Number(row.offlineRemainingStock || 0),
      0,
    ),
  };
}

/// "YYYY-MM-DD" shifted by whole days, built from local date parts (never
/// `new Date("YYYY-MM-DD")`, which is UTC midnight and lands on the wrong
/// day in timezones behind UTC).
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Delta = { diff: number };

/// Change since the previous day (stock levels have no good/bad direction,
/// so it is shown neutrally).
function makeDelta(
  current: number,
  previous: number | undefined,
): Delta | undefined {
  if (previous === undefined) return undefined;
  return { diff: current - previous };
}

/**
 * Landing page. Uses the same page chrome as every other screen (h2 +
 * subtitle on the themed paper background, surface cards with the toolbar's
 * gold hairline, `.ae-table` for the activity list) so it follows the
 * light/dark toggle instead of being its own permanently-dark island. All
 * styling lives in the .ae-dash-* rules in index.css.
 */
export function DashboardPage() {
  const [stocks, setStocks] = useState<TotalStockRow[] | null>(null);
  // The previous day's rows, only used for the "vs prev day" deltas - a
  // failed fetch just means no deltas are shown.
  const [prevStocks, setPrevStocks] = useState<TotalStockRow[] | null>(null);
  const [activeProducts, setActiveProducts] = useState<number | undefined>();
  const [stocksFailed, setStocksFailed] = useState(false);
  const [recentActivity, setRecentActivity] = useState<ChangeLogEntry[] | null>(
    null,
  );
  // Distinct from recentActivity being a real empty array - without this, a
  // failed fetch and "the log is genuinely empty" both render the exact same
  // "No activity recorded yet." message, silently hiding an actual outage.
  const [recentActivityError, setRecentActivityError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the Retry button to re-run every fetch below.
  const [reloadKey, setReloadKey] = useState(0);
  // The current BUSINESS date, same as the entry pages default to - Night
  // runs past midnight, so just after 12am it's still yesterday's date.
  const { date: today, shift: currentShift } = getCurrentShiftAndDate();
  // `null` = follow today. Kept as "no pick" rather than a copy of today's
  // date so a dashboard left open still rolls over at midnight/shift change.
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [showPack, setShowPack] = useState(false);
  const viewDate = pickedDate ?? today;
  // Fetched once here and handed to both restock cards - see useDaysOfStock.
  const { rows: daysOfStock, failed: daysOfStockFailed } =
    useDaysOfStock(viewDate);
  const isToday = viewDate === today;
  const realtimeVersion = useRealtimeVersion();

  // `today` (above) is recomputed on every render, so it's never itself
  // stale - but nothing otherwise re-renders this page as time passes. Left
  // open with no other user's realtime activity to trigger a re-render
  // (quiet overnight hours, or a supervisor who just leaves the tab open),
  // it would keep showing whatever business date was current the last time
  // something else re-rendered it, straight through the actual midnight/
  // shift rollover. This checks every minute - cheap, and only ever forces
  // a re-render on the one tick where the business date or shift has
  // genuinely changed, not on every tick.
  const todayRef = useRef(today);
  const shiftRef = useRef(currentShift);
  useEffect(() => {
    todayRef.current = today;
    shiftRef.current = currentShift;
  });
  const [, forceRerenderOnDateChange] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const now = getCurrentShiftAndDate();
      if (now.date !== todayRef.current || now.shift !== shiftRef.current)
        forceRerenderOnDateChange((n) => n + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Stock figures for the viewed date: live (re-runs on every realtime tick).
  useResetOnKeyChange(viewDate, () => {
    setStocks(null);
    setPrevStocks(null);
    setStocksFailed(false);
    setError(null);
  });
  useEffect(() => {
    let cancelled = false;
    getTotalStocks(viewDate)
      .then((rows) => {
        if (cancelled) return;
        setStocks(rows);
        setStocksFailed(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setStocksFailed(true);
        setError(
          e instanceof Error ? e.message : "Unable to load dashboard analytics",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [viewDate, realtimeVersion, reloadKey]);

  // The previous day is history, not live - fetched once per viewed date
  // rather than on every realtime tick.
  useEffect(() => {
    let cancelled = false;
    getTotalStocks(addDays(viewDate, -1))
      .then((rows) => {
        if (!cancelled) setPrevStocks(rows);
      })
      .catch(() => {
        // Deltas are a nicety - their absence is the only symptom.
      });
    return () => {
      cancelled = true;
    };
  }, [viewDate, reloadKey]);

  // Active SKU count, throttled (see PRODUCTS_REFRESH_MS). Deliberately no
  // cancellation flag: a tick that arrives while the first request is still
  // in flight is skipped by the throttle, so cancelling would drop the only
  // answer that is coming.
  const productsFetchedAt = useRef(0);
  useEffect(() => {
    if (Date.now() - productsFetchedAt.current < PRODUCTS_REFRESH_MS) return;
    productsFetchedAt.current = Date.now();
    listProducts()
      .then((products) =>
        setActiveProducts(products.filter((p) => p.isActive).length),
      )
      .catch(() => {
        productsFetchedAt.current = 0; // let the next tick/Retry try again
      });
  }, [realtimeVersion, reloadKey]);

  // Recent activity: the endpoint already comes back newest-first (Section
  // 5.8) - just take the first few for a glanceable feed instead of the full
  // log. The first load is immediate; realtime refreshes are delayed.
  const activityLoadedRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(
      () => {
        listChangeLog()
          .then((entries) => {
            activityLoadedRef.current = true;
            setRecentActivityError(false);
            setRecentActivity(entries.slice(0, RECENT_ACTIVITY_LIMIT));
          })
          .catch(() => {
            // Keep showing the last good feed if a refresh fails.
            if (activityLoadedRef.current) return;
            setRecentActivityError(true);
            setRecentActivity([]);
          });
      },
      activityLoadedRef.current ? ACTIVITY_REFRESH_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [realtimeVersion, reloadKey]);

  const totals = useMemo(() => (stocks ? summarize(stocks) : null), [stocks]);
  // An empty/all-zero previous day means "nothing was recorded", not "stock
  // fell to zero" - showing that as a delta would be misleading.
  const prevTotals = useMemo(() => {
    if (!prevStocks || prevStocks.length === 0) return null;
    const t = summarize(prevStocks);
    return t.online + t.offline === 0 ? null : t;
  }, [prevStocks]);
  // Used to turn the change log's raw "#id" records into product names.
  const productsById = useMemo(
    () => new Map((stocks ?? []).map((r) => [r.product.id, r.product])),
    [stocks],
  );

  const showStatsError = stocks === null && stocksFailed;

  function retry() {
    productsFetchedAt.current = 0;
    activityLoadedRef.current = false;
    setStocksFailed(false);
    setError(null);
    setReloadKey((k) => k + 1);
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          isToday
            ? `Here's where things stand for ${formatDate(viewDate)}.`
            : `Here's how things stood on ${formatDate(viewDate)}.`
        }
        subtitleClassName="ae-dash-subtitle"
      >
        <Toolbar className="no-print">
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "nowrap",
              minWidth: 0,
            }}
          >
            <DatePicker
              aria-label="Dashboard date"
              value={viewDate}
              onChange={(d) => setPickedDate(d === today ? null : d)}
              todayValue={today}
              style={{ maxWidth: 180 }}
            />
            {!isToday && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPickedDate(null)}
              >
                Back to today
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowPack(true)}
              title="Daily Report + Variance Report + database backup, saved as one .zip"
            >
              End-of-day pack
            </Button>
          </div>
        </Toolbar>
      </PageHeader>

      {showPack && (
        <EndOfDayPackDialog
          defaultDate={viewDate}
          todayValue={today}
          onClose={() => setShowPack(false)}
        />
      )}

      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />

      <div className="ae-dash-quicklinks">
        {QUICK_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="ae-dash-quicklink">
            <span aria-hidden className="ae-dash-quicklink-icon">
              {l.icon}
            </span>
            <span className="ae-dash-quicklink-label">{l.label}</span>
            <span aria-hidden className="ae-dash-quicklink-arrow">
              <ChevronRightIcon />
            </span>
          </Link>
        ))}
      </div>

      {/* "What needs attention" row: entry progress for the shift, the
          biggest variances, and low/negative stock. The last two reuse the
          Total Stocks rows already fetched for the stat cards. */}
      <div className="ae-dash-insights">
        <EntryStatusCard date={viewDate} defaultShift={currentShift} />
        <VarianceTopCard
          rows={stocks}
          date={viewDate}
          failed={showStatsError}
        />
        <LowStockCard rows={stocks} failed={showStatsError} />
        {/* Both read one shared fetch (see useDaysOfStock) - "Needs restock"
            hides itself entirely when nothing is below its alert level. */}
        <NeedsRestockCard rows={daysOfStock} failed={daysOfStockFailed} />
        <LowestDaysLeftCard rows={daysOfStock} failed={daysOfStockFailed} />
      </div>

      {/* Two columns: the monitoring stat cards with Recent Activity
          stacked directly beneath them (same width/grid, reduced size) on
          the left, and the Monthly Monitoring graph on the right - the
          largest card, stretched to the full height of the left column.
          Column widths live in .ae-dash-hero-row in index.css. */}
      <div className="ae-dash-hero-row">
        <div className="ae-dash-hero-left">
          <div
            className="ae-dash-stats"
            role={stocks || showStatsError ? undefined : "status"}
            aria-busy={stocks || showStatsError ? undefined : "true"}
          >
            {totals ? (
              <>
                <StatCard
                  icon={<TagIcon />}
                  label="Active SKUs"
                  value={activeProducts}
                  to="/products"
                />
                <StatCard
                  icon={<BoxIcon />}
                  label="Online remaining stock"
                  value={totals.online}
                  to="/total-stocks"
                  delta={makeDelta(totals.online, prevTotals?.online)}
                />
                <StatCard
                  icon={<BoxIcon />}
                  label="Offline remaining stock"
                  value={totals.offline}
                  to="/total-stocks"
                  delta={makeDelta(totals.offline, prevTotals?.offline)}
                />
              </>
            ) : showStatsError ? (
              <div className="ae-dash-stats-error" role="alert">
                <span>Couldn't load the stock figures.</span>
                <Button variant="ghost" size="sm" onClick={retry}>
                  Retry
                </Button>
              </div>
            ) : (
              <StatCardsSkeleton count={3} />
            )}
          </div>

          {/* Recent Activity: the change_log (Section 5.8) is otherwise only
            visible on its own dedicated page - surfacing the last few edits
            here means a supervisor can spot something odd (a bulk edit, a
            deletion, an unfamiliar name) without navigating away first.
            Sits right under the stat cards, same width, compact size. */}
          <section className="ae-dash-section ae-dash-hero-activity">
            <h3 className="ae-dash-heading">
              Recent Activity
              <Link to="/change-log" className="ae-dash-link">
                View full change log →
              </Link>
            </h3>
            <div className="ae-dash-card">
              {recentActivity === null ? (
                <TableSkeleton
                  headers={["Action", "Record", "When"]}
                  minWidth={320}
                  rows={5}
                  cellPadding="8px 12px"
                  label="Loading recent activity…"
                />
              ) : recentActivityError ? (
                <CardMessage>
                  Couldn't load recent activity.{" "}
                  <button
                    type="button"
                    className="ae-dash-inline-btn"
                    onClick={retry}
                  >
                    Retry
                  </button>
                </CardMessage>
              ) : recentActivity.length === 0 ? (
                <CardMessage>No activity recorded yet.</CardMessage>
              ) : (
                <div className="ae-dash-table-scroll">
                  <table
                    className="ae-table ae-table--left"
                    style={{ minWidth: 320 }}
                  >
                    <thead>
                      <tr>
                        {["Action", "Record", "When"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentActivity.map((entry) => (
                        <ActivityRow
                          key={entry.id}
                          entry={entry}
                          productsById={productsById}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="ae-dash-hero-chart">
          <MonthlyMonitoring />
        </div>
      </div>
    </div>
  );
}

function CardMessage({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "16px", fontSize: 13, color: colors.subtleInk }}>
      {children}
    </div>
  );
}

/// "▲ 120 vs prev day" under a figure. Hidden when there is no previous day
/// to compare against.
function DeltaBadge({ delta }: { delta: Delta | undefined }) {
  if (!delta) return null;
  const text =
    delta.diff === 0
      ? "No change"
      : `${delta.diff > 0 ? "▲" : "▼"} ${Math.abs(delta.diff).toLocaleString()} vs prev day`;
  return (
    <span className="ae-dash-stat-delta" title="Compared with the previous day">
      {text}
    </span>
  );
}

/// A stat tile (Active SKUs, Online/Offline remaining stock). Same surface + gold
/// hairline as Toolbar's card. With `to` the whole tile is a link.
function StatCard({
  icon,
  label,
  value,
  to,
  delta,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  to?: string;
  delta?: Delta;
}) {
  // Counts up from the previous displayed value to `value` any time it
  // changes (including the first time it resolves from `undefined`).
  const animatedValue = useCountUp(value);

  const className = `ae-dash-stat${to ? " ae-dash-stat--link" : ""}`;
  const body = (
    <>
      <div aria-hidden className="ae-dash-stat-icon">
        {icon}
      </div>
      <div className="ae-dash-stat-value">
        {value !== undefined ? animatedValue.toLocaleString() : "—"}
      </div>
      <div className="ae-dash-stat-label">{label}</div>
      <DeltaBadge delta={delta} />
    </>
  );

  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/// What a change_log row is about, in words: the product's name when the row
/// points at one (stock/manual-count rows carry a productId in their stored
/// values; SKU rows' recordId is the product itself), otherwise the old
/// "Table #id".
function describeRecord(
  entry: ChangeLogEntry,
  productsById: Map<number, Product>,
): string {
  const label = TABLE_LABELS[entry.tableName] ?? entry.tableName;
  const payload = entry.newValue ?? entry.oldValue;
  if (entry.tableName === "reports" && entry.summary) return `${label} · ${entry.summary}`;
  const fields =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;

  const productId =
    entry.tableName === "products"
      ? entry.recordId
      : typeof fields?.productId === "number"
        ? fields.productId
        : undefined;
  const product =
    productId !== undefined ? productsById.get(productId) : undefined;
  if (product) return `${label} · ${product.name}`;
  if (entry.tableName === "products" && typeof fields?.name === "string")
    return `${label} · ${fields.name}`;
  return `${label} #${entry.recordId}`;
}

function ActivityRow({
  entry,
  productsById,
}: {
  entry: ChangeLogEntry;
  productsById: Map<number, Product>;
}) {
  const navigate = useNavigate();
  const description = describeRecord(entry, productsById);
  return (
    // The whole row is clickable; the Record cell holds a real link so the
    // row is also reachable by keyboard. Who made the change sits under the
    // record (a separate "Changed by" column wouldn't fit this compact
    // version) - the full Change Log page this links to has everything.
    <tr style={{ cursor: "pointer" }} onClick={() => navigate("/change-log")}>
      <td style={{ fontWeight: 700, color: ACTION_COLOR[entry.action] }}>
        {entry.action}
      </td>
      <td>
        <Link
          to="/change-log"
          className="ae-dash-cell-link ae-dash-cell-record"
          title={description}
          onClick={(e) => e.stopPropagation()}
        >
          {description}
        </Link>
        <span className="ae-dash-cell-sub">
          by {entry.changedBy?.name ?? "system"}
        </span>
      </td>
      <td
        style={{ whiteSpace: "nowrap", color: colors.subtleInk }}
        title={new Date(entry.changedAt).toLocaleString()}
      >
        {formatRelativeTime(entry.changedAt)}
      </td>
    </tr>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
