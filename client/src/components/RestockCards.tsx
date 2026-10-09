import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDaysOfStock, type DaysOfStockRow } from "../api/dashboard";
import { useAuth } from "../context/AuthContext";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { defaultGridPageFor } from "../config/navigation";
import { requestQuickJump } from "../utils/quickJumpTarget";
import { RowsSkeleton } from "./Skeleton";

/**
 * Dashboard > "Needs restock" and "Lowest days left".
 *
 * Both read one endpoint (/dashboard/days-of-stock), which does the whole
 * calculation in two aggregated queries and caches it briefly - see
 * server/src/services/daysOfStock.service.ts, including what counts as
 * outflow and why.
 *
 * Clicking a row jumps to that product through the same mechanism Ctrl+K
 * uses (utils/quickJumpTarget.ts), so there is one definition of "go to this
 * product" rather than the dashboard growing its own.
 */

const LIST_LIMIT = 5;

export interface DaysOfStockCardProps {
  /// Null while loading, or when the load failed.
  rows: DaysOfStockRow[] | null;
  failed?: boolean;
}

/// Urgency bands for the days-left figure, in the app's existing theme
/// colours - red under 3 days, amber under 7, neutral above.
function daysTone(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft < 3) return " ae-dash-list-value--neg";
  if (daysLeft < 7) return " ae-dash-list-value--warn";
  return "";
}

function formatDays(row: DaysOfStockRow): string {
  if (row.daysLeft === null) return "n/a";
  if (row.daysLeft < 10) return `${row.daysLeft.toFixed(1)}d`;
  return `${Math.round(row.daysLeft)}d`;
}

/// Why a figure is unavailable, so "n/a" isn't a dead end.
function daysTitle(row: DaysOfStockRow): string {
  if (row.daysLeft !== null) {
    return `About ${row.daysLeft} days at ${row.averageDailyOutflow} ${row.unit}/day, averaged over ${row.daysWithData} day${row.daysWithData === 1 ? "" : "s"} of data`;
  }
  if (row.daysWithData < 3) {
    return `Not enough history yet - ${row.daysWithData} day${row.daysWithData === 1 ? "" : "s"} of data in the last 14`;
  }
  return "Nothing has gone out in the last 14 days";
}

/**
 * Shared data load. Called ONCE by DashboardPage and the result passed into
 * both cards, rather than each card fetching for itself - they render two
 * views of the same list, and two components each firing the dashboard's most
 * expensive aggregate would be a self-inflicted doubling.
 */
export function useDaysOfStock(date?: string) {
  const [rows, setRows] = useState<DaysOfStockRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    let cancelled = false;
    getDaysOfStock(date)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [date, realtimeVersion]);

  return { rows, failed };
}

/// Click-through to the product on whichever grid this role works in.
function useJumpToProduct() {
  const navigate = useNavigate();
  const { user } = useAuth();
  return (productId: number) => {
    requestQuickJump(productId);
    navigate(defaultGridPageFor(user?.role));
  };
}

function ProductRow({
  row,
  onJump,
  children,
}: {
  row: DaysOfStockRow;
  onJump: (productId: number) => void;
  children: React.ReactNode;
}) {
  return (
    <li className="ae-dash-list-item">
      <button
        type="button"
        className="ae-dash-list-jump"
        onClick={() => onJump(row.productId)}
        title={`Go to ${row.name}`}
      >
        <span className="ae-dash-list-main">
          <span className="ae-dash-list-name">{row.name}</span>
          <span className="ae-dash-list-sub">
            {row.sku ? `${row.sku} · ` : ""}
            {row.totalRemainingStock.toLocaleString()} {row.unit}
            {row.lowStockThreshold !== null
              ? ` · alert at ${row.lowStockThreshold.toLocaleString()}`
              : ""}
          </span>
        </span>
        {children}
      </button>
    </li>
  );
}

/**
 * Products at or below their configured low-stock alert, most urgent first.
 *
 * Hidden entirely when nothing needs restocking - unlike the low/negative
 * stock card beside it, this is a call to action rather than a status, and an
 * empty call to action is just noise on the dashboard.
 */
export function NeedsRestockCard({ rows, failed = false }: DaysOfStockCardProps) {
  const jump = useJumpToProduct();

  // Already sorted most urgent first by the server.
  const needing = useMemo(
    () => (rows ?? []).filter((r) => r.needsRestock),
    [rows],
  );

  if (rows !== null && needing.length === 0) return null;
  if (failed) return null;

  return (
    <section className="ae-dash-section ae-dash-insight">
      <h3 className="ae-dash-heading">Needs restock</h3>
      <div className="ae-dash-card">
        {rows === null ? (
          <RowsSkeleton rows={4} height={16} label="Loading restock list…" />
        ) : (
          <>
            <ul className="ae-dash-list">
              {needing.slice(0, LIST_LIMIT).map((row) => (
                <ProductRow key={row.productId} row={row} onJump={jump}>
                  <span
                    className={`ae-dash-list-value${daysTone(row.daysLeft)}`}
                    title={daysTitle(row)}
                  >
                    {formatDays(row)}
                  </span>
                </ProductRow>
              ))}
            </ul>
            {needing.length > LIST_LIMIT && (
              <div className="ae-dash-list-more">
                +{needing.length - LIST_LIMIT} more
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The five products closest to running out, whatever their alert level.
 *
 * Complements "Needs restock": a product can be comfortably above its
 * threshold and still three days from empty if it's moving fast, which is
 * exactly the case a static threshold can't catch.
 */
export function LowestDaysLeftCard({ rows, failed = false }: DaysOfStockCardProps) {
  const jump = useJumpToProduct();

  const soonest = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.daysLeft !== null)
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
        .slice(0, LIST_LIMIT),
    [rows],
  );

  return (
    <section className="ae-dash-section ae-dash-insight">
      <h3 className="ae-dash-heading">Lowest days left</h3>
      <div className="ae-dash-card">
        {rows === null && failed ? (
          <div className="ae-dash-empty">Couldn't load days of stock.</div>
        ) : rows === null ? (
          <RowsSkeleton rows={4} height={16} label="Loading days of stock…" />
        ) : soonest.length === 0 ? (
          <div className="ae-dash-empty">
            Not enough movement in the last 14 days to estimate.
          </div>
        ) : (
          <ul className="ae-dash-list">
            {soonest.map((row) => (
              <ProductRow key={row.productId} row={row} onJump={jump}>
                <span
                  className={`ae-dash-list-value${daysTone(row.daysLeft)}`}
                  title={daysTitle(row)}
                >
                  {formatDays(row)}
                </span>
              </ProductRow>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
