import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  getSheetPublishes,
  getSheetVersion,
  getSheetVersions,
  restoreSheetVersion,
  type PublishEvent,
  type SheetKind,
  type SheetVersion,
  type SheetVersionRows,
} from "../api/changeLog";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { parseExtraColumnKey } from "../hooks/useExtraColumns";
import type { Shift } from "../types";
import { colors } from "../theme";
import { formatDateDisplay } from "../utils/dateFormat";
import { shiftWithWord } from "../utils/shift";
import { Spinner } from "./Spinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { useBusyAction } from "../hooks/useBusyAction";

type Tab = "versions" | "publishes";

const SHEET_LABEL: Record<SheetKind, string> = { online: "Online", offline: "Offline", manual: "Manual Count" };

/// "stocksIn" -> "Stocks in": the sheet's own field names, made readable.
function humanize(key: string): string {
  const extra = parseExtraColumnKey(key);
  if (extra) return `${humanize(extra.mainKey)} +${extra.slot}`;
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function stamp(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/// What is shown on the right: one version (what it changed) or one publish
/// (the sheet as it was published).
type Selection = { key: string; upTo: number; after: number; title: string };

/**
 * Google-Sheets-style "Version history" for one sheet and shift, opened from
 * the View menu (Supervisor/Admin only - the data comes from the change log).
 * Versions are stretches of edits by one person; picking one shows the sheet
 * as it stood when that stretch ended, with the cells it changed highlighted.
 * The Manual Count sheet also gets a Publish history tab: each publish, who
 * made it, how many counts it approved, and the counts as published.
 * Read-only - nothing here changes the sheet.
 */
export function VersionHistoryPanel({
  sheet,
  date,
  shift,
  onClose,
}: {
  sheet: SheetKind;
  date: string;
  shift: Shift;
  onClose: () => void;
}) {
  const realtimeVersion = useRealtimeVersion();
  const [tab, setTab] = useState<Tab>("versions");
  const [versions, setVersions] = useState<SheetVersion[] | null>(null);
  const [publishes, setPublishes] = useState<PublishEvent[] | null>(null);
  const [picked, setSelected] = useState<Selection | null>(null);
  // The loaded rows, tagged with what they were loaded for, so a stale response or a
  // new selection never shows the previous version's rows.
  const [loaded, setLoaded] = useState<{ key: string; data: SheetVersionRows } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const restore = useBusyAction();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    // A failed load must not outlive the next successful one (a realtime
    // refetch) - it would hide the data it failed to get.
    getSheetVersions(sheet, date, shift)
      .then((r) => {
        if (!live) return;
        setVersions(r.versions);
        setError(null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load version history"));
    if (sheet === "manual") {
      getSheetPublishes(date, shift)
        .then((r) => live && setPublishes(r.publishes))
        .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load publish history"));
    }
    return () => {
      live = false;
    };
  }, [sheet, date, shift, realtimeVersion]);

  // Until one is picked, the newest version is open, like Sheets does.
  const newest = versions && versions.length > 0 ? versions[0] : null;
  const selected: Selection | null =
    picked ?? (newest ? { key: `v${newest.upTo}`, upTo: newest.upTo, after: newest.after, title: `Version of ${stamp(newest.endedAt)}` } : null);
  const selectedKey = selected ? `${selected.key}:${selected.upTo}:${selected.after}` : null;

  useEffect(() => {
    if (!selected || !selectedKey) return;
    let live = true;
    getSheetVersion(sheet, date, shift, selected.upTo, selected.after)
      .then((r) => {
        if (!live) return;
        setLoaded({ key: selectedKey, data: r });
        setError(null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load that version"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, date, shift, selectedKey]);
  const view = loaded && loaded.key === selectedKey ? loaded.data : null;

  const columns = useMemo(() => {
    const seen: string[] = [];
    for (const row of view?.rows ?? []) for (const k of Object.keys(row.values)) if (!seen.includes(k)) seen.push(k);
    // Added columns sit right after the column they break down, the way the
    // entry grid draws them, rather than trailing the whole sheet.
    const base = seen.filter((k) => !parseExtraColumnKey(k));
    return base.flatMap((k) => [
      k,
      ...seen
        .filter((x) => parseExtraColumnKey(x)?.mainKey === k)
        .sort((a, b) => parseExtraColumnKey(a)!.slot - parseExtraColumnKey(b)!.slot),
    ]);
  }, [view]);

  const loading = tab === "versions" ? versions === null : publishes === null;

  // Only a version of the Online/Offline sheet can be applied: a Manual Count
  // carries a publish state, and a publish is a snapshot to read, not to redo.
  // The newest version already is the sheet as it stands.
  const canRestore = sheet !== "manual" && !!selected && selected.key.startsWith("v") && !!view && selected.upTo !== newest?.upTo;

  async function applyVersion() {
    if (!selected || sheet === "manual") return;
    const upTo = selected.upTo;
    await restore.run(async () => {
      try {
        const r = await restoreSheetVersion(sheet, date, shift, upTo);
        setConfirmingRestore(false);
        setError(null);
        setNotice(
          `Restored: ${r.restored} product${r.restored === 1 ? "" : "s"} written back${r.held ? `. ${r.held} product${r.held === 1 ? "'s" : "s'"} transfer change${r.held === 1 ? " was" : "s were"} NOT applied: the other page is finished, so it went to an admin for approval (everything else was restored)` : ""}${r.skipped ? `. ${r.skipped} deactivated product${r.skipped === 1 ? " was" : "s were"} left as they are` : ""}. The restore is listed above as a new version.`,
        );
        setSelected(null);
      } catch (e) {
        setConfirmingRestore(false);
        setNotice(null);
        setError(e instanceof Error ? e.message : "Could not restore that version");
      }
    });
  }

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(12, 12, 12, 0.45)", display: "flex", justifyContent: "flex-end" }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Version history"
        onClick={(e) => e.stopPropagation()}
        style={{ background: colors.paper, color: colors.ink, display: "flex", flexDirection: "column", width: "min(1100px, 100%)", height: "100%", boxShadow: "-8px 0 24px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Version history</strong>
            <div style={{ color: colors.subtleInk, fontSize: 13 }}>
              {SHEET_LABEL[sheet]} - {formatDateDisplay(date)} - {shiftWithWord(shift)}
            </div>
          </div>
          <button type="button" className="ae-btn" onClick={onClose} aria-label="Close version history">
            Close
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0, flexWrap: "wrap-reverse" }}>
          {/* The sheet as it stood in the selected version. */}
          <div className="ae-vh-scroll" style={{ flex: "1 1 480px", overflow: "auto", padding: 16, minWidth: 0 }}>
            {error && <p style={{ color: colors.danger }}>{error}</p>}
            {notice && (
              <p role="status" style={{ color: colors.ink, margin: "0 0 8px" }}>
                {notice}
              </p>
            )}
            {selected && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 8px" }}>
                <h3 style={{ margin: 0, flex: 1, minWidth: 0 }}>{selected.title}</h3>
                {sheet !== "manual" && selected.key.startsWith("v") && (
                  <button
                    type="button"
                    className="ae-btn ae-btn-primary"
                    disabled={!canRestore}
                    title={canRestore ? "Write this version's figures back onto the sheet" : selected.upTo === newest?.upTo ? "This is already the latest version" : "Loading this version…"}
                    onClick={() => setConfirmingRestore(true)}
                  >
                    Restore this version
                  </button>
                )}
              </div>
            )}
            {selected && !view && !error && <Spinner />}
            {view && view.rows.length === 0 && <p style={{ color: colors.subtleInk }}>The sheet was empty at this point.</p>}
            {view && view.rows.length > 0 && (
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={cell(true)}>Product</th>
                    {columns.map((c) => (
                      <th key={c} style={{ ...cell(true), textAlign: "right" }}>
                        {humanize(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.recordId}>
                      <td style={cell()}>
                        {r.name ?? `#${r.productId ?? r.recordId}`}
                        {r.sku && <span style={{ color: colors.subtleInk }}> {r.sku}</span>}
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c}
                          title={r.changed.includes(c) ? "Changed in this version" : undefined}
                          style={{ ...cell(), textAlign: "right", ...(r.changed.includes(c) ? { background: colors.warningBg, color: colors.warningText, fontWeight: 600 } : {}) }}
                        >
                          {r.values[c] === null || r.values[c] === undefined ? "" : String(r.values[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* The list: versions, and publishes on the Manual Count sheet. */}
          <aside className="ae-vh-scroll" style={{ flex: "0 0 320px", maxWidth: "100%", borderLeft: `1px solid ${colors.border}`, overflow: "auto", background: colors.surface }}>
            {sheet === "manual" && (
              <div role="tablist" style={{ display: "flex", borderBottom: `1px solid ${colors.border}` }}>
                {(["versions", "publishes"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    style={{ flex: 1, padding: "10px 8px", background: "none", border: 0, cursor: "pointer", color: colors.ink, fontWeight: tab === t ? 700 : 400, borderBottom: tab === t ? `2px solid ${colors.gold}` : "2px solid transparent" }}
                  >
                    {t === "versions" ? "Versions" : "Publish history"}
                  </button>
                ))}
              </div>
            )}
            {loading && !error && <div style={{ padding: 16 }}><Spinner /></div>}
            {tab === "versions" && versions && versions.length === 0 && <Empty text="No edits have been recorded for this sheet yet." />}
            {tab === "versions" &&
              versions?.map((v) => {
                const key = `v${v.upTo}`;
                return (
                  <Entry
                    key={key}
                    active={selected?.key === key}
                    title={stamp(v.endedAt)}
                    lines={[v.user?.name ?? "System", `${v.changes} edit${v.changes === 1 ? "" : "s"} to ${v.products} product${v.products === 1 ? "" : "s"}`]}
                    onSelect={() => setSelected({ key, upTo: v.upTo, after: v.after, title: `Version of ${stamp(v.endedAt)}` })}
                  />
                );
              })}
            {tab === "publishes" && publishes && publishes.length === 0 && <Empty text="This sheet has not been published yet." />}
            {tab === "publishes" &&
              publishes?.map((p) => {
                const key = `p${p.publishedAt}`;
                return (
                  <Entry
                    key={key}
                    active={selected?.key === key}
                    title={`Published ${stamp(p.publishedAt)}`}
                    lines={[p.user?.name ?? "System", `${p.counts} count${p.counts === 1 ? "" : "s"}${p.appliedToOpening ? " - used as next day's opening stock" : ""}`]}
                    onSelect={() => setSelected({ key, upTo: p.upTo, after: 0, title: `Sheet as published ${stamp(p.publishedAt)}` })}
                  />
                );
              })}
          </aside>
        </div>
      </div>
      {confirmingRestore && selected && (
        <ConfirmDialog
          title="Restore this version?"
          confirmLabel="Restore"
          busy={restore.busy}
          onConfirm={() => void applyVersion()}
          onCancel={() => setConfirmingRestore(false)}
        >
          <p style={{ margin: "0 0 8px" }}>
            The {SHEET_LABEL[sheet]} sheet for {formatDateDisplay(date)} ({shiftWithWord(shift)}) will be put back the way it was in {selected.title.toLowerCase()}.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Every product&apos;s figures and added columns are replaced; products added since are set to zero.</li>
            <li>It is saved as new edits under your name. Nothing is erased: the current figures stay in this history and can be restored again.</li>
            <li>A finished (locked) page cannot be restored until an admin unlocks it.</li>
            <li>Transfers between Online and Offline are mirrored onto the other page, as with any save; if that page is finished, the change waits for an admin.</li>
          </ul>
        </ConfirmDialog>
      )}
    </div>,
    document.body,
  );
}

function cell(head = false): React.CSSProperties {
  return { padding: "4px 8px", border: `1px solid ${colors.border}`, textAlign: "left", whiteSpace: "nowrap", ...(head ? { background: colors.paperAlt, position: "sticky", top: 0 } : {}) };
}

function Empty({ text }: { text: string }) {
  return <p style={{ padding: 16, color: colors.subtleInk, margin: 0 }}>{text}</p>;
}

function Entry({ title, lines, active, onSelect }: { title: string; lines: string[]; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 16px", background: active ? colors.paperAlt : "none", border: 0, borderBottom: `1px solid ${colors.border}`, borderLeft: active ? `3px solid ${colors.gold}` : "3px solid transparent", color: colors.ink, cursor: "pointer" }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      {lines.map((l) => (
        <div key={l} style={{ color: colors.subtleInk, fontSize: 13 }}>
          {l}
        </div>
      ))}
    </button>
  );
}
