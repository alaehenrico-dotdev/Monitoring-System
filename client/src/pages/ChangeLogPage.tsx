import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { listChangeLog } from "../api/changeLog";
import type { ChangeLogEntry } from "../types";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { Select } from "../components/ui";
import { matchesSearch } from "../utils/search";
import { colors } from "../theme";

const TABLE_LABELS: Record<string, string> = {
  daily_online_stock: "Online Stock",
  daily_offline_stock: "Offline Stock",
  manual_counts: "Manual Count",
  products: "Products",
  receipts: "Receipts",
};

const TABLE_FILTERS = ["", ...Object.keys(TABLE_LABELS)];

const ACTION_COLOR: Record<ChangeLogEntry["action"], string> = {
  CREATE: colors.warningText,
  UPDATE: colors.ink,
  DELETE: colors.danger,
};

/**
 * Section 4.8 - Change Log: every create/edit to a stock entry, manual
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

  useEffect(() => {
    setEntries(null);
    listChangeLog({ tableName: tableFilter || undefined })
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load change log"));
  }, [tableFilter]);

  const filtered = entries?.filter((e) =>
    matchesSearch([TABLE_LABELS[e.tableName] ?? e.tableName, e.action, e.changedBy?.name, e.changedBy?.username, e.recordId], query)
  );

  // Group entries by the local calendar day they were changed on, preserving
  // the API's newest-first ordering within and across days, so the log reads
  // as a day-by-day timeline instead of one long flat table.
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, ChangeLogEntry[]>();
    for (const entry of filtered ?? []) {
      const day = dayKey(entry.changedAt);
      const bucket = groups.get(day);
      if (bucket) bucket.push(entry);
      else groups.set(day, [entry]);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  return (
    <div>
      <h2 style={{ margin: "0 0 3px" }}>Change Log</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, marginBottom: 8 }}>
        Every create/update/delete across the app, attributed and timestamped - click a row to see exactly what changed.
      </p>

      <Toolbar>
        <Select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} style={{ minWidth: 160 }}>
          {TABLE_FILTERS.map((t) => (
            <option key={t} value={t}>
              {t ? (TABLE_LABELS[t] ?? t) : "All tables"}
            </option>
          ))}
        </Select>
        <ToolbarControls>
          <SearchInput value={query} onChange={setQuery} placeholder="Search by table, action, or user…" />
        </ToolbarControls>
      </Toolbar>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!entries ? (
        <p>Loading…</p>
      ) : filtered && filtered.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>No matching entries.</p>
      ) : (
        <div className="ae-table-scroll table-scroll">
          <table className="ae-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                {["When", "Table", "Record", "Action", "Changed By", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedByDay.map(([day, dayEntries]) => (
                <Fragment key={day}>
                  <tr>
                    <td colSpan={6} style={dayHeadingStyle}>
                      {formatDayHeading(day)}
                    </td>
                  </tr>
                  {dayEntries.map((entry) => (
                    <ChangeLogRow key={entry.id} entry={entry} expanded={expanded === entry.id} onToggle={() => setExpanded((cur) => (cur === entry.id ? null : entry.id))} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChangeLogRow({ entry, expanded, onToggle }: { entry: ChangeLogEntry; expanded: boolean; onToggle: () => void }) {
  const diffs = diffFields(entry.oldValue, entry.newValue);

  return (
    <>
      <tr style={{ cursor: "pointer" }} onClick={onToggle}>
        <td style={{ whiteSpace: "nowrap" }}>{new Date(entry.changedAt).toLocaleString()}</td>
        <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{TABLE_LABELS[entry.tableName] ?? entry.tableName}</td>
        <td>#{entry.recordId}</td>
        <td style={{ textAlign: "left", fontWeight: 700, color: ACTION_COLOR[entry.action] }}>{entry.action}</td>
        <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{entry.changedBy?.name ?? "system"}</td>
        <td style={{ color: colors.subtleInk }}>{expanded ? "▲" : "▼"}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ padding: "8px 12px 16px", background: "#faf7ee", borderBottom: `1px solid ${colors.border}` }}>
            {diffs.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.subtleInk }}>
                {entry.action === "CREATE" ? "New record - no prior value to compare." : "No field-level differences recorded."}
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
                      <td style={{ textAlign: "left", padding: "3px 10px" }}>{d.key}</td>
                      <td style={{ padding: "3px 10px" }}>{d.before}</td>
                      <td style={{ padding: "3px 10px", fontWeight: 600 }}>{d.after}</td>
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
function diffFields(oldValue: unknown, newValue: unknown): { key: string; before: string; after: string }[] {
  const oldObj = (oldValue ?? {}) as Record<string, unknown>;
  const newObj = (newValue ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  const diffs: { key: string; before: string; after: string }[] = [];
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const before = oldObj[key];
    const after = newObj[key];
    if (String(before ?? "") === String(after ?? "")) continue;
    diffs.push({ key, before: before === undefined ? "—" : String(before), after: after === undefined ? "—" : String(after) });
  }
  return diffs;
}

/// Local calendar-day key (not UTC) so an entry groups under the day it
/// actually shows in the "When" column, which also renders in local time.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayHeading(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const dayHeadingStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 6px 5px",
  fontSize: 13,
  fontWeight: 700,
  color: colors.subtleInk,
  borderBottom: `1px solid ${colors.border}`,
  background: "#faf7ee",
};
