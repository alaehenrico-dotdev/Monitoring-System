import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getTotalStocks } from "../api/totalStocks";
import { listProducts } from "../api/products";
import { listReceipts } from "../api/receipts";
import { listChangeLog } from "../api/changeLog";
import type { ChangeLogEntry } from "../types";
import { ACTION_COLOR, TABLE_LABELS } from "../config/changeLog";
import { formatRelativeTime } from "../utils/dateFormat";
import { StatCardsSkeleton, TableSkeleton } from "../components/Skeleton";
import { MonthlyMonitoring } from "../components/MonthlyMonitoring";
import { PageHeader } from "../components/PageHeader";
import { TagIcon, BoxIcon, LayersIcon, ReceiptIcon, AlertTriangleIcon, ChevronRightIcon } from "../components/icons";
import { colors } from "../theme";

type Analytics = {
  activeProducts: number;
  /// Online and Offline are separate stock pools (Section 2.1) - shown as
  /// one rotating stat card (RotatingStockCard) rather than a combined sum,
  /// since summing them implies a single pool that doesn't really exist.
  onlineRemaining: number;
  offlineRemaining: number;
  todayReceipts: number;
  varianceFlags: number;
};

const RECENT_ACTIVITY_LIMIT = 6;
const COUNT_UP_DURATION_MS = 700;
// How long each face (Online, then Offline) stays on screen before the
// rotating stat card crossfades to the next one.
const STOCK_ROTATE_MS = 3500;

// The app's major day-to-day pages (mirrors the nav drawer's own "Data
// Entry" section, minus Dashboard itself) - one-click shortcuts so landing
// here doesn't require opening the nav drawer first for the common case.
const QUICK_LINKS: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/online", label: "Online Entry", icon: <BoxIcon /> },
  { to: "/offline", label: "Offline Entry", icon: <BoxIcon /> },
  { to: "/manual-count", label: "Manual Count", icon: <LayersIcon /> },
  { to: "/total-stocks", label: "Total Stocks", icon: <LayersIcon /> },
  { to: "/receipts", label: "Receipts", icon: <ReceiptIcon /> },
];

// Animates a displayed number from its previous value up (or down) to
// `target` whenever `target` changes, instead of the digits just snapping
// in - used by `StatCard` so the headline numbers count up on first load and
// re-count if a value changes underneath them.
//
// `prevRef` (not `useState`) holds the animation's start point: it has to
// survive across renders without triggering one. It is updated on every
// frame, so if `target` changes mid-animation the next count starts from
// what's on screen rather than jumping back to the last finished value.
//
// `target === undefined` (data hasn't loaded yet) leaves the displayed value
// alone - `StatCard` renders "—" for that case instead.
function useCountUp(target: number | undefined, duration = COUNT_UP_DURATION_MS) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    if (target === undefined) return;
    const targetValue = target;

    // Respect the OS "reduce motion" setting: show the number immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      prevRef.current = targetValue;
      setDisplay(targetValue);
      return;
    }

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
  }, [target, duration]);

  return display;
}

// The local calendar date as YYYY-MM-DD. (`toISOString()` would give the UTC
// date, which is still *yesterday* for the first hours of every local day in
// a timezone ahead of UTC.)
function localISODate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Landing page. Uses the same page chrome as every other screen (h2 +
 * subtitle on the themed paper background, surface cards with the toolbar's
 * gold hairline, `.ae-table` for the activity list) so it follows the
 * light/dark toggle instead of being its own permanently-dark island. All
 * styling lives in the .ae-dash-* rules in index.css.
 */
export function DashboardPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [recentActivity, setRecentActivity] = useState<ChangeLogEntry[] | null>(null);
  // Distinct from recentActivity being a real empty array - without this, a
  // failed fetch and "the log is genuinely empty" both render the exact same
  // "No activity recorded yet." message, silently hiding an actual outage.
  const [recentActivityError, setRecentActivityError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localISODate();

  useEffect(() => {
    Promise.all([listProducts(), getTotalStocks(today), listReceipts({ date: today })])
      .then(([products, stocks, receipts]) => {
        setAnalytics({
          activeProducts: products.filter((product) => product.isActive).length,
          onlineRemaining: stocks.reduce((sum, row) => sum + Number(row.onlineRemainingStock || 0), 0),
          offlineRemaining: stocks.reduce((sum, row) => sum + Number(row.offlineRemainingStock || 0), 0),
          todayReceipts: receipts.length,
          varianceFlags: stocks.filter((row) => Number(row.totalVariance || 0) !== 0).length,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load dashboard analytics"));

    // The endpoint already comes back newest-first (Section 5.8) - just
    // take the first few for a glanceable feed instead of the full log.
    setRecentActivityError(false);
    listChangeLog()
      .then((entries) => setRecentActivity(entries.slice(0, RECENT_ACTIVITY_LIMIT)))
      .catch(() => {
        setRecentActivityError(true);
        setRecentActivity([]);
      });
  }, [today]);

  const hasVariance = !!analytics && analytics.varianceFlags > 0;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Here's where things stand for ${formatDate(today)}.`} subtitleClassName="ae-dash-subtitle" />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

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

      {/* Graph first - it takes whatever width is left over once the stat
          grid and Recent Activity (both fixed-ish width, see index.css)
          claim theirs, instead of the other way around. */}
      <div className="ae-dash-hero-row">
        <div className="ae-dash-hero-chart">
          <MonthlyMonitoring />
        </div>

        <div className="ae-dash-stats" role={analytics ? undefined : "status"} aria-busy={analytics ? undefined : "true"}>
          {analytics ? (
            <>
              <StatCard icon={<TagIcon />} label="Active SKUs" value={analytics.activeProducts} />
              <RotatingStockCard online={analytics.onlineRemaining} offline={analytics.offlineRemaining} />
              <StatCard icon={<ReceiptIcon />} label="Receipts today" value={analytics.todayReceipts} />
              <StatCard
                icon={<AlertTriangleIcon />}
                label={hasVariance ? "Variance flags — needs review" : "Variance flags"}
                value={analytics.varianceFlags}
                alert={hasVariance}
              />
            </>
          ) : (
            <StatCardsSkeleton count={4} />
          )}
        </div>

        {/* Recent Activity: the change_log (Section 5.8) is otherwise only
            visible on its own dedicated page - surfacing the last few edits
            here means a supervisor can spot something odd (a bulk edit, a
            deletion, an unfamiliar name) without navigating away first.
            Aligned with the stat grid in this same row rather than a
            separate section below (the old "Today" section - now removed -
            used to sit there instead). */}
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
                headers={["Action", "Record", "Changed by", "When"]}
                minWidth={320}
                rows={5}
                cellPadding="8px 12px"
                label="Loading recent activity…"
              />
            ) : recentActivityError ? (
              <CardMessage>Couldn't load recent activity - try refreshing the page.</CardMessage>
            ) : recentActivity.length === 0 ? (
              <CardMessage>No activity recorded yet.</CardMessage>
            ) : (
              <div className="ae-dash-table-scroll">
                <table className="ae-table ae-table--left" style={{ minWidth: 320 }}>
                  <thead>
                    <tr>
                      {["Action", "Record", "When"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivity.map((entry) => (
                      <ActivityRow key={entry.id} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CardMessage({ children }: { children: ReactNode }) {
  return <div style={{ padding: "16px", fontSize: 13, color: colors.subtleInk }}>{children}</div>;
}

/// A stat tile (Active SKUs, Receipts today, ...). Same surface + gold
/// hairline as Toolbar's card, and the same cursor-follow spotlight: a soft
/// glow that tracks the pointer while it's over the card and fades out on
/// leave. `--mx`/`--my`/`--spotlight-opacity` are written straight onto the
/// card's DOM node rather than through React state, so a `mousemove` never
/// re-renders the card (or re-runs the count-up effect).
function StatCard({ icon, label, value, alert }: { icon: ReactNode; label: string; value: number | undefined; alert?: boolean }) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Counts up from the previous displayed value to `value` any time it
  // changes (including the first time it resolves from `undefined`).
  const animatedValue = useCountUp(value);

  function handlePointerMove(e: ReactMouseEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    card.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    card.style.setProperty("--spotlight-opacity", "1");
  }

  function handlePointerLeave() {
    cardRef.current?.style.setProperty("--spotlight-opacity", "0");
  }

  return (
    <div ref={cardRef} className={`ae-dash-stat${alert ? " ae-dash-stat--alert" : ""}`} onMouseMove={handlePointerMove} onMouseLeave={handlePointerLeave}>
      <div aria-hidden className="ae-dash-stat-spotlight" />
      <div aria-hidden className="ae-dash-stat-icon">
        {icon}
      </div>
      <div className="ae-dash-stat-value">{value !== undefined ? animatedValue.toLocaleString() : "—"}</div>
      <div className="ae-dash-stat-label">{label}</div>
    </div>
  );
}

/// Replaces separate "Online remaining stock" / "Offline remaining stock"
/// cards (and the combined-sum one) with a single tile that crossfades
/// between the two channels every few seconds - summing them into one
/// number would imply a single stock pool that doesn't actually exist
/// (Section 2.1), so this shows each in turn instead of adding them
/// together. Same surface/spotlight chrome as StatCard, just with an
/// animated face instead of a static value + a small dot pager showing
/// which channel is currently on screen.
function RotatingStockCard({ online, offline }: { online: number | undefined; offline: number | undefined }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [faceIndex, setFaceIndex] = useState(0);
  const faces = [
    { label: "Online remaining stock", value: online },
    { label: "Offline remaining stock", value: offline },
  ];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setFaceIndex((i) => (i + 1) % faces.length), STOCK_ROTATE_MS);
    return () => clearInterval(id);
    // faces.length is a fixed constant (always 2) - not a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePointerMove(e: ReactMouseEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    card.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    card.style.setProperty("--spotlight-opacity", "1");
  }

  function handlePointerLeave() {
    cardRef.current?.style.setProperty("--spotlight-opacity", "0");
  }

  const face = faces[faceIndex];

  return (
    <div ref={cardRef} className="ae-dash-stat" onMouseMove={handlePointerMove} onMouseLeave={handlePointerLeave}>
      <div aria-hidden className="ae-dash-stat-spotlight" />
      <div aria-hidden className="ae-dash-stat-icon">
        <BoxIcon />
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={faceIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <div className="ae-dash-stat-value">{face.value !== undefined ? face.value.toLocaleString() : "—"}</div>
          <div className="ae-dash-stat-label">{face.label}</div>
        </motion.div>
      </AnimatePresence>
      <div aria-hidden className="ae-dash-stat-dots">
        {faces.map((f, i) => (
          <span key={f.label} className={`ae-dash-stat-dot${i === faceIndex ? " ae-dash-stat-dot--active" : ""}`} />
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ChangeLogEntry }) {
  const navigate = useNavigate();
  return (
    // The whole row is clickable; the Record cell holds a real link so the
    // row is also reachable by keyboard. "Changed by" dropped from this
    // compact side-panel version (see .ae-dash-hero-activity) - still on
    // the full Change Log page this links out to.
    <tr style={{ cursor: "pointer" }} onClick={() => navigate("/change-log")}>
      <td style={{ fontWeight: 700, color: ACTION_COLOR[entry.action] }}>{entry.action}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Link to="/change-log" className="ae-dash-cell-link" onClick={(e) => e.stopPropagation()}>
          {TABLE_LABELS[entry.tableName] ?? entry.tableName} #{entry.recordId}
        </Link>
      </td>
      <td style={{ whiteSpace: "nowrap", color: colors.subtleInk }} title={new Date(entry.changedAt).toLocaleString()}>
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