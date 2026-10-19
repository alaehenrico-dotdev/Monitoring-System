import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  closeDay,
  getActionQueue,
  getCloseReadiness,
  listChangeLogArchive,
  listClientErrors,
  listDayClosures,
  runChangeLogArchive,
  unlockDay,
  type ActionQueue,
  type CloseReadiness,
  type DayClosure,
  type EntryLocation,
  type QueueItem,
} from "../api/ops";
import type { Shift } from "../types";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui";
import { Modal } from "../components/Modal";
import { Pager } from "../components/Pager";
import { usePagedList } from "../hooks/usePagedList";
import { Toast } from "../components/Toast";
import { MonthCloseTab } from "./MonthCloseTab";
import { InlineLoading } from "../components/Spinner";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { colors } from "../theme";

type Tab = "queue" | "closing" | "months" | "errors" | "archive";

const TABS: { key: Tab; label: string }[] = [
  { key: "queue", label: "Needs attention" },
  { key: "closing", label: "Day closing" },
  { key: "months", label: "Month closing" },
  { key: "errors", label: "Client errors" },
  { key: "archive", label: "Change-log archive" },
];

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  // Wraps so a row's status, text and buttons stack on a narrow screen
  // instead of squeezing the text or pushing a button off the edge.
  flexWrap: "wrap",
  gap: 12,
  padding: "10px 16px",
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 13,
  color: colors.ink,
};

const KIND_LABEL: Record<QueueItem["kind"], string> = {
  "negative-open": "Below zero",
  variance: "Variance",
  "low-stock": "Stock",
  "missing-entry": "Missing entry",
  backup: "Backup",
  correction: "Correction",
};

const SHIFTS: Shift[] = ["MORNING", "NIGHT"];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/// One place for everything an admin has to look at: what needs attention
/// (variances, stock alerts, missing entries, backups, corrections), closing
/// finished days, errors reported from encoders' browsers, and the change-log
/// archive. Each queue row links to the record that needs fixing.
export function AdminQueuePage() {
  const [tab, setTab] = useState<Tab>("queue");
  return (
    <div>
      <PageHeader
        title="Admin queue"
        subtitle="Everything that needs an admin's attention, in one place."
      />
      <div className="ae-subtabs" role="tablist" aria-label="Admin queue sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className="ae-subtab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ width: "100%", maxWidth: 1280, margin: "0 auto" }}>
        {tab === "queue" && <QueueTab />}
        {tab === "closing" && <ClosingTab />}
        {tab === "months" && <MonthCloseTab />}
        {tab === "errors" && <ErrorsTab />}
        {tab === "archive" && <ArchiveTab />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- queue */


function QueueTab() {
  const [queue, setQueue] = useState<ActionQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const realtimeVersion = useRealtimeVersion();

  useEffect(() => {
    let cancelled = false;
    getActionQueue()
      .then((q) => !cancelled && setQueue(q))
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load the queue.")));
    return () => {
      cancelled = true;
    };
  }, [realtimeVersion]);

  // The queue arrives whole (it is already capped server-side), so it is paged
  // here. Clamped, because a refresh can leave fewer items than the page needs.
  const total = queue?.items.length ?? 0;
  const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const visible = useMemo(
    () => queue?.items.slice((current - 1) * pageSize, current * pageSize) ?? [],
    [queue, current, pageSize],
  );

  if (error && !queue) return <p role="alert" style={{ color: colors.danger }}>{error}</p>;
  if (!queue) return <InlineLoading label="Loading the queue…" />;

  const c = queue.counts;
  const summary: [string, number][] = [
    ["Unexplained variances", c.variance],
    ["Stock alerts", c.lowStock],
    ["Missing entries", c.missingEntries],
    ["Backup issues", c.backup],
    ["Corrections to review", c.corrections],
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 12 }}>
        {summary.map(([label, n]) => (
          <span key={label} className={`ae-dash-chip ae-dash-chip--${n === 0 ? "done" : "bad"}`}>
            {label}: {n}
          </span>
        ))}
      </div>
      {queue.items.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>Nothing needs attention right now.</p>
      ) : (
        <>
          <div className="ae-panel">
            {visible.map((item) => (
              <div key={item.id} style={rowStyle}>
                <span
                  className={`ae-dash-chip ae-dash-chip--${item.severity === "high" ? "bad" : "progress"}`}
                  style={{ flexShrink: 0 }}
                >
                  {KIND_LABEL[item.kind]}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  <div style={{ color: colors.subtleInk, fontSize: 12.5 }}>{item.detail}</div>
                </span>
                <Link to={item.link} className="ae-btn ae-btn-solid ae-btn-sm" style={{ textDecoration: "none" }}>
                  Open
                </Link>
              </div>
            ))}
          </div>
          <Pager
            page={current}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            label="Queue pages"
          />
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- closing */

function ClosingTab() {
  const [date, setDate] = useState(today());
  const [closures, setClosures] = useState<DayClosure[] | null>(null);
  const [readiness, setReadiness] = useState<Record<Shift, CloseReadiness | null>>({ MORNING: null, NIGHT: null });
  const [error, setError] = useState<string | null>(null);
  // Which shift's close/unlock request is in flight (one at a time).
  const [busyShift, setBusyShift] = useState<Shift | null>(null);
  const busy = busyShift !== null;
  const [unlocking, setUnlocking] = useState<Shift | null>(null);
  // Which entry page to unlock: one of them, or both ("ALL").
  const [unlockScope, setUnlockScope] = useState<EntryLocation | "ALL">("ALL");
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    listDayClosures()
      .then((rows) => !cancelled && setClosures(rows))
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load closed days.")));
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(SHIFTS.map((s) => getCloseReadiness(date, s)))
      .then(([m, n]) => !cancelled && setReadiness({ MORNING: m, NIGHT: n }))
      .catch(() => !cancelled && setReadiness({ MORNING: null, NIGHT: null }));
    return () => {
      cancelled = true;
    };
  }, [date, version]);

  const closureOf = (s: Shift) => closures?.find((c) => c.entryDate.slice(0, 10) === date && c.shift === s);
  // Each entry page is finished by its own encoder, so a shift can be finished
  // on one page only. "Closed" means both are.
  const isClosed = (s: Shift) => closureOf(s)?.isClosed ?? false;
  const lockedPages = (s: Shift) => {
    const c = closureOf(s);
    return { online: !!c?.onlineLocked, offline: !!c?.offlineLocked };
  };

  /// Runs one close/unlock for a shift. Returns whether it worked, so a dialog
  /// can stay open (showing its own busy state) until then.
  async function act(shift: Shift, fn: () => Promise<unknown>): Promise<boolean> {
    if (busyShift !== null) return false;
    setBusyShift(shift);
    setError(null);
    try {
      await fn();
      refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e, "That did not work."));
      return false;
    } finally {
      setBusyShift(null);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: colors.subtleInk, marginTop: 0 }}>
        A day can be closed once its counts are published and its Daily Report has been exported. Closed days refuse
        edits; a change then needs an unlock (with a reason) or an approved correction.
      </p>
      <label style={{ fontSize: 12, fontWeight: 600, color: colors.subtleInk, display: "block", marginBottom: 4 }}>
        Date
        <input type="date" className="ae-input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ marginLeft: 8 }} />
      </label>

      <div className="ae-panel" style={{ marginTop: 12 }}>
        {SHIFTS.map((s) => {
          const closed = isClosed(s);
          const pages = lockedPages(s);
          const anyLocked = pages.online || pages.offline;
          const r = readiness[s];
          return (
            <div key={s} style={{ ...rowStyle, alignItems: "flex-start" }}>
              <span style={{ width: 80, fontWeight: 600 }}>{s === "MORNING" ? "Morning" : "Night"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {closed ? (
                  <span className="ae-dash-chip ae-dash-chip--done">Closed</span>
                ) : anyLocked ? (
                  <span className="ae-dash-chip ae-dash-chip--progress">
                    {pages.online ? "Online finished" : "Offline finished"} · other page open
                  </span>
                ) : r?.ready ? (
                  <span className="ae-dash-chip ae-dash-chip--progress">Ready to close</span>
                ) : (
                  <span className="ae-dash-chip ae-dash-chip--idle">Not ready</span>
                )}
                {!closed && !anyLocked && r && !r.ready && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: colors.subtleInk, fontSize: 12.5 }}>
                    {r.problems.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                )}
              </span>
              {anyLocked && (
                <Button className="ae-btn-solid" size="sm" disabled={busy} onClick={() => { setReason(""); setUnlockScope("ALL"); setUnlocking(s); }}>
                  Unlock…
                </Button>
              )}
              {!closed && (
                <Button
                  className="ae-btn-solid"
                  size="sm"
                  disabled={busy || !r?.ready}
                  loading={busyShift === s}
                  loadingLabel="Closing…"
                  onClick={() => void act(s, () => closeDay(date, s))}
                >
                  Close day
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>Recent closures</h3>
      {!closures ? (
        <InlineLoading label="Loading…" />
      ) : closures.length === 0 ? (
        <p style={{ color: colors.subtleInk, fontSize: 13 }}>No day has been closed yet.</p>
      ) : (
        <div className="ae-panel">
          {closures.slice(0, 30).map((c) => (
            <div key={c.id} style={rowStyle}>
              <span style={{ width: 110 }}>{c.entryDate.slice(0, 10)}</span>
              <span style={{ width: 70 }}>{c.shift === "MORNING" ? "Morning" : "Night"}</span>
              <span style={{ flex: 1, minWidth: 0, color: colors.subtleInk, fontSize: 12.5 }}>
                {c.isClosed
                  ? `Closed ${new Date(c.closedAt).toLocaleString()}${c.closedBy ? ` by ${c.closedBy.name}` : ""}`
                  : c.onlineLocked || c.offlineLocked
                    ? `${c.onlineLocked ? "Online" : "Offline"} finished ${new Date(c.closedAt).toLocaleString()}${c.closedBy ? ` by ${c.closedBy.name}` : ""}`
                    : `Unlocked ${c.unlockedAt ? new Date(c.unlockedAt).toLocaleString() : ""}${c.unlockedBy ? ` by ${c.unlockedBy.name}` : ""}: ${c.unlockReason ?? ""}`}
              </span>
              <span className={`ae-dash-chip ae-dash-chip--${c.isClosed ? "done" : c.onlineLocked || c.offlineLocked ? "progress" : "idle"}`}>
                {c.isClosed ? "Closed" : c.onlineLocked || c.offlineLocked ? "Partly" : "Open"}
              </span>
            </div>
          ))}
        </div>
      )}

      {unlocking && (
        <Modal title={`Unlock ${date} - ${unlocking === "MORNING" ? "Morning" : "Night"}`} onClose={busy ? () => {} : () => setUnlocking(null)} width={440}>
          <p style={{ margin: "0 0 10px", fontSize: 13 }}>
            Unlocking lets encoders change this day's numbers again. The reason is kept in the change log.
          </p>
          {(() => {
            const pages = lockedPages(unlocking);
            return (
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, margin: "0 0 10px" }}>
                Unlock
                <select
                  className="ae-input"
                  aria-label="Which page to unlock"
                  value={unlockScope}
                  onChange={(e) => setUnlockScope(e.target.value as EntryLocation | "ALL")}
                  style={{ marginLeft: 8 }}
                >
                  <option value="ALL">Both pages</option>
                  {pages.online && <option value="ONLINE">Online only</option>}
                  {pages.offline && <option value="OFFLINE">Offline only</option>}
                </select>
              </label>
            );
          })()}
          <textarea
            className="ae-input"
            aria-label="Reason for unlocking"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", height: "auto", padding: 8 }}
            placeholder="Why does this day need to be reopened?"
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <Button className="ae-btn-solid" disabled={busy} onClick={() => setUnlocking(null)}>Cancel</Button>
            <Button
              className="ae-btn-solid"
              disabled={reason.trim().length < 5}
              loading={busy}
              loadingLabel="Unlocking…"
              onClick={() => {
                const shift = unlocking;
                // Stays open while it runs; closes only once it has worked.
                void act(shift, () => unlockDay(date, shift, reason.trim(), unlockScope === "ALL" ? undefined : unlockScope)).then((ok) => ok && setUnlocking(null));
              }}
            >
              Unlock day
            </Button>
          </div>
        </Modal>
      )}
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </>
  );
}

/* ---------------------------------------------------------------- errors */

function ErrorsTab() {
  const list = usePagedList(listClientErrors, 10);
  const [open, setOpen] = useState<number | null>(null);

  if (list.error && !list.data) return <p role="alert" style={{ color: colors.danger }}>{list.error}</p>;
  if (!list.data) return <InlineLoading label="Loading errors…" />;
  const rows = list.data.items;
  if (list.total === 0) return <p style={{ color: colors.subtleInk }}>No browser errors have been reported.</p>;

  return (
    <>
      <div className="ae-panel">
        {rows.map((r) => (
          <div key={r.id} style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <button
              type="button"
              onClick={() => setOpen(open === r.id ? null : r.id)}
              aria-expanded={open === r.id}
              style={{ all: "unset", cursor: "pointer", display: "block" }}
            >
              <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.message}</div>
              <div style={{ color: colors.subtleInk, fontSize: 12.5 }}>
                {new Date(r.createdAt).toLocaleString()} · {r.page} · {r.user?.name ?? "signed out"} · v{r.appVersion ?? "?"} · {r.source}
              </div>
            </button>
            {open === r.id && (
              <pre style={{ margin: 0, fontSize: 11.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: colors.subtleInk }}>
                {r.stack ?? "No stack trace."}
                {r.userAgent ? `\n\n${r.userAgent}` : ""}
              </pre>
            )}
          </div>
        ))}
      </div>
      <Pager page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.goToPage} onPageSize={list.setPageSize} loading={list.loading} label="Client error pages" />
    </>
  );
}

/* --------------------------------------------------------------- archive */

function ArchiveTab() {
  const pager = usePagedList(listChangeLogArchive, 10);
  const [months, setMonths] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The server's retention period is the starting value; after that it is the
  // admin's to change.
  const retention = pager.data?.retentionMonths;
  const shownMonths = months ?? (retention && retention > 0 ? retention : 12);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await runChangeLogArchive(shownMonths);
      setMessage(`Archived ${r.moved.toLocaleString()} change-log entries older than ${shownMonths} months.`);
      pager.reload();
    } catch (e) {
      setError(errorMessage(e, "Archiving failed."));
    } finally {
      setBusy(false);
    }
  }

  const rows = pager.data?.items ?? null;

  return (
    <>
      <p style={{ fontSize: 13, color: colors.subtleInk, marginTop: 0 }}>
        Old change-log entries are moved here nightly so the Change Log page stays fast. Nothing is deleted. Entries tied to a CSV import stay in the live log.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 13 }}>
          Archive entries older than{" "}
          <input
            type="number" onWheel={(e) => e.currentTarget.blur()}
            min={1}
            max={120}
            className="ae-input"
            value={shownMonths}
            onChange={(e) => setMonths(Math.min(120, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 70 }}
          />{" "}
          months
        </label>
        <Button className="ae-btn-solid" size="sm" loading={busy} loadingLabel="Archiving…" onClick={() => void run()}>
          Archive now
        </Button>
        <span style={{ fontSize: 12.5, color: colors.subtleInk }}>{pager.total.toLocaleString()} entries in the archive</span>
      </div>
      {!rows ? (
        pager.error ? <p role="alert" style={{ color: colors.danger }}>{pager.error}</p> : <InlineLoading label="Loading…" />
      ) : pager.total === 0 ? (
        <p style={{ color: colors.subtleInk, fontSize: 13 }}>The archive is empty.</p>
      ) : (
        <>
          <div className="ae-panel">
            {rows.map((r) => (
              <div key={r.id} style={rowStyle}>
                <span style={{ width: 150 }}>{new Date(r.changedAt).toLocaleString()}</span>
                <span style={{ width: 70 }}>{r.action}</span>
                <span style={{ flex: 1 }}>{r.tableName} #{r.recordId}</span>
              </div>
            ))}
          </div>
          <Pager page={pager.page} pageSize={pager.pageSize} total={pager.total} onPage={pager.goToPage} onPageSize={pager.setPageSize} loading={pager.loading} label="Archive pages" />
        </>
      )}
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </>
  );
}
