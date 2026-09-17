import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { getTotalStocks } from "../api/totalStocks";
import { listProducts } from "../api/products";
import { listReceipts } from "../api/receipts";
import { listChangeLog } from "../api/changeLog";
import type { ChangeLogEntry } from "../types";
import { TABLE_LABELS } from "../config/changeLog";
import { formatRelativeTime } from "../utils/dateFormat";
import { colors } from "../theme";

type Analytics = {
  activeProducts: number;
  totalRemaining: number;
  todayReceipts: number;
  varianceFlags: number;
};

const RECENT_ACTIVITY_LIMIT = 6;

// Not ChangeLogPage's own ACTION_COLOR (config/changeLog.ts) - that map
// uses ink/warningText, which flip with the site-wide light/dark toggle to
// stay legible against ChangeLogPage's own (also flipping) paper
// background. This page's background is always black (its own permanent
// brand surface, unaffected by the toggle - see theme.ts), so its action
// colors need to be the fixed ones already proven to read on black
// (yellow/cream, same as everything else here), not ones that could
// resolve to a dark, low-contrast color if the site theme is light.
const DASHBOARD_ACTION_COLOR: Record<ChangeLogEntry["action"], string> = {
  CREATE: colors.yellow,
  UPDATE: colors.cream,
  DELETE: colors.danger,
};

export function DashboardPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [recentActivity, setRecentActivity] = useState<ChangeLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    Promise.all([
      listProducts(),
      getTotalStocks(today),
      listReceipts({ date: today }),
    ])
      .then(([products, stocks, receipts]) => {
        setAnalytics({
          activeProducts: products.filter((product) => product.isActive).length,
          totalRemaining: stocks.reduce(
            (sum, row) => sum + Number(row.totalRemainingStock || 0),
            0,
          ),
          todayReceipts: receipts.length,
          varianceFlags: stocks.filter(
            (row) => Number(row.totalVariance || 0) !== 0,
          ).length,
        });
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Unable to load dashboard analytics",
        ),
      );

    // The endpoint already comes back newest-first (Section 5.8) - just
    // take the first few for a glanceable feed instead of the full log.
    listChangeLog()
      .then((entries) => setRecentActivity(entries.slice(0, RECENT_ACTIVITY_LIMIT)))
      .catch(() => setRecentActivity([]));
  }, [today]);

  const hasVariance = !!analytics && analytics.varianceFlags > 0;

  return (
    <div
      style={{
        background: colors.black,
        color: colors.cream,
        margin: "-24px",
        padding: 24,
        minHeight: "100%",
      }}
    >
      <header
        style={{
          borderBottom: `1px solid ${colors.blackSoft}`,
          paddingBottom: 16,
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 24, color: "#ffffff" }}>
          Dashboard
        </h2>
        <p
          style={{ fontSize: 13, color: "#ffffff", margin: "4px 0 0" }}
        >
          Here's where things stand for {formatDate(today)}.
        </p>
      </header>

      {error && (
        <p style={{ color: colors.danger, fontSize: 13, marginBottom: 20 }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 2,
          background: colors.blackSoft,
          marginBottom: 32,
        }}
      >
        <StatCard label="Active SKUs" value={analytics?.activeProducts} />
        <StatCard
          label="Total remaining stock"
          value={analytics?.totalRemaining}
        />
        <StatCard label="Receipts today" value={analytics?.todayReceipts} />
        <StatCard
          label={
            hasVariance ? "Variance flags — needs review" : "Variance flags"
          }
          value={analytics?.varianceFlags}
          alert={hasVariance}
        />
      </div>

      {/* Today: what the numbers above mean you should do, not a menu. */}
      <div>
        <h3
          style={{
            fontSize: 13,
            color: "#ffffff",
            fontWeight: 400,
            margin: "0 0 8px",
          }}
        >
          Today
        </h3>
        <div style={{ borderTop: `1px solid ${colors.blackSoft}` }}>
          {analytics ? (
            <>
              {hasVariance && (
                <TodayRow
                  to="/variance-report"
                  tone="alert"
                  headline={`${analytics.varianceFlags} product${analytics.varianceFlags === 1 ? "" : "s"} ${
                    analytics.varianceFlags === 1 ? "shows" : "show"
                  } a stock variance today`}
                  action="Review the variance report"
                />
              )}
              {analytics.todayReceipts === 0 ? (
                <TodayRow
                  to="/receipts"
                  headline="No receipts have been recorded yet today"
                  action="Create a receipt"
                />
              ) : (
                <TodayRow
                  to="/receipts"
                  headline={`${analytics.todayReceipts} receipt${analytics.todayReceipts === 1 ? "" : "s"} recorded so far today`}
                  action="View today's receipts"
                />
              )}
              <TodayRow
                to="/daily-report"
                headline={`Full activity log for ${formatDate(today)}`}
                action="Open the daily report"
              />
              {!hasVariance && (
                <TodayRow
                  to="/variance-report"
                  headline="No variances flagged today"
                  action="Open the variance report"
                  muted
                />
              )}
            </>
          ) : (
            <div
              style={{
                padding: "16px 4px",
                fontSize: 13,
                color: colors.subtleInk,
              }}
            >
              Loading today's activity…
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity: the change_log (Section 5.8) is otherwise only
          visible on its own dedicated page - surfacing the last few edits
          here means a supervisor can spot something odd (a bulk edit, a
          deletion, an unfamiliar name) without navigating away first. */}
      <div>
        <h3
          style={{
            fontSize: 13,
            color: "#ffffff",
            fontWeight: 400,
            margin: "0 0 8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          Recent Activity
          <Link to="/change-log" style={{ fontSize: 12, color: colors.yellow, fontWeight: 600 }}>
            View full change log →
          </Link>
        </h3>
        <div style={{ borderTop: `1px solid ${colors.blackSoft}` }}>
          {recentActivity === null ? (
            <div style={{ padding: "16px 4px", fontSize: 13, color: colors.subtleInk }}>Loading recent activity…</div>
          ) : recentActivity.length === 0 ? (
            <div style={{ padding: "16px 4px", fontSize: 13, color: colors.subtleInk }}>No activity recorded yet.</div>
          ) : (
            recentActivity.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  alert,
}: {
  label: string;
  value: number | undefined;
  alert?: boolean;
}) {
  return (
    <div
      style={{
        padding: "18px 20px",
        background: colors.black,
        border: `1px solid ${colors.yellow}`,
      }}
    >
      <div
        style={{
          fontFamily:
            '"JetBrains Mono", "SF Mono", "Roboto Mono", ui-monospace, monospace',
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          color: colors.yellow,
          marginBottom: 10,
        }}
      >
        {value !== undefined ? value.toLocaleString() : "—"}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.01em",
          color: colors.yellow,
          opacity: alert ? 1 : 0.75,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function TodayRow({
  to,
  headline,
  action,
  tone,
  muted,
}: {
  to: string;
  headline: string;
  action: string;
  tone?: "alert";
  muted?: boolean;
}) {
  return (
    <Link
      to={to}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 24,
        padding: "16px 4px",
        borderBottom: `1px solid ${colors.blackSoft}`,
        borderLeft:
          tone === "alert"
            ? `3px solid ${colors.danger}`
            : "3px solid transparent",
        paddingLeft: tone === "alert" ? 13 : 4,
        textDecoration: "none",
        color: muted ? "#ffffff99" : "#ffffff",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: tone === "alert" ? 600 : 500 }}>
        {headline}
      </span>
      <span style={{ fontSize: 13, color: "#ffffff99", flexShrink: 0 }}>
        {action}
      </span>
    </Link>
  );
}

function ActivityRow({ entry }: { entry: ChangeLogEntry }) {
  return (
    <Link
      to="/change-log"
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 24,
        padding: "12px 4px",
        borderBottom: `1px solid ${colors.blackSoft}`,
        textDecoration: "none",
        color: "#ffffff",
      }}
    >
      <span style={{ fontSize: 14, display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ fontWeight: 700, color: DASHBOARD_ACTION_COLOR[entry.action], flexShrink: 0 }}>{entry.action}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {TABLE_LABELS[entry.tableName] ?? entry.tableName} #{entry.recordId}
          {entry.changedBy?.name ? ` — ${entry.changedBy.name}` : ""}
        </span>
      </span>
      <span style={{ fontSize: 13, color: "#ffffff99", flexShrink: 0 }}>{formatRelativeTime(entry.changedAt)}</span>
    </Link>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
