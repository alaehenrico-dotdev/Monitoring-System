import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { listChangeLog } from "../api/changeLog";
import { listSystemLog, type SystemLogEntry } from "../api/systemLog";
import type { ChangeLogEntry } from "../types";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { SearchInput } from "../components/SearchInput";
import { Dropdown } from "../components/Dropdown";
import { matchesSearch } from "../utils/search";
import { TABLE_LABELS, ACTION_COLOR } from "../config/changeLog";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";

// System Log (the app's own version/update history - see tauri/updater.ts)
// shows as one more group alongside the record tables, under this pseudo
// table key.
const SYSTEM_TABLE = "system_log";
// Change-log rows the server writes under tableName "system" (today: Data
// Reset, see dataReset.service.ts) belong in this same group.
const SYSTEM_CHANGE_TABLE = "system";
const SYSTEM_EVENT_LABELS: Record<string, string> = {
  DESKTOP_UPDATE: "Desktop app updated",
  data_reset: "All data reset",
};

type SystemItem =
  | { kind: "update"; at: number; entry: SystemLogEntry }
  | { kind: "change"; at: number; entry: ChangeLogEntry };

function changeEventLabel(entry: ChangeLogEntry): string {
  const event = (entry.newValue as { event?: string } | null)?.event;
  return (event && SYSTEM_EVENT_LABELS[event]) || event || "System event";
}
const TABLE_FILTERS = ["", ...Object.keys(TABLE_LABELS), SYSTEM_TABLE];
const tableLabel = (table: string) =>
  table === SYSTEM_TABLE ? "System Log" : (TABLE_LABELS[table] ?? table);

/**
 * Section 4.8 - Change Log (grouped by table): every create/edit to a stock entry, manual
 * count, product, or receipt is timestamped and attributed to the encoder
 * who made it, so a disputed number can be traced back to its source
 * instead of disappearing into an overwritten cell (Section 2.1). The
 * backend has recorded this from day one (recordChange() in every write
 * path); this page is the first place it's actually visible.
 *
 * The System Log - when the app itself was updated to a new version, and on
 * whose device - is the last group here, so everything that was ever changed
 * is in one place. Each list loads independently: if one fails the other
 * still shows, with an error toast for the one that didn't.
 */
export function ChangeLogPage() {
  const [entries, setEntries] = useState<ChangeLogEntry[] | null>(null);
  const [systemEntries, setSystemEntries] = useState<SystemLogEntry[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  // Tables whose group is collapsed - every group starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const realtimeVersion = useRealtimeVersion();

  useResetOnKeyChange(tableFilter, () => {
    setEntries(null);
    setSystemEntries(null);
  });
  useEffect(() => {
    let cancelled = false;
    const wantChanges = tableFilter !== SYSTEM_TABLE;
    const wantSystem = tableFilter === "" || tableFilter === SYSTEM_TABLE;
    Promise.allSettled([
      wantChanges
        ? listChangeLog({
            tableName:
              tableFilter === SYSTEM_TABLE
                ? SYSTEM_CHANGE_TABLE
                : tableFilter || undefined,
          })
        : Promise.resolve([] as ChangeLogEntry[]),
      wantSystem ? listSystemLog() : Promise.resolve([] as SystemLogEntry[]),
    ]).then(([changes, system]) => {
      if (cancelled) return;
      const failures: string[] = [];
      if (changes.status === "fulfilled") setEntries(changes.value);
      else {
        setEntries([]);
        failures.push(
          changes.reason instanceof Error
            ? changes.reason.message
            : "Failed to load change log",
        );
      }
      if (system.status === "fulfilled") setSystemEntries(system.value);
      else {
        setSystemEntries([]);
        failures.push(
          system.reason instanceof Error
            ? system.reason.message
            : "Failed to load system log",
        );
      }
      if (failures.length) setError(failures.join(" / "));
    });
    return () => {
      cancelled = true;
    };
  }, [tableFilter, realtimeVersion]);

  const filtered = entries
    ?.filter((e) => e.tableName !== SYSTEM_CHANGE_TABLE)
    .filter((e) =>
      matchesSearch(
        [
          TABLE_LABELS[e.tableName] ?? e.tableName,
          e.action,
          e.changedBy?.name,
          e.changedBy?.username,
          e.recordId,
        ],
        query,
      ),
    );

  // App updates + the server's own "system" change rows, newest first.
  const filteredSystem = useMemo(() => {
    if (!systemEntries || !entries) return undefined;
    const items: SystemItem[] = [
      ...systemEntries
        .filter((e) =>
          matchesSearch(
            [
              "System Log",
              SYSTEM_EVENT_LABELS[e.event] ?? e.event,
              e.fromVersion,
              e.toVersion,
              e.user?.name,
              e.user?.username,
            ],
            query,
          ),
        )
        .map(
          (entry): SystemItem => ({
            kind: "update",
            at: new Date(entry.occurredAt).getTime(),
            entry,
          }),
        ),
      ...entries
        .filter((e) => e.tableName === SYSTEM_CHANGE_TABLE)
        .filter((e) =>
          matchesSearch(
            [
              "System Log",
              changeEventLabel(e),
              e.action,
              e.changedBy?.name,
              e.changedBy?.username,
            ],
            query,
          ),
        )
        .map(
          (entry): SystemItem => ({
            kind: "change",
            at: new Date(entry.changedAt).getTime(),
            entry,
          }),
        ),
    ];
    return items.sort((a, b) => b.at - a.at);
  }, [systemEntries, entries, query]);

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
        <td colSpan={5} style={groupHeadingStyle}>
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

  const loaded = !!entries && !!systemEntries;
  const nothingToShow =
    (filtered?.length ?? 0) === 0 && (filteredSystem?.length ?? 0) === 0;

  return (
    <div>
      <PageHeader
        title="Change Log"
        subtitle="Every create/update/delete across the app, plus app updates (System Log) - attributed and timestamped. Click a row to see exactly what changed."
      >
        <Toolbar>
          <Dropdown
            aria-label="Table"
            value={tableFilter}
            onChange={setTableFilter}
            options={TABLE_FILTERS.map((t) => ({
              value: t,
              label: t ? tableLabel(t) : "All tables",
            }))}
            style={{ minWidth: 160 }}
          />
          <ToolbarControls>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search by table, action, or user…"
            />
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
          headers={["When", "Record", "Action", "Changed By", ""]}
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
                {["When", "Record", "Action", "Changed By", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedByTable.map(([table, tableEntries]) => (
                <Fragment key={table}>
                  {groupHeading(table, tableEntries.length)}
                  {!collapsed.has(table) &&
                    tableEntries.map((entry) => (
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
                    ))}
                </Fragment>
              ))}
              {filteredSystem && filteredSystem.length > 0 && (
                <Fragment key={SYSTEM_TABLE}>
                  {groupHeading(SYSTEM_TABLE, filteredSystem.length)}
                  {!collapsed.has(SYSTEM_TABLE) &&
                    filteredSystem.map((item) =>
                      item.kind === "update" ? (
                        <SystemLogRow
                          key={`update-${item.entry.id}`}
                          entry={item.entry}
                        />
                      ) : (
                        <SystemChangeRow
                          key={`change-${item.entry.id}`}
                          entry={item.entry}
                          expanded={expanded === item.entry.id}
                          onToggle={() =>
                            setExpanded((cur) =>
                              cur === item.entry.id ? null : item.entry.id,
                            )
                          }
                        />
                      ),
                    )}
                </Fragment>
              )}
            </tbody>
          </table>
        </RowGlowScroll>
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
            colSpan={5}
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

/// One app-update entry, in the same columns as a change row: Record shows the
/// version jump, Action the event, Changed By whoever's device updated.
function SystemLogRow({ entry }: { entry: SystemLogEntry }) {
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>
        {new Date(entry.occurredAt).toLocaleString()}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        v{entry.fromVersion} <span style={{ color: colors.subtleInk }}>→</span>{" "}
        <strong style={{ color: colors.ink }}>v{entry.toVersion}</strong>
      </td>
      <td style={{ textAlign: "left", fontWeight: 700, color: colors.ink }}>
        {SYSTEM_EVENT_LABELS[entry.event] ?? entry.event}
      </td>
      <td
        style={{ textAlign: "left", whiteSpace: "nowrap", color: colors.ink }}
      >
        {entry.user?.name ?? "Unknown"}
      </td>
      <td />
    </tr>
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
  const diffs = diffFields(entry.oldValue, entry.newValue);

  return (
    <>
      <tr style={{ cursor: "pointer" }} onClick={onToggle}>
        <td style={{ whiteSpace: "nowrap" }}>
          {new Date(entry.changedAt).toLocaleString()}
        </td>
        <td>#{entry.recordId}</td>
        <td
          style={{
            textAlign: "left",
            fontWeight: 700,
            color: ACTION_COLOR[entry.action],
          }}
        >
          {entry.action}
        </td>
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
            colSpan={5}
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
                        {d.key}
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

const IGNORED_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

/// Only the fields that actually changed - not the whole record - so a
/// one-cell edit shows as a one-row diff instead of a wall of unchanged JSON.
function diffFields(
  oldValue: unknown,
  newValue: unknown,
): { key: string; before: string; after: string }[] {
  const oldObj = (oldValue ?? {}) as Record<string, unknown>;
  const newObj = (newValue ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  const diffs: { key: string; before: string; after: string }[] = [];
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const before = oldObj[key];
    const after = newObj[key];
    if (String(before ?? "") === String(after ?? "")) continue;
    diffs.push({
      key,
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
