import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/http";
import { editMySubmission, getMySubmission, saveMyLines, submitMySubmission, type SubmissionStatus } from "../api/countSubmissions";
import type { SaveState } from "../components/SaveStatus";
import type { Shift } from "../types";
import {
  clearStored,
  draftFromServer,
  isEmptyLine,
  loadStored,
  mergeServerWithLocal,
  sameLine,
  saveStored,
  storageKeyFor,
  toDraftLine,
  type Draft,
  type Line,
  EMPTY_LINE,
} from "../utils/auditorDraft";

/// How long after the last keystroke the changed lines go to the server, how soon a failed save is
/// tried again, and how long after a change the browser backup is written.
const SYNC_DELAY_MS = 1200;
const RETRY_MS = 15_000;
const BACKUP_DELAY_MS = 400;

export interface SubmissionMeta {
  status: SubmissionStatus;
  submittedAt: string | null;
  /// Set while an admin has sent the count back for a recount.
  reopenedAt: string | null;
  reopenReason: string | null;
}

const FRESH: SubmissionMeta = { status: "DRAFT", submittedAt: null, reopenedAt: null, reopenReason: null };

/**
 * The auditor's count for one sheet: the lines typed on this phone, kept in two places - the browser
 * (a backup, because a warehouse loses signal and a screen locks) and the server (where the admin
 * sees it). A change reaches the server shortly after the last keystroke; one that cannot is kept and
 * retried, and shown as such. The server's copy is read on load, when the app comes back to the
 * front and whenever `refreshKey` changes (the realtime tick), so an admin reopening the count shows
 * up without a reload - and lines typed here and not yet sent always win over what is read back.
 *
 * Once submitted the sheet is read-only until an admin reopens it.
 */
export function useAuditorDraft(userId: number | undefined, date: string, shift: Shift, refreshKey: unknown) {
  const key = userId === undefined ? null : storageKeyFor(userId, date, shift);
  const [initial] = useState(() => (key ? loadStored(key) : { draft: {} as Draft, unsynced: [] as string[] }));
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [meta, setMeta] = useState<SubmissionMeta>(FRESH);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);

  // Keys changed here and not yet confirmed saved. A ref (read by timers and callbacks that must not
  // change identity), with its size mirrored into state so effects and the screen can follow it.
  const unsynced = useRef<Set<string>>(new Set(initial.unsynced));
  const [pending, setPending] = useState(initial.unsynced.length);
  const draftRef = useRef(draft);
  const readOnlyRef = useRef(false);
  const flushing = useRef<Promise<void> | null>(null);
  /// Counts finished saves. A read of the server's copy that began before a save finished may come back
  /// without that save in it; merging it would make a line that IS saved vanish from the screen.
  const saveEpoch = useRef(0);
  /// Why the last save failed, when the server answered (an error it reports), so Submit can say so
  /// instead of blaming the connection. Empty when there was simply no answer.
  const lastSaveError = useRef("");
  useEffect(() => {
    draftRef.current = draft;
    readOnlyRef.current = meta.status === "SUBMITTED";
  });

  const edit = useCallback((lineKey: string, patch: Partial<Line>) => {
    if (readOnlyRef.current) return;
    setDraft((d) => {
      const next = { ...(d[lineKey] ?? EMPTY_LINE), ...patch };
      const rest = { ...d };
      if (isEmptyLine(next)) delete rest[lineKey];
      else rest[lineKey] = next;
      return rest;
    });
    unsynced.current.add(lineKey);
    setPending(unsynced.current.size);
  }, []);

  /* ------------------------------------------------------------ browser backup */
  useEffect(() => {
    if (!key) return;
    const t = window.setTimeout(() => saveStored(key, { draft, unsynced: [...unsynced.current] }), BACKUP_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [key, draft, pending]);
  useEffect(() => {
    if (!key) return;
    const write = () => saveStored(key, { draft: draftRef.current, unsynced: [...unsynced.current] });
    window.addEventListener("pagehide", write);
    document.addEventListener("visibilitychange", write);
    return () => {
      window.removeEventListener("pagehide", write);
      document.removeEventListener("visibilitychange", write);
      write();
    };
  }, [key]);

  /* ------------------------------------------------------------ server -> screen */
  const refresh = useCallback(() => {
    const epochAtStart = saveEpoch.current;
    return getMySubmission(date, shift)
        .then((server) => {
          const serverDraft = draftFromServer(server.lines);
          setMeta({ status: server.status, submittedAt: server.submittedAt, reopenedAt: server.reopenedAt, reopenReason: server.reopenReason });
          if (server.status === "SUBMITTED") {
            // Sent: the server has everything, and nothing more can be saved from here.
            unsynced.current.clear();
            setPending(0);
            setDraft(serverDraft);
            if (key) clearStored(key);
          } else if (saveEpoch.current === epochAtStart && !flushing.current) {
            // Only when no save finished (or is running) since the read began; otherwise this copy may be
            // older than what is on screen, and the next read will bring the true one.
            setDraft((d) => mergeServerWithLocal(serverDraft, d, unsynced.current));
          }
        })
        .catch(() => {
          /* offline or the server is down: keep working from the copy on this phone */
        })
        .finally(() => setReady(true));
  }, [date, shift, key]);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /* ------------------------------------------------------------ screen -> server */
  /// One save of every line not yet confirmed. Resolves when that attempt is over (the in-flight one,
  /// if there is one); a failure leaves the lines unsynced so the next attempt carries them.
  const flushOnce = useCallback((): Promise<void> => {
    if (flushing.current) return flushing.current;
    if (unsynced.current.size === 0 || readOnlyRef.current) return Promise.resolve();
    const sent = new Map<string, Line | undefined>();
    for (const k of unsynced.current) sent.set(k, draftRef.current[k]);
    setSaveState("saving");
    const p = saveMyLines(date, shift, [...sent].map(([k, l]) => toDraftLine(k, l)))
      .then(() => {
        // A line typed again while this was in flight is newer than what was sent: it stays unsynced.
        for (const [k, l] of sent) if (sameLine(draftRef.current[k], l)) unsynced.current.delete(k);
        saveEpoch.current += 1;
        lastSaveError.current = "";
        setPending(unsynced.current.size);
        setSavedAt(Date.now());
        setSaveState("saved");
      })
      .catch((e: unknown) => {
        lastSaveError.current = e instanceof ApiError ? e.message : "";
        setSaveState("failed");
        // 409: it was already submitted (from another phone); read the real state.
        if (e instanceof ApiError && e.status === 409) void refreshRef.current();
      })
      .finally(() => {
        flushing.current = null;
      });
    flushing.current = p;
    return p;
  }, [date, shift]);

  useEffect(() => {
    if (pending === 0 || meta.status === "SUBMITTED") return;
    const t = window.setTimeout(() => void flushOnce(), saveState === "failed" ? RETRY_MS : SYNC_DELAY_MS);
    return () => window.clearTimeout(t);
    // `draft` is a dependency on purpose: every keystroke restarts the wait, so typing is never interrupted by a save.
  }, [pending, saveState, meta.status, draft, flushOnce]);
  useEffect(() => {
    const onOnline = () => void flushOnce();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushOnce]);

  /// Sends the count (both locations). Everything typed is saved first; if that cannot be done the
  /// submit does not go - a submitted count must be the whole count.
  const submit = useCallback(
    async (allowEmptyLocation: boolean) => {
      for (let i = 0; i < 3 && unsynced.current.size > 0; i++) await flushOnce();
      if (unsynced.current.size > 0) {
        const why = lastSaveError.current;
        throw new Error(why ? `Your latest counts could not be saved: ${why}` : "Your latest counts could not be saved. Check your connection and try again.");
      }
      const result = await submitMySubmission(date, shift, allowEmptyLocation);
      setMeta({ status: result.status, submittedAt: result.submittedAt, reopenedAt: null, reopenReason: null });
      if (key) clearStored(key);
      return result;
    },
    [date, shift, key, flushOnce],
  );

  /// Takes a submitted count back to edit it (the server refuses once the sheet is published). The
  /// numbers stay; the sheet becomes editable and must be submitted again.
  const reopenForEdit = useCallback(async () => {
    const r = await editMySubmission(date, shift);
    setMeta({ status: r.status, submittedAt: r.submittedAt, reopenedAt: r.reopenedAt, reopenReason: r.reopenReason });
    setDraft(draftFromServer(r.lines));
    return r;
  }, [date, shift]);

  return {
    draft,
    edit,
    meta,
    ready,
    readOnly: meta.status === "SUBMITTED",
    saveState,
    savedAt,
    /// Lines typed here that the server has not confirmed yet.
    pending,
    retry: flushOnce,
    refresh,
    submit,
    reopenForEdit,
  };
}
