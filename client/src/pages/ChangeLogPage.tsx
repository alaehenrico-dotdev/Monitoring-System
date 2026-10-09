import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  exportChangeLogCsv,
  listChangeLogPage,
  listChangeLogUsers,
  type ChangeLogFilters,
} from "../api/changeLog";
import { listProducts } from "../api/products";
import type { ChangeLogEntry, Product } from "../types";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { SearchInput } from "../components/SearchInput";
import { Dropdown } from "../components/Dropdown";
import { DateRangePicker } from "../components/DateRangePicker";
import { Button } from "../components/ui";
import { matchesSearch } from "../utils/search";
import { endOfDayIso, recordLabel, startOfDayIso } from "../utils/changeLogLabel";
import { saveBlob } from "../utils/saveBlob";
import { TABLE_LABELS, ACTION_COLOR } from "../config/changeLog";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";

const SYSTEM_TABLE = "system";
const PAGE_SIZE = 100;
// The server's per-request cap; a realtime refresh re-reads up to this many
// rows so "Load more" pages already on screen aren't thrown away.
const MAX_REFRESH_ROWS = 500;
const REFRESH_DEBOUNCE_MS = 400;
const COLUMNS = ["When", "Record", "Action", "What changed", "Changed By", ""];

const SOURCE_TAG: Record<"import" | "reset", string> = {
  import: "CSV import",
  reset: "Data reset",
};

const EVENT_LABELS: Record<string, string> = {
  data_reset: "All data reset",
  login: "Signed in",
  login_failed: "Failed sign-in",
  backup_download: "Database backup downloaded",
  backup_restore: "Database restored from a backup",
};

function changeEventLabel(entry: ChangeLogEntry): string {
  const value = entry.newValue as { event?: string; username?: string } | null;
  const event = value?.event;
  const label = (event && EVENT_LABELS[event]) || event || "System event";
  // Who a sign-in was for - the row's own user is empty on a failed attempt.
  return event === "login" || event === "login_failed" ? `${label}${value?.username ? ` (${value.username})` : ""}` : label;
}
const REPORTS_TABLE = "reports";
const TABLE_FILTERS = ["", ...Object.keys(TABLE_LABELS), SYSTEM_TABLE];
const tableLabel = (table: string) =>
  table === SYSTEM_TABLE ? "System" : (TABLE_LABELS[table] ?? table);

/**
 * Section 4.8 - Change Log (grouped by table): every create/edit to a stock entry, manual
 * count, product, or receipt is timestamped and attributed to the encoder
 * who made it, so a disputed number can be traced back to its source
 * instead of disappearing into an overwritten cell (Section 2.1). The
 * backend has recorded this from day one (recordChange() in every write
 * path); this page is the first place it's actually visible.
 *
 * System-level events such as data resets are shown alongside record changes.
 */
export function ChangeLogPage() {
  const [entries, setEntries] = useState<ChangeLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [productId, setProductId] = useState("");
  const [shift, setShift] = useState("");
  const [importOnly, setImportOnly] = useState(false);
  const [reportType, setReportType] = useState("");
  const [reportSection, setReportSection] = useState("");
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  // Tables whose group is collapsed - every group starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const realtimeVersion = useRealtimeVersion();

  // Everything the server filters on. `query` is not part of it: search stays
  // a client-side narrowing of the rows already loaded.
  const filters = useMemo<ChangeLogFilters>(
    () => ({
      tableName: tableFilter || undefined,
      dateFrom: dateFrom ? startOfDayIso(dateFrom) : undefined,
      dateTo: dateTo ? endOfDayIso(dateTo) : undefined,
      userId: userId ? Number(userId) : undefined,
      action: (action || undefined) as ChangeLogFilters["action"],
      productId: productId ? Number(productId) : undefined,
      shift: (shift || undefined) as ChangeLogFilters["shift"],
      importOnly: importOnly || undefined,
      // Only meaningful (and only offered) while looking at generated reports.
      reportType:
        tableFilter === REPORTS_TABLE
          ? ((reportType || undefined) as ChangeLogFilters["reportType"])
          : undefined,
      reportSection:
        tableFilter === REPORTS_TABLE
          ? ((reportSection || undefined) as ChangeLogFilters["reportSection"])
          : undefined,
    }),
    [tableFilter, dateFrom, dateTo, userId, action, productId, shift, importOnly, reportType, reportSection],
  );
  const filterKey = JSON.stringify(filters);

  // How many rows are on screen, read by the realtime refresh below without
  // making it re-run every time a page is appended.
  const loadedCount = useRef(0);
  useEffect(() => {
    loadedCount.current = entries?.length ?? 0;
  });

  useResetOnKeyChange(filterKey, () => {
    setEntries(null);
    setNextCursor(null);
  });
  // Bumped whenever the filters change or a refresh starts, so a slow "Load
  // more" (or an older refresh) can't land rows from a stale view.
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    // A realtime event can fire in bursts while an encoder saves a sheet; wait
    // for it to settle rather than re-reading up to 500 rows per event. The
    // first load for a given filter set is immediate.
    const delay = loadedCount.current > 0 ? REFRESH_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => {
      const limit = Math.min(MAX_REFRESH_ROWS, Math.max(PAGE_SIZE, loadedCount.current));
      listChangeLogPage(filters, { limit })
        .then((page) => {
          if (cancelled) return;
          setEntries(page.items);
          setNextCursor(page.nextCursor);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setEntries((cur) => cur ?? []);
          setError(
            reason instanceof Error ? reason.message : "Failed to load change log",
          );
        });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Invalidate any in-flight "Load more" for the view being replaced.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
    // filterKey is the serialized `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, realtimeVersion]);

  // The user/product pickers are a convenience - without them the filters
  // just aren't offered, the log itself still works.
  useEffect(() => {
    listChangeLogUsers().then(setUsers).catch(() => {});
    listProducts({ includeInactive: true }).then(setProducts).catch(() => {});
  }, []);

  function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const gen = generation.current;
    listChangeLogPage(filters, { limit: PAGE_SIZE, cursor: nextCursor })
      .then((page) => {
        if (gen !== generation.current) return;
        setEntries((cur) => [...(cur ?? []), ...page.items]);
        setNextCursor(page.nextCursor);
      })
      .catch((reason: unknown) => {
        if (gen !== generation.current) return;
        setError(reason instanceof Error ? reason.message : "Failed to load more");
      })
      .finally(() => setLoadingMore(false));
  }

  function exportCsv() {
    setExporting(true);
    exportChangeLogCsv(filters)
      .then((blob) =>
        // BOM so Excel reads the "→" in "What changed" as UTF-8.
        saveBlob(new Blob(["﻿", blob], { type: "text/csv;charset=utf-8" }), "change-log.csv"),
      )
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Export failed");
      })
      .finally(() => setExporting(false));
  }

  const filtered = useMemo(
    () =>
      entries?.filter((e) =>
        matchesSearch(
          [
          tableLabel(e.tableName),
          e.action,
          e.tableName === SYSTEM_TABLE ? changeEventLabel(e) : undefined,
          e.changedBy?.name,
          e.changedBy?.username,
          e.recordId,
          e.context?.sku,
          e.context?.productName,
          e.summary,
          e.tableName === "users" ? accountName(e) : undefined,
          e.source ? SOURCE_TAG[e.source] : undefined,
        ],
        query,
      ),
    ),
    [entries, query],
  );

  // Group entries by the table they belong to (Online Stock, Offline Stock,
  // Manual Count, SKUs), in the same fixed order as TABLE_LABELS, with any
  // other table after them. The API's newest-first ordering is kept inside
  // each group.
  const groupedByTable = useMemo(() => {
    const groups = new Map<string, ChangeLogEntry[]>();
    for (const entry of filtered ?? []) {
      const bucket = groups.get(entry.tableName);
      if (bucket) bucket.push(entry);
      else groups.set(entry.tableName, [entry]);
    }
    const order = Object.keys(TABLE_LABELS);
    const rank = (t: string) => {
      const i = order.indexOf(t);
      return i === -1 ? order.length : i;
    };
    return Array.from(groups.entries()).sort(
      (x, y) => rank(x[0]) - rank(y[0]) || x[0].localeCompare(y[0]),
    );
  }, [filtered]);

  function toggleGroup(table: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  }

  function groupHeading(table: string, count: number) {
    const isCollapsed = collapsed.has(table);
    return (
      <tr>
        <td colSpan={COLUMNS.length} style={groupHeadingStyle}>
          <button
            type="button"
            onClick={() => toggleGroup(table)}
            aria-expanded={!isCollapsed}
            style={groupToggleStyle}
          >
            <span aria-hidden="true">{isCollapsed ? "▶" : "▼"}</span>
            {tableLabel(table)}
            <span style={{ fontWeight: 500, color: colors.subtleInk }}>
              ({count})
            </span>
          </button>
        </td>
      </tr>
    );
  }

  const loaded = !!entries;
  const nothingToShow = (filtered?.length ?? 0) === 0;

  return (
    <div>
      <PageHeader
        title="Change Log"
        subtitle="Every create/update/delete across the app, including system events, is attributed and timestamped. Click a row to see exactly what changed."
      >
        <Toolbar>
          {/* The filter cluster must be the toolbar's first child (see
              .ae-toolbar > :first-child in index.css). */}
          <div>
            <Dropdown
              className="ae-fit"
              aria-label="Table"
              value={tableFilter}
              onChange={setTableFilter}
              options={TABLE_FILTERS.map((t) => ({
                value: t,
                label: t ? tableLabel(t) : "All tables",
              }))}
            />
            <DateRangePicker
              className="ae-fit"
              aria-label="Date range"
              from={dateFrom}
              to={dateTo}
              onChange={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
              }}
            />
            <Dropdown
              className="ae-fit"
              aria-label="User"
              value={userId}
              onChange={setUserId}
              options={[
                { value: "", label: "All users" },
                ...users.map((u) => ({ value: String(u.id), label: u.name })),
              ]}
            />
            <Dropdown
              className="ae-fit"
              aria-label="Action"
              value={action}
              onChange={setAction}
              options={[
                { value: "", label: "All actions" },
                { value: "CREATE", label: "Create" },
                { value: "UPDATE", label: "Update" },
                { value: "DELETE", label: "Delete" },
              ]}
            />
            <Dropdown
              className="ae-fit"
              aria-label="Product or SKU"
              value={productId}
              onChange={setProductId}
              options={[
                { value: "", label: "All products" },
                ...products.map((p) => ({
                  value: String(p.id),
                  label: p.sku ? `${p.sku} · ${p.name}` : p.name,
                })),
              ]}
            />
            <Dropdown
              className="ae-fit"
              aria-label="Shift"
              value={shift}
              onChange={setShift}
              options={[
                { value: "", label: "Both shifts" },
                { value: "MORNING", label: "Morning" },
                { value: "NIGHT", label: "Night" },
              ]}
            />
            {tableFilter === REPORTS_TABLE && (
              <>
                <Dropdown
                  className="ae-fit"
                  aria-label="Report type"
                  value={reportType}
                  onChange={setReportType}
                  options={[
                    { value: "", label: "All reports" },
                    { value: "Daily Report", label: "Daily Report" },
                    { value: "Variance Report", label: "Variance Report" },
                    { value: "Audit Report", label: "Audit Report" },
                  ]}
                />
                <Dropdown
                  className="ae-fit"
                  aria-label="Report section"
                  value={reportSection}
                  onChange={setReportSection}
                  options={[
                    { value: "", label: "Online + Offline" },
                    { value: "online", label: "Online" },
                    { value: "offline", label: "Offline" },
                    { value: "all", label: "Full (combined)" },
                  ]}
                />
              </>
            )}
            <label style={importOnlyStyle}>
              <input
                type="checkbox"
                checked={importOnly}
                onChange={(e) => setImportOnly(e.target.checked)}
              />
              From CSV import
            </label>
          </div>
          <ToolbarControls>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search by table, action, user, or SKU…"
            />
            <Button
              variant="secondary"
              onClick={exportCsv}
              disabled={exporting}
              title="Download everything matching the filters (not just the rows loaded)"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </ToolbarControls>
        </Toolbar>
      </PageHeader>

      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      {!loaded ? (
        <TableSkeleton
          headers={COLUMNS}
          minWidth={720}
          label="Loading change log…"
        />
      ) : nothingToShow ? (
        <p style={{ color: colors.subtleInk }}>No matching entries.</p>
      ) : (
        <RowGlowScroll>
          <table className="ae-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                {COLUMNS.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedByTable.map(([table, tableEntries]) => (
                <Fragment key={table}>
                  {groupHeading(table, tableEntries.length)}
                  {!collapsed.has(table) &&
                    tableEntries.map((entry) =>
                      table === SYSTEM_TABLE ? (
                        <SystemChangeRow
                          key={entry.id}
                          entry={entry}
                          expanded={expanded === entry.id}
                          onToggle={() =>
                            setExpanded((cur) =>
                              cur === entry.id ? null : entry.id,
                            )
                          }
                        />
                      ) : (
                        <ChangeLogRow
                          key={entry.id}
                          entry={entry}
                          expanded={expanded === entry.id}
                          onToggle={() =>
                            setExpanded((cur) =>
                              cur === entry.id ? null : entry.id,
                            )
                          }
                        />
                      ),
                    )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </RowGlowScroll>
      )}
      {loaded && nextCursor !== null && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

/// A server-written "system" change row (e.g. Data Reset). Click to see what
/// it removed - the counts are in newValue.deleted.
function SystemChangeRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ChangeLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const deleted = ((
    entry.newValue as { deleted?: Record<string, number> } | null
  )?.deleted ?? {}) as Record<string, number>;
  const counts = Object.entries(deleted);
  return (
    <>
      <tr
        style={{ cursor: counts.length ? "pointer" : undefined }}
        onClick={counts.length ? onToggle : undefined}
        onKeyDown={counts.length ? toggleOnKey(onToggle) : undefined}
        tabIndex={counts.length ? 0 : undefined}
        aria-expanded={counts.length ? expanded : undefined}
      >
        <td style={{ whiteSpace: "nowrap" }}>
          {new Date(entry.changedAt).toLocaleString()}
        </td>
        <td style={{ whiteSpace: "nowrap", color: colors.subtleInk }}>—</td>
        <td
          style={{
            textAlign: "left",
            fontWeight: 700,
            color: ACTION_COLOR[entry.action],
          }}
        >
          {changeEventLabel(entry)}
          <SourceTag source={entry.source} />
        </td>
        <td style={summaryCellStyle}>
          {counts.length
            ? `Removed ${counts.reduce((sum, [, n]) => sum + n, 0)} rows`
            : "—"}
        </td>
        <td
          style={{ textAlign: "left", whiteSpace: "nowrap", color: colors.ink }}
        >
          {entry.changedBy?.name ?? "system"}
        </td>
        <td style={{ color: colors.subtleInk }}>
          {counts.length ? (expanded ? "▲" : "▼") : ""}
        </td>
      </tr>
      {expanded && counts.length > 0 && (
        <tr>
          <td
            colSpan={COLUMNS.length}
            style={{
              padding: "8px 12px 16px",
              background: colors.paperAlt,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <table className="ae-table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Removed", "Rows"].map((h) => (
                    <th key={h} style={{ padding: "3px 10px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {counts.map(([key, count]) => (
                  <tr key={key}>
                    <td
                      style={{
                        textAlign: "left",
                        padding: "3px 10px",
                        color: colors.ink,
                      }}
                    >
                      {key}
                    </td>
                    <td style={{ padding: "3px 10px", fontWeight: 600 }}>
                      {count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function ChangeLogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ChangeLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  // The server's friendly-named diff; diffFields only for a row without one.
  const diffs = entry.changes ?? diffFields(entry.oldValue, entry.newValue);

  return (
    <>
      <tr
        style={{ cursor: "pointer" }}
        onClick={onToggle}
        onKeyDown={toggleOnKey(onToggle)}
        tabIndex={0}
        aria-expanded={expanded}
      >
        <td style={{ whiteSpace: "nowrap" }}>
          {new Date(entry.changedAt).toLocaleString()}
        </td>
        <td style={{ textAlign: "left" }}>
          {entry.tableName === REPORTS_TABLE
            ? "Generated report"
            : entry.tableName === "users"
              ? `User · ${accountName(entry)}`
              : recordLabel(entry.context, entry.recordId)}
        </td>
        <td
          style={{
            textAlign: "left",
            fontWeight: 700,
            color: ACTION_COLOR[entry.action],
          }}
        >
          {entry.action}
          <SourceTag source={entry.source} />
          {entry.causedById != null && (
            <span
              style={sourceTagStyle}
              title={`Made by the system as a consequence of change #${entry.causedById} (the carried-forward opening stock was re-derived)`}
            >
              Auto · from #{entry.causedById}
            </span>
          )}
        </td>
        <td style={summaryCellStyle}>{entry.summary ?? ""}</td>
        <td
          style={{ textAlign: "left", whiteSpace: "nowrap", color: colors.ink }}
        >
          {entry.changedBy?.name ?? "system"}
        </td>
        <td style={{ color: colors.subtleInk }}>{expanded ? "▲" : "▼"}</td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={COLUMNS.length}
            style={{
              padding: "8px 12px 16px",
              background: colors.paperAlt,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {diffs.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.subtleInk }}>
                {entry.action === "CREATE"
                  ? "New record - no prior value to compare."
                  : "No field-level differences recorded."}
              </span>
            ) : (
              <table className="ae-table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["Field", "Before", "After"].map((h) => (
                      <th key={h} style={{ padding: "3px 10px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.key}>
                      <td
                        style={{
                          textAlign: "left",
                          padding: "3px 10px",
                          color: colors.ink,
                        }}
                      >
                        {d.label}
                      </td>
                      <td style={{ padding: "3px 10px" }}>{d.before}</td>
                      <td style={{ padding: "3px 10px", fontWeight: 600 }}>
                        {d.after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/// Enter/Space on a focused row toggles it, like a click.
function toggleOnKey(onToggle: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
}

/// The account a "users" change row is about (names live in the snapshots).
function accountName(entry: ChangeLogEntry): string {
  const v = (entry.newValue ?? entry.oldValue) as { username?: string; name?: string } | null;
  return v?.username ?? v?.name ?? `#${entry.recordId}`;
}

/// Marks bulk changes - a CSV import or a data reset - so they stand apart
/// from a single manual edit.
function SourceTag({ source }: { source?: "import" | "reset" | null }) {
  if (!source) return null;
  return (
    <span style={sourceTagStyle} title="Bulk change, not a single manual edit">
      {SOURCE_TAG[source]}
    </span>
  );
}

const IGNORED_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

/// Only the fields that actually changed - not the whole record - so a
/// one-cell edit shows as a one-row diff instead of a wall of unchanged JSON.
function diffFields(
  oldValue: unknown,
  newValue: unknown,
): { key: string; label: string; before: string; after: string }[] {
  const oldObj = (oldValue ?? {}) as Record<string, unknown>;
  const newObj = (newValue ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  const diffs: { key: string; label: string; before: string; after: string }[] = [];
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const before = oldObj[key];
    const after = newObj[key];
    if (String(before ?? "") === String(after ?? "")) continue;
    diffs.push({
      key,
      label: key,
      before: before === undefined ? "—" : String(before),
      after: after === undefined ? "—" : String(after),
    });
  }
  return diffs;
}

const groupHeadingStyle: CSSProperties = {
  textAlign: "left",
  padding: "0",
  fontSize: 13,
  fontWeight: 700,
  color: colors.ink,
  borderBottom: `1px solid ${colors.border}`,
  background: colors.paperAlt,
};

const groupToggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "10px 6px 6px",
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const importOnlyStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: colors.ink,
  padding: "0 8px",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const summaryCellStyle: CSSProperties = {
  textAlign: "left",
  color: colors.ink,
};

const sourceTagStyle: CSSProperties = {
  display: "inline-block",
  marginLeft: 8,
  padding: "1px 7px",
  borderRadius: 999,
  border: `1px solid ${colors.border}`,
  background: colors.paperAlt,
  color: colors.subtleInk,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
