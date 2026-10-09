import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ApiError } from "../api/http";
import { downloadDatabaseBackup, restoreDatabaseBackup } from "../api/backup";
import { verifyResetPasscode } from "../api/dataReset";
import { Button } from "../components/ui";
import { Modal } from "../components/Modal";
import { InlineLoading } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { UploadIcon } from "../components/icons";
import { colors } from "../theme";
import { clearAllPendingEntryState } from "../hooks/usePendingEntryChanges";

type Status =
  | "idle"
  | "confirming"
  | "backing-up"
  | "restoring"
  | "done"
  | "error";

// The passcode field, Choose file and Restore take turns in one slot, so they
// share one width/height - the row never jumps between steps.
const slotStyle: CSSProperties = {
  width: 150,
  height: 32,
  boxSizing: "border-box",
  padding: "0 10px",
  fontSize: 12.5,
  flexShrink: 0,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/// Settings > Backup & Restore - the restore half. Replaces the live database
/// with a `.sql` file from Download Backup. Destructive, so it needs the same
/// passcode Data Reset does (verified server-side, not just here), an
/// explicit confirmation, and - like Data Reset - takes a safety backup of
/// the CURRENT database to this device first, aborting if that fails, because
/// a restore that dies partway can leave the database half-replaced.
export function DatabaseRestoreCard() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [doneDismissed, setDoneDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = status === "backing-up" || status === "restoring";

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setPasscodeError(null);
    setVerifying(true);
    try {
      const token = await verifyResetPasscode(passcode);
      if (token) setResetToken(token);
      else setPasscodeError("Incorrect passcode.");
    } catch (err) {
      setPasscodeError(
        err instanceof Error
          ? err.message
          : "Couldn't verify passcode. Try again.",
      );
    } finally {
      setPasscode("");
      setVerifying(false);
    }
  }

  async function performRestore() {
    if (!file || !resetToken) return;
    setError(null);
    setDoneDismissed(false);
    setUploaded(0);
    setStatus("backing-up");
    try {
      try {
        await downloadDatabaseBackup();
      } catch (err) {
        throw Object.assign(
          new Error(
            `Restore was cancelled - the safety backup of the current data failed: ${err instanceof Error ? err.message : "unknown error"}`,
          ),
          { cause: err },
        );
      }
      setStatus("restoring");
      await restoreDatabaseBackup(file, resetToken, setUploaded);
      // Report History is server-backed now (api/reportHistory.ts) - the
      // restored .sql dump already replaces that table's rows along with
      // everything else, so there's nothing to clear client-side here.
      // Browser-local cache of pre-restore staged edits (see DataResetPage).
      clearAllPendingEntryState();
      setStatus("done");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403))
        setResetToken(null);
      setError(
        err instanceof Error ? err.message : "Failed to restore backup.",
      );
      setStatus("error");
    }
  }

  return (
    <div style={{ padding: "14px 18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.ink }}>
            Restore
          </div>
          <div
            style={{ fontSize: 12.5, color: colors.subtleInk, marginTop: 2 }}
          >
            Replaces all live data with a <code>.sql</code> backup. Current data
            is saved to this device first.
          </div>
        </div>

        {/* One slot, one control at a time: passcode field (Enter to
            unlock) -> Choose file -> Restore. All three share one size. */}
        {!resetToken ? (
          <form onSubmit={handleUnlock} style={{ display: "flex" }}>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Restore passcode - press Enter to unlock"
              placeholder={verifying ? "Verifying…" : "Passcode"}
              title="Same passcode as Data Reset. Press Enter to unlock."
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={verifying}
              className="ae-input"
              style={slotStyle}
            />
          </form>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".sql,application/sql,text/plain"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setStatus("idle");
                setError(null);
              }}
            />
            {!file ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                style={{
                  ...slotStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <UploadIcon />
                Choose file
              </Button>
            ) : (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStatus("confirming");
                }}
                style={{
                  ...slotStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Restore
              </Button>
            )}
          </>
        )}
      </div>

      {resetToken && file && (
        <div
          title="Click to choose a different file"
          onClick={() => !busy && fileInput.current?.click()}
          style={{
            marginTop: 8,
            fontSize: 12,
            color: colors.subtleInk,
            cursor: busy ? "default" : "pointer",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name} ({formatBytes(file.size)})
        </div>
      )}
      {!resetToken && passcodeError && (
        <div style={{ marginTop: 8, fontSize: 12, color: colors.danger }}>
          {passcodeError}
        </div>
      )}

      <Toast
        id="restore-done"
        message={
          status === "done" && !doneDismissed
            ? "Database restored. Reload to see the restored data (you may need to sign in again if accounts changed)."
            : null
        }
        duration={null}
        action={{
          label: "Reload now",
          onClick: () => window.location.reload(),
        }}
        onDismiss={() => setDoneDismissed(true)}
      />
      <Toast
        message={status === "error" ? error : null}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />

      {(status === "confirming" || busy) && (
        <Modal
          title="Confirm database restore"
          onClose={status === "confirming" ? () => setStatus("idle") : () => {}}
          width={460}
        >
          {status === "confirming" ? (
            <>
              <p style={{ margin: "0 0 12px", fontSize: 13.5 }}>
                This will overwrite the entire live database with{" "}
                <strong>{file?.name}</strong>. Anything saved after that backup
                was taken will be lost.
              </p>
              <p style={{ margin: "0 0 18px", fontSize: 13 }}>
                A backup of the current data will be downloaded first; if that
                fails, nothing is restored.
              </p>
              <div
                style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
              >
                <Button variant="secondary" onClick={() => setStatus("idle")}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void performRestore()}>
                  Restore Now
                </Button>
              </div>
            </>
          ) : status === "backing-up" ? (
            <InlineLoading label="Saving a backup of the current data first…" />
          ) : (
            <InlineLoading
              label={
                uploaded < 1
                  ? `Uploading backup… ${Math.round(uploaded * 100)}%`
                  : "Restoring database…"
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}
