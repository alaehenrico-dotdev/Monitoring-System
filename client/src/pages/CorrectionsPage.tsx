import { useCallback, useEffect, useState } from "react";
import {
  approveCorrection,
  listCorrections,
  rejectCorrection,
  type Correction,
  type CorrectionStatus,
} from "../api/ops";
import { useAuth } from "../context/AuthContext";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui";
import { Modal } from "../components/Modal";
import { Pager } from "../components/Pager";
import { usePagedList } from "../hooks/usePagedList";
import { Toast } from "../components/Toast";
import { InlineLoading } from "../components/Spinner";
import { colors } from "../theme";

const FILTERS: { key: CorrectionStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
];

const TABLE_LABEL: Record<string, string> = {
  daily_online_stock: "Online entry",
  daily_offline_stock: "Offline entry",
  manual_counts: "Manual count",
};

const TONE: Record<CorrectionStatus, string> = { PENDING: "progress", APPROVED: "done", REJECTED: "bad" };

/// Corrections: a figure that should not be silently overwritten is requested
/// here with a reason, kept with its before/after values, and applied only when
/// an admin approves it. Admins see every request; everyone else sees their own.
export function CorrectionsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPERVISOR_ADMIN";
  const [filter, setFilter] = useState<CorrectionStatus | "ALL">("PENDING");
  // Fresh function per status, so switching the tab starts again from page 1.
  const fetchPage = useCallback(
    (offset: number, limit: number) => listCorrections(filter === "ALL" ? undefined : filter, offset, limit),
    [filter],
  );
  const pager = usePagedList(fetchPage, 10);
  const rows = pager.data?.items ?? null;
  const [error, setError] = useState<string | null>(null);
  // The request in flight: which one, and whether it is being approved or rejected.
  const [busyOn, setBusyOn] = useState<{ id: number; kind: "approve" | "reject" } | null>(null);
  const [rejecting, setRejecting] = useState<Correction | null>(null);
  const [note, setNote] = useState("");
  const realtimeVersion = useRealtimeVersion();

  // Someone else's change arrived: re-read the page on screen (not page 1).
  const { reload } = pager;
  useEffect(() => {
    if (realtimeVersion > 0) reload();
  }, [realtimeVersion, reload]);

  /// One decision at a time. Returns whether it worked, so the reject dialog
  /// can stay open (with its own busy state) until it has.
  async function decide(c: Correction, kind: "approve" | "reject", fn: () => Promise<unknown>): Promise<boolean> {
    if (busyOn) return false;
    setBusyOn({ id: c.id, kind });
    setError(null);
    try {
      await fn();
      pager.reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusyOn(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Corrections"
        subtitle="Requests to change a recorded figure - with the reason, the before/after values and who approved it."
      />
      <div className="ae-subtabs" role="tablist" aria-label="Correction status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={f.key === filter}
            className="ae-subtab"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: 1280, margin: "0 auto" }}>
        {!rows ? (
          pager.error ? <p role="alert" style={{ color: colors.danger }}>{pager.error}</p> : <InlineLoading label="Loading…" />
        ) : rows.length === 0 ? (
          <p style={{ color: colors.subtleInk }}>
            No {filter === "ALL" ? "" : filter.toLowerCase() + " "}corrections.
            {filter === "PENDING" && " Request one from a cell's history (right-click a cell > View history)."}
          </p>
        ) : (
          <div className="ae-panel">
            {rows.map((c) => (
              <div key={c.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.border}`, fontSize: 13, color: colors.ink }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className={`ae-dash-chip ae-dash-chip--${TONE[c.status]}`}>{c.status.toLowerCase()}</span>
                  <strong>
                    {TABLE_LABEL[c.tableName] ?? c.tableName} #{c.recordId} · {c.field}
                  </strong>
                  <span>
                    {c.beforeValue} → <strong>{c.proposedValue}</strong>
                  </span>
                  <span style={{ flex: 1 }} />
                  {isAdmin && c.status === "PENDING" && (
                    <>
                      <Button
                        className="ae-btn-solid"
                        size="sm"
                        disabled={busyOn !== null}
                        loading={busyOn?.id === c.id && busyOn.kind === "approve"}
                        loadingLabel="Approving…"
                        onClick={() => void decide(c, "approve", () => approveCorrection(c.id))}
                      >
                        Approve
                      </Button>
                      <Button
                        className="ae-btn-solid"
                        size="sm"
                        disabled={busyOn !== null}
                        onClick={() => {
                          setNote("");
                          setRejecting(c);
                        }}
                      >
                        Reject…
                      </Button>
                    </>
                  )}
                </div>
                <div style={{ color: colors.subtleInk, marginTop: 4 }}>Reason: {c.reason}</div>
                <ol style={{ margin: "6px 0 0", paddingLeft: 18, color: colors.subtleInk, fontSize: 12.5 }}>
                  {c.events.map((ev) => (
                    <li key={ev.id}>
                      {ev.event.toLowerCase()} · {ev.by?.name ?? "removed user"} · {new Date(ev.at).toLocaleString()}
                      {ev.note && ev.event !== "REQUESTED" ? ` - ${ev.note}` : ""}
                    </li>
                  ))}
                </ol>
                {c.status === "APPROVED" && c.appliedBefore !== null && c.appliedBefore !== c.beforeValue && (
                  <div style={{ color: colors.subtleInk, fontSize: 12.5, marginTop: 4 }}>
                    The figure had changed to {c.appliedBefore} by the time this was approved.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <Pager page={pager.page} pageSize={pager.pageSize} total={pager.total} onPage={pager.goToPage} onPageSize={pager.setPageSize} loading={pager.loading} label="Correction pages" />
      </div>

      {rejecting && (
        <Modal title="Reject correction" onClose={busyOn ? () => {} : () => setRejecting(null)} width={420}>
          <textarea
            className="ae-input"
            aria-label="Reason for rejecting"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this being rejected?"
            style={{ width: "100%", boxSizing: "border-box", height: "auto", padding: 8 }}
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <Button className="ae-btn-solid" disabled={busyOn !== null} onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              className="ae-btn-solid"
              disabled={note.trim().length < 3}
              loading={busyOn?.kind === "reject"}
              loadingLabel="Rejecting…"
              onClick={() => {
                const target = rejecting;
                void decide(target, "reject", () => rejectCorrection(target.id, note.trim())).then((ok) => ok && setRejecting(null));
              }}
            >
              Reject
            </Button>
          </div>
        </Modal>
      )}
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </div>
  );
}
