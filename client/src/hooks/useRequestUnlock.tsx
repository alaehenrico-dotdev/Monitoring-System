import { useCallback, useEffect, useState } from "react";
import { getUnlockRequest, requestUnlock, unlockDay, type EntryLocation, type UnlockRequest } from "../api/ops";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui";
import { PAGE_LABEL } from "./useFinishDay";
import { formatDateDisplay } from "../utils/dateFormat";
import type { Shift } from "../types";

/**
 * Unlocking a locked page from the toolbar. For an encoder it is a request: a
 * reason goes to the Admin Queue and the toolbar then says it is waiting - an
 * admin still decides. For an admin (`direct`) there is nothing to approve: the
 * same box (the reason is kept in the change log) unlocks the page at once.
 * `enabled` is false when there is nothing to unlock, so nothing is fetched.
 */
export function useRequestUnlock({
  date,
  shift,
  location,
  enabled,
  direct = false,
  onUnlocked,
}: {
  date: string;
  shift: Shift;
  location: EntryLocation;
  enabled: boolean;
  direct?: boolean;
  onUnlocked?: () => void;
}) {
  const realtimeVersion = useRealtimeVersion();
  const [pending, setPending] = useState<UnlockRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read on realtime events too, so it goes back to "Request unlock" the
  // moment an admin answers it (the page is unlocked, or the day moves on).
  useEffect(() => {
    if (!enabled || direct) return;
    let current = true;
    getUnlockRequest(date, shift, location)
      .then((r) => current && setPending(r))
      .catch(() => {
        // Cosmetic: without it the button simply stays "Request unlock".
      });
    return () => {
      current = false;
    };
  }, [enabled, direct, date, shift, location, realtimeVersion]);

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (direct) {
        await unlockDay(date, shift, reason.trim(), location);
        onUnlocked?.();
      } else {
        setPending(await requestUnlock(date, shift, location, reason.trim()));
      }
      setOpen(false);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : direct ? "Could not unlock the page." : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }, [date, shift, location, reason, direct, onUnlocked]);

  const dialog = open ? (
    <Modal title={`${direct ? "Unlock" : "Request unlock"} - ${PAGE_LABEL[location]} · ${formatDateDisplay(date)}`} onClose={busy ? () => {} : () => setOpen(false)} width={440}>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>
        {direct
          ? "The page opens for changes straight away - no approval needed. The reason is kept in the change log."
          : "An admin will see this in their Admin Queue and can unlock the page so you can change it. Nothing changes until they do."}
      </p>
      <textarea
        className="ae-input"
        aria-label={direct ? "Reason for unlocking" : "Reason for the unlock request"}
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", height: "auto", padding: 8 }}
        placeholder={direct ? "Why is this page being reopened?" : "What needs to change, and why?"}
      />
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--ae-danger-text)", marginTop: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
        <Button className="ae-btn-solid" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button className="ae-btn-solid" disabled={reason.trim().length < 5} loading={busy} loadingLabel={direct ? "Unlocking…" : "Sending…"} onClick={() => void send()}>
          {direct ? "Unlock now" : "Send request"}
        </Button>
      </div>
    </Modal>
  ) : null;

  return { pending: enabled && !direct ? pending : null, direct, openDialog: () => setOpen(true), dialog };
}
