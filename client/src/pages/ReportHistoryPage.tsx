import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listReportHistory,
  type ReportHistoryEntry,
} from "../api/reportHistory";
import { getAuditSnapshotStates, revertAuditSnapshot, type AuditSnapshotState } from "../api/manualCounts";
import { useAuth } from "../context/AuthContext";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui";
import { matchesSearch } from "../utils/search";
import { describe } from "../utils/reportHistoryText";
import { reportHistoryCsv } from "../utils/reportHistoryCsv";
import { downloadCsv } from "../utils/csv";
import { localDateStamp } from "../utils/dateFormat";
import { DownloadIcon, HistoryIcon } from "../components/icons";
import { DatePicker } from "../components/DatePicker";
import { FilterSlot } from "../components/FilterSlot";
import { PageToolbar } from "../components/PageToolbar";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { Toast } from "../components/Toast";
import { TableSkeleton } from "../components/Skeleton";
import { useRealtimeVersion } from "../context/RealtimeContext";

type HistoryType = ReportHistoryEntry["type"];

interface Props {
  type: HistoryType;
  title: string;
  subtitle: string;
  /// The report page this history belongs to ("Back to ..." + the empty-state link).
  backTo: string;
  backLabel: string;
}

/**
 * Shared body of the Daily / Variance / Audit / Daily Out History pages: one
 * plain table, newest first - what each report covers, when it was generated
 * (and by whom) and a Download action. Searchable, and narrowable to a range
 * of generated dates. Server-backed (api/reportHistory.ts) - the same list for every device and
 * tester, not just whichever browser happened to generate a given report.
 */
export function ReportHistoryPage({
  type,
  title,
  subtitle,
  backTo,
  backLabel,
}: Props) {
  const [history, setHistory] = useState<ReportHistoryEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Narrow to reports generated within these local days ("" = no limit).
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const realtimeVersion = useRealtimeVersion();
  const isAdmin = useAuth().user?.role === "SUPERVISOR_ADMIN";

  // Audit History only: where each published audit stands, so an admin can
  // revert one (its counts go back to unpublished to be re-audited).
  const [states, setStates] = useState<Record<number, AuditSnapshotState>>({});
  const [reverting, setReverting] = useState<ReportHistoryEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const snapshotIds = useMemo(
    () => (type === "Audit Report" ? [...new Set((history ?? []).map((e) => snapshotIdOf(e)).filter((n): n is number => n !== null))] : []),
    [type, history],
  );
  const loadStates = useCallback(
    (ids: number[]) => {
      for (let i = 0; i < ids.length; i += 100) {
        getAuditSnapshotStates(ids.slice(i, i + 100))
          .then((list) => setStates((prev) => ({ ...prev, ...Object.fromEntries(list.map((s) => [s.id, s])) })))
          .catch(() => {
            // Cosmetic: without it no row offers Revert; Download still works.
          });
      }
    },
    [],
  );
  useEffect(() => {
    if (snapshotIds.length > 0) loadStates(snapshotIds);
  }, [snapshotIds, realtimeVersion, loadStates]);

  useEffect(() => {
    // Refreshes (a realtime nudge) replace only the newest page, so older pages
    // the person already loaded stay where they are.
    listReportHistory(type)
      .then((first) => {
        setHistory((prev) => {
          const oldest = first.items.length ? first.items[first.items.length - 1].id : Infinity;
          const older = (prev ?? []).filter((e) => e.id < oldest);
          return [...first.items, ...older];
        });
        setNextCursor((prevCursor) =>
          prevCursor !== null && prevCursor < (first.nextCursor ?? Infinity) ? prevCursor : first.nextCursor,
        );
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Failed to load report history",
        ),
      );
  }, [type, realtimeVersion]);

  function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    listReportHistory(type, nextCursor)
      .then((page) => {
        setHistory((prev) => {
          const have = new Set((prev ?? []).map((e) => e.id));
          return [...(prev ?? []), ...page.items.filter((e) => !have.has(e.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load more"))
      .finally(() => setLoadingMore(false));
  }

  const visible = useMemo(
    () =>
      (history ?? []).filter((e) => {
        const day = dayKey(e.generatedAt);
        if (fromDay && day < fromDay) return false;
        if (toDay && day > toDay) return false;
        return matchesSearch(
          [e.scope, describe(e).title, describe(e).category],
          query,
        );
      }),
    [history, query, fromDay, toDay],
  );
  const filtering = query.trim() !== "" || fromDay !== "" || toDay !== "";

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        <PageToolbar
          label="Report history"
          activeFilters={fromDay !== "" || toDay !== "" ? 1 : 0}
          onClearFilters={() => {
            setFromDay("");
            setToDay("");
          }}
          menus={[
            {
              id: "export",
              label: "Export",
              sections: [
                {
                  items: [
                    {
                      id: "csv",
                      label: "Export CSV",
                      icon: <DownloadIcon />,
                      disabledReason: visible.length === 0 ? "No reports are listed" : undefined,
                      onSelect: () =>
                        downloadCsv(
                          `${type.toLowerCase().replace(/\s+/g, "-")}-history-${localDateStamp()}.csv`,
                          reportHistoryCsv(visible),
                        ),
                    },
                  ],
                },
              ],
            },
          ]}
          filters={
            <>
              <Link to={backTo} className="ae-mb-btn" style={{ textDecoration: "none" }}>
                {backLabel}
              </Link>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search by date or category…"
              />
              <FilterSlot active={fromDay !== "" || toDay !== ""} label="Generated">
                <DatePicker aria-label="Generated from" value={fromDay} onChange={setFromDay} />
                <DatePicker aria-label="Generated to" value={toDay} onChange={setToDay} />
              </FilterSlot>
            </>
          }
        />
      </PageHeader>

      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      <Toast message={notice} onDismiss={() => setNotice(null)} variant="success" duration={8000} />
      {reverting && (
        <RevertAuditDialog
          entry={reverting}
          onClose={() => setReverting(null)}
          onDone={(message, id) => {
            setReverting(null);
            setNotice(message);
            loadStates([id]);
          }}
          onError={setError}
        />
      )}
      {!history ? (
        <TableSkeleton
          headers={["Report"]}
          label={`Loading ${type} history…`}
        />
      ) : history.length === 0 ? (
        <div className="ae-hist-empty">
          <span className="ae-hist-empty-icon">
            <HistoryIcon />
          </span>
          <h3>No generated {type} entries yet</h3>
          <p>
            Every {type} you open is listed here so you can download it again
            later.
          </p>
          <Link
            to={backTo}
            className="ae-btn ae-btn-primary"
            style={{ textDecoration: "none" }}
          >
            Go to {type}
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <p className="ae-hist-none">No matching entries.</p>
      ) : (
        <div className="ae-hist">
          <p className="ae-hist-count">
            {visible.length} {visible.length === 1 ? "report" : "reports"}
            {filtering && " match the filters"}
          </p>
          <div className="ae-table-scroll">
            <table className="ae-table ae-table--left">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Generated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    state={states[snapshotIdOf(entry) ?? -1]}
                    onRevert={isAdmin ? () => setReverting(entry) : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor !== null && (
            <button
              type="button"
              className="ae-btn ae-btn-solid"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load older reports"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/// The published audit a history row opens (its route carries `snapshot=<id>`);
/// null for an Audit Report that was only downloaded, not published.
function snapshotIdOf(entry: ReportHistoryEntry): number | null {
  if (entry.type !== "Audit Report") return null;
  const query = entry.route.split("?")[1] ?? "";
  const id = Number(new URLSearchParams(query).get("snapshot"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function HistoryRow({
  entry,
  state,
  onRevert,
}: {
  entry: ReportHistoryEntry;
  state?: AuditSnapshotState;
  onRevert?: () => void;
}) {
  const { title, detail, category } = describe(entry);
  const extra = [detail, category].filter(Boolean).join(" · ");
  const when = new Date(entry.generatedAt);
  return (
    <tr>
      <td>
        <strong>{title}</strong>
        {extra && <div style={{ fontSize: 12, opacity: 0.7 }}>{extra}</div>}
      </td>
      <td title={when.toLocaleString()}>
        {when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        {", "}
        {when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        {entry.generatedBy && (
          <div style={{ fontSize: 12, opacity: 0.7 }}>{entry.generatedBy.name}</div>
        )}
        {state?.reverted && (
          <div style={{ fontSize: 12, fontWeight: 600 }} title={state.revertedAt ? new Date(state.revertedAt).toLocaleString() : undefined}>
            Reverted
          </div>
        )}
      </td>
      <td style={{ textAlign: "right" }}>
        <div className="ae-hist-actions">
        {/* Still a navigation under the hood (the report page re-fetches live
            data for this exact date/range and auto-downloads - see the
            `history=1` handling in each report page), but presented as the
            one-click Download it functionally is. */}
        <Link
          to={entry.route}
          className="ae-btn ae-btn-secondary ae-btn-sm"
          style={{ textDecoration: "none" }}
        >
          <DownloadIcon />
          Download
        </Link>
        {onRevert && state?.canRevert && (
          <button
            type="button"
            className="ae-btn ae-btn-secondary ae-btn-sm"
            onClick={onRevert}
            title="Send this published audit back to unpublished so it can be re-audited"
          >
            Revert
          </button>
        )}
        </div>
      </td>
    </tr>
  );
}

/// Confirms reverting a published audit: the reason is kept in the change log.
function RevertAuditDialog({
  entry,
  onClose,
  onDone,
  onError,
}: {
  entry: ReportHistoryEntry;
  onClose: () => void;
  onDone: (message: string, id: number) => void;
  onError: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const id = snapshotIdOf(entry);
  if (id === null) return null;
  return (
    <Modal title={`Revert published audit - ${entry.scope}`} onClose={busy ? () => {} : onClose} width={460}>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>
        The counts this publish released go back to <strong>unpublished</strong>, so you can correct them and publish
        again. If it was used as the next day's opening stock, that is undone too. This entry stays in Audit History,
        marked Reverted. It cannot be done on a finished day - unlock it first.
      </p>
      <textarea
        className="ae-input"
        aria-label="Reason for reverting"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", height: "auto", padding: 8 }}
        placeholder="What was wrong with this audit?"
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
        <Button className="ae-btn-solid" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="ae-btn-solid"
          disabled={reason.trim().length < 5}
          loading={busy}
          loadingLabel="Reverting…"
          onClick={() => {
            setBusy(true);
            revertAuditSnapshot(id, reason.trim())
              .then((r) =>
                onDone(
                  r.reverted > 0
                    ? `Audit reverted: ${r.reverted} count${r.reverted === 1 ? "" : "s"} unpublished. Open Audit to re-audit and publish again.`
                    : "Marked as reverted. Its counts had already been edited since, so there was nothing left to unpublish.",
                  id,
                ),
              )
              .catch((e: unknown) => {
                setBusy(false);
                onError(e instanceof Error ? e.message : "Could not revert the audit.");
                onClose();
              });
          }}
        >
          Revert audit
        </Button>
      </div>
    </Modal>
  );
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
