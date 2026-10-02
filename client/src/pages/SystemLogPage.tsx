import { useEffect, useMemo, useState } from "react";
import { listSystemLog, type SystemLogEntry } from "../api/systemLog";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { SearchInput } from "../components/SearchInput";
import { matchesSearch } from "../utils/search";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import { colors } from "../theme";
import { useRealtimeVersion } from "../context/RealtimeContext";

const EVENT_LABELS: Record<string, string> = {
  DESKTOP_UPDATE: "Desktop app updated",
};

const HEADERS = ["When", "Event", "Update", "On"];

/**
 * System Log - the app's own version/release history, separate from Change
 * Log (which tracks edits to business records). Today this only ever
 * records a desktop installation auto-updating itself (see
 * client/src/tauri/updater.ts) - a plain string `event` on the server lets a
 * future event kind (a server deploy hook, say) show up here without a
 * migration.
 */
export function SystemLogPage() {
  const [entries, setEntries] = useState<SystemLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    listSystemLog()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load system log"));
  }, [realtimeVersion]);

  const filtered = useMemo(
    () =>
      entries?.filter((e) =>
        matchesSearch([EVENT_LABELS[e.event] ?? e.event, e.fromVersion, e.toVersion, e.user?.name, e.user?.username], query),
      ),
    [entries, query],
  );

  return (
    <div>
      <PageHeader title="System Log" subtitle="When the app itself was updated to a new version, and on whose device.">
        <Toolbar>
          <ToolbarControls>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by version or user…" />
          </ToolbarControls>
        </Toolbar>
      </PageHeader>

      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
      {!entries ? (
        <TableSkeleton headers={HEADERS} minWidth={560} label="Loading system log…" />
      ) : filtered && filtered.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>{entries.length === 0 ? "No updates recorded yet." : "No matching entries."}</p>
      ) : (
        <RowGlowScroll>
          <table className="ae-table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                {HEADERS.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered?.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(entry.occurredAt).toLocaleString()}</td>
                  <td style={{ textAlign: "left", color: colors.ink }}>{EVENT_LABELS[entry.event] ?? entry.event}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    v{entry.fromVersion} <span style={{ color: colors.subtleInk }}>→</span>{" "}
                    <strong style={{ color: colors.ink }}>v{entry.toVersion}</strong>
                  </td>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap", color: colors.ink }}>{entry.user?.name ?? "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </RowGlowScroll>
      )}
    </div>
  );
}
