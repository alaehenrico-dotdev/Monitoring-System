import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { listChangeLog } from "../api/changeLog";
import type { ChangeLogEntry } from "../types";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { Dropdown } from "../components/Dropdown";
import { matchesSearch } from "../utils/search";
import { TABLE_LABELS, ACTION_COLOR } from "../config/changeLog";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";

const TABLE_FILTERS = ["", ...Object.keys(TABLE_LABELS)];

/**
 * Section 4.8 - Change Log (grouped by table): every create/edit to a stock entry, manual
 * count, product, or receipt is timestamped and attributed to the encoder
 * who made it, so a disputed number can be traced back to its source
 * instead of disappearing into an overwritten cell (Section 2.1). The
 * backend has recorded this from day one (recordChange() in every write
 * path); this page is the first place it's actually visible.
 */
export function ChangeLogPage() {
  const [entries, setEntries] = useState<ChangeLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  // Tables whose group is collapsed - every group starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const realtimeVersion = useRealtimeVersion();

  useResetOnKeyChange(tableFilter, () => setEntries(null));
  useEffect(() => {
    listChangeLog({ tableName: tableFilter || undefined })
      .then(setEntries)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load change log"),
      );
  }, [tableFilter, realtimeVersion]);

  const filtered = entries?.filter((e) =>
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

  return (
    <div>
      <PageHeader
        title="Change Log"
        subtitle="Every create/update/delete across the app, attributed and timestamped - click a row to see exactly what changed."
      >
        <Toolbar>
          <Dropdown
            aria-label="Table"
            value={tableFilter}
            onChange={setTableFilter}
            options={TABLE_FILTERS.map((t) => ({
              value: t,
              label: t ? (TABLE_LABELS[t] ?? t) : "All tables",
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

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!entries ? (
        <TableSkeleton
          headers={["When", "Record", "Action", "Changed By", ""]}
          minWidth={720}
          label="Loading change log…"
        />
      ) : filtered && filtered.length === 0 ? (
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
              {groupedByTable.map(([table, tableEntries]) => {
                const isCollapsed = collapsed.has(table);
                return (
                  <Fragment key={table}>
                    <tr>
                      <td colSpan={5} style={groupHeadingStyle}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(table)}
                          aria-expanded={!isCollapsed}
                          style={groupToggleStyle}
                        >
                          <span aria-hidden="true">
                            {isCollapsed ? "▶" : "▼"}
                          </span>
                          {TABLE_LABELS[table] ?? table}
                          <span
                            style={{ fontWeight: 500, color: colors.subtleInk }}
                          >
                            ({tableEntries.length})
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!isCollapsed &&
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
                );
              })}
            </tbody>
          </table>
        </RowGlowScroll>
      )}
    </div>
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
