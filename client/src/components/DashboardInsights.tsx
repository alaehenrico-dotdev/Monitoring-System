import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Shift, TotalStockRow } from "../types";
import { getOnlineGrid } from "../api/onlineStock";
import { getOfflineGrid } from "../api/offlineStock";
import { getManualCountGrid } from "../api/manualCounts";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { SHIFTS, SHIFT_LABELS, SHIFT_SHORT_LABELS } from "../utils/shift";
import { RowsSkeleton } from "./Skeleton";
import { CheckIcon } from "./icons";

/**
 * The dashboard's "what needs attention" row (all styling in the
 * .ae-dash-insight / .ae-dash-list / .ae-dash-entry rules in index.css):
 *
 *   - EntryStatusCard  how far along today's Online / Offline / Manual Count
 *                      entry is for a shift
 *   - VarianceTopCard  the SKUs with the biggest variance for the date
 *   - LowStockCard     SKUs that are negative, out, or at their low-stock alert
 *
 * The last two are pure views over the Total Stocks rows the dashboard has
 * already fetched, so they cost no extra requests.
 */

// Rows shown per list; anything beyond it is summarised as "+N more".
const LIST_LIMIT = 4;
// Realtime ticks arrive in bursts while encoders save; the status card
// re-reads four grids each time, so it waits for a burst to settle first.
const STATUS_REFRESH_DELAY_MS = 1500;

/* ----------------------------------------------------------------------
   Entry status
   ---------------------------------------------------------------------- */

type Count = { saved: number; total: number };
type EntryStatus = {
  online: Count | null;
  offline: Count | null;
  manual: Count | null;
};

function countSaved(rows: { isSaved: boolean }[]): Count {
  return { saved: rows.filter((r) => r.isSaved).length, total: rows.length };
}

/// Never rejects - a grid that fails to load comes back as `null` (shown as
/// "Unavailable") so one failing request doesn't blank the whole card.
async function loadEntryStatus(
  date: string,
  shift: Shift,
): Promise<EntryStatus> {
  const [online, offline, manualOnline, manualOffline] =
    await Promise.allSettled([
      getOnlineGrid(date, shift),
      getOfflineGrid(date, shift),
      getManualCountGrid(date, shift, "ONLINE"),
      getManualCountGrid(date, shift, "OFFLINE"),
    ]);

  // Manual Count is counted across both locations; if either failed the
  // combined figure would be a half-truth, so it's reported as unavailable.
  let manual: Count | null = null;
  if (
    manualOnline.status === "fulfilled" &&
    manualOffline.status === "fulfilled"
  ) {
    const a = countSaved(manualOnline.value);
    const b = countSaved(manualOffline.value);
    manual = { saved: a.saved + b.saved, total: a.total + b.total };
  }

  return {
    online: online.status === "fulfilled" ? countSaved(online.value) : null,
    offline: offline.status === "fulfilled" ? countSaved(offline.value) : null,
    manual,
  };
}

type Tone = "done" | "progress" | "idle";

function toneOf(count: Count | null): { label: string; tone: Tone } {
  if (count === null) return { label: "Unavailable", tone: "idle" };
  if (count.total === 0) return { label: "No SKUs", tone: "idle" };
  if (count.saved === 0) return { label: "Not started", tone: "idle" };
  if (count.saved >= count.total) return { label: "Complete", tone: "done" };
  return { label: "In progress", tone: "progress" };
}

const ENTRY_ROWS: { key: keyof EntryStatus; label: string; to: string }[] = [
  { key: "online", label: "Online Entry", to: "/online" },
  { key: "offline", label: "Offline Entry", to: "/offline" },
  { key: "manual", label: "Manual Count", to: "/manual-count" },
];

export function EntryStatusCard({
  date,
  defaultShift,
}: {
  date: string;
  /// The shift happening now - the card opens on it, and the Morning/Night
  /// toggle lets a supervisor look at the other one.
  defaultShift: Shift;
}) {
  const [shiftOverride, setShiftOverride] = useState<Shift | null>(null);
  const shift = shiftOverride ?? defaultShift;
  const [status, setStatus] = useState<EntryStatus | null>(null);
  const realtimeVersion = useRealtimeVersion();

  // A different date/shift is a different record set - back to the skeleton
  // rather than showing the previous one's progress for a moment.
  useResetOnKeyChange(`${date}|${shift}`, () => setStatus(null));

  // First load for a date/shift goes out immediately; later realtime
  // refreshes wait for the burst of saves to settle (see the constant).
  // This effect is declared first so the ref is current when the fetch
  // effect below reads it.
  const hasStatusRef = useRef(false);
  useEffect(() => {
    hasStatusRef.current = status !== null;
  });
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void loadEntryStatus(date, shift).then((next) => {
          if (!cancelled) setStatus(next);
        });
      },
      hasStatusRef.current ? STATUS_REFRESH_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date, shift, realtimeVersion]);

  return (
    <section className="ae-dash-section ae-dash-insight">
      <h3 className="ae-dash-heading">
        Entry status
        <span className="ae-dash-seg" role="group" aria-label="Shift">
          {SHIFTS.map((s) => (
            <button
              key={s}
              type="button"
              title={SHIFT_LABELS[s]}
              aria-pressed={s === shift}
              className={s === shift ? "ae-dash-seg-btn--active" : undefined}
              onClick={() => setShiftOverride(s === defaultShift ? null : s)}
            >
              {SHIFT_SHORT_LABELS[s]}
            </button>
          ))}
        </span>
      </h3>
      <div className="ae-dash-card">
        {status === null ? (
          <RowsSkeleton rows={3} height={16} label="Loading entry status…" />
        ) : (
          ENTRY_ROWS.map((row) => {
            const count = status[row.key];
            const { label, tone } = toneOf(count);
            const pct =
              count && count.total > 0
                ? Math.round((count.saved / count.total) * 100)
                : 0;
            return (
              <Link key={row.key} to={row.to} className="ae-dash-entry">
                <span className="ae-dash-entry-top">
                  {row.label}
                  <span className={`ae-dash-chip ae-dash-chip--${tone}`}>
                    {label}
                  </span>
                  <span className="ae-dash-entry-count">
                    {count ? `${count.saved} / ${count.total}` : "—"}
                  </span>
                </span>
                <span
                  className={`ae-dash-progress${tone === "done" ? " ae-dash-progress--done" : ""}`}
                  role="progressbar"
                  aria-label={`${row.label} saved`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                >
                  <span style={{ width: `${pct}%` }} />
                </span>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------
   Top variances
   ---------------------------------------------------------------------- */

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

export function VarianceTopCard({
  rows,
  date,
  failed = false,
}: {
  rows: TotalStockRow[] | null;
  date: string;
  /// The stock figures couldn't be loaded - say so instead of showing a
  /// skeleton forever (the dashboard's own Retry button is on the stat cards).
  failed?: boolean;
}) {
  const flagged = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => Number(r.totalVariance || 0) !== 0)
        .sort(
          (a, b) =>
            Math.abs(Number(b.totalVariance)) -
            Math.abs(Number(a.totalVariance)),
        ),
    [rows],
  );
  const reportLink = `/variance-report?date=${date}`;

  return (
    <section className="ae-dash-section ae-dash-insight">
      <h3 className="ae-dash-heading">
        Top variances
        <Link to={reportLink} className="ae-dash-link">
          Variance report →
        </Link>
      </h3>
      <div className="ae-dash-card">
        {rows === null && failed ? (
          <div className="ae-dash-empty">Couldn't load variances.</div>
        ) : rows === null ? (
          <RowsSkeleton rows={4} height={16} label="Loading variances…" />
        ) : flagged.length === 0 ? (
          <div className="ae-dash-empty ae-dash-empty--ok">
            <CheckIcon />
            No variances for this date.
          </div>
        ) : (
          <>
            <ul className="ae-dash-list">
              {flagged.slice(0, LIST_LIMIT).map((r) => {
                const variance = Number(r.totalVariance);
                return (
                  <li key={r.product.id} className="ae-dash-list-item">
                    <span className="ae-dash-list-main">
                      <span
                        className="ae-dash-list-name"
                        title={r.product.name}
                      >
                        {r.product.name}
                      </span>
                      <span className="ae-dash-list-sub">
                        {r.product.sku ? `${r.product.sku} · ` : ""}
                        {r.product.category}
                      </span>
                    </span>
                    <span
                      className={`ae-dash-list-value${variance < 0 ? " ae-dash-list-value--neg" : ""}`}
                      title={`Manual count ${r.totalManualCount ?? "—"} vs system ${r.totalRemainingStock}`}
                    >
                      {signed(variance)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {flagged.length > LIST_LIMIT && (
              <div className="ae-dash-list-more">
                <Link to={reportLink} className="ae-dash-link">
                  +{flagged.length - LIST_LIMIT} more →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------
   Low / negative stock
   ---------------------------------------------------------------------- */

type StockAlert = {
  row: TotalStockRow;
  kind: "negative" | "out" | "low";
  remaining: number;
};

/// Same rule as TotalStocksTable's low-stock flag (at or below the SKU's own
/// threshold, and only once one is set) so the two pages never disagree -
/// plus negative remaining stock, which is flagged whatever the threshold:
/// it can't be real stock, so it's almost always an encoding mistake.
/// SKUs sitting at 0 with no threshold configured are deliberately NOT
/// listed - that would bury the card under every SKU not currently stocked.
function alertFor(row: TotalStockRow): StockAlert | null {
  const remaining = Number(row.totalRemainingStock || 0);
  if (remaining < 0) return { row, kind: "negative", remaining };
  const threshold = row.product.lowStockThreshold;
  if (threshold !== null && remaining <= threshold) {
    return { row, kind: remaining === 0 ? "out" : "low", remaining };
  }
  return null;
}

const KIND_ORDER: Record<StockAlert["kind"], number> = {
  negative: 0,
  out: 1,
  low: 2,
};
const KIND_LABEL: Record<StockAlert["kind"], string> = {
  negative: "Negative",
  out: "Out",
  low: "Low",
};

export function LowStockCard({
  rows,
  failed = false,
}: {
  rows: TotalStockRow[] | null;
  failed?: boolean;
}) {
  const alerts = useMemo(
    () =>
      (rows ?? [])
        .map(alertFor)
        .filter((a): a is StockAlert => a !== null)
        .sort(
          (a, b) =>
            KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
            a.remaining - b.remaining,
        ),
    [rows],
  );

  return (
    <section className="ae-dash-section ae-dash-insight">
      <h3 className="ae-dash-heading">
        Low &amp; negative stock
        <Link to="/total-stocks" className="ae-dash-link">
          Total stocks →
        </Link>
      </h3>
      <div className="ae-dash-card">
        {rows === null && failed ? (
          <div className="ae-dash-empty">Couldn't load stock alerts.</div>
        ) : rows === null ? (
          <RowsSkeleton rows={4} height={16} label="Loading stock alerts…" />
        ) : alerts.length === 0 ? (
          <div className="ae-dash-empty ae-dash-empty--ok">
            <CheckIcon />
            Nothing at or below its low-stock alert.
          </div>
        ) : (
          <>
            <ul className="ae-dash-list">
              {alerts.slice(0, LIST_LIMIT).map(({ row, kind, remaining }) => (
                <li key={row.product.id} className="ae-dash-list-item">
                  <span className="ae-dash-list-main">
                    <span
                      className="ae-dash-list-name"
                      title={row.product.name}
                    >
                      {row.product.name}
                    </span>
                    <span className="ae-dash-list-sub">
                      {row.product.lowStockThreshold !== null
                        ? `Alert at ${row.product.lowStockThreshold} ${row.product.unit}`
                        : row.product.unit}
                    </span>
                  </span>
                  <span
                    className={`ae-dash-chip ae-dash-chip--${kind === "low" ? "progress" : "bad"}`}
                  >
                    {KIND_LABEL[kind]}
                  </span>
                  <span
                    className={`ae-dash-list-value${remaining < 0 ? " ae-dash-list-value--neg" : ""}`}
                  >
                    {remaining.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
            {alerts.length > LIST_LIMIT && (
              <div className="ae-dash-list-more">
                <Link to="/total-stocks" className="ae-dash-link">
                  +{alerts.length - LIST_LIMIT} more →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
