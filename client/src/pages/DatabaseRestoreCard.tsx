import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/http";
import { downloadDatabaseBackup, restoreDatabaseBackup } from "../api/backup";
import { verifyResetPasscode } from "../api/dataReset";
import { Button } from "../components/ui";
import { Modal } from "../components/Modal";
import { confirmDownload } from "../components/DownloadConfirm";
import { InlineLoading } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { colors } from "../theme";
import { clearAllPendingEntryState } from "../hooks/usePendingEntryChanges";

type Status =
  | "idle"
  | "confirming"
  | "backing-up"
  | "restoring"
  | "done"
  | "error";

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
    setUploaded(0);
    setStatus("backing-up");
    try {
      if (!(await confirmDownload("Database backup"))) {
        throw new Error(
          "Restore was cancelled - the safety backup of the current data wasn't downloaded, so nothing was changed.",
        );
      }
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
    <div
      style={{
        maxWidth: 760,
        marginTop: 24,
        background: "var(--ae-surface-glass)",
        backdropFilter: "var(--ae-glass-blur)",
        WebkitBackdropFilter: "var(--ae-glass-blur)",
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "32px 36px",
      }}
    >
      <h3
        style={{
          margin: "0 0 10px",
          fontSize: 19,
          fontWeight: 700,
          color: colors.ink,
        }}
      >
        Restore from a backup
      </h3>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13.5,
          lineHeight: 1.6,
          color: colors.subtleInk,
          maxWidth: 560,
        }}
      >
        Replaces <strong>everything</strong> in the live database - products,
        entries, counts, reports and accounts - with the contents of a{" "}
        <code>.sql</code> file made by Download Backup. Anything entered since
        that backup is lost. A backup of the current data is downloaded to this
        device first.
      </p>

      {!resetToken ? (
        <form
          onSubmit={handleUnlock}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="password"
            inputMode="numeric"
            aria-label="Restore passcode"
            placeholder="Passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            disabled={verifying}
            className="ae-input"
            style={{ maxWidth: 200 }}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={verifying || !passcode}
          >
            {verifying ? "Verifying…" : "Unlock restore"}
          </Button>
          {passcodeError && (
            <span style={{ fontSize: 12.5, color: colors.danger }}>
              {passcodeError}
            </span>
          )}
          <span
            style={{ flexBasis: "100%", fontSize: 12, color: colors.subtleInk }}
          >
            Uses the same passcode as Data Reset.
          </span>
        </form>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            Choose backup file…
          </Button>
          {file && (
            <span style={{ fontSize: 12.5, color: colors.ink }}>
              {file.name} ({formatBytes(file.size)})
            </span>
          )}
          <Button
            type="button"
            variant="danger"
            disabled={!file || busy}
            onClick={() => {
              setError(null);
              setStatus("confirming");
            }}
          >
            Restore…
          </Button>
        </div>
      )}

      {status === "done" && (
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 12.5,
            color: colors.gold,
            fontWeight: 600,
          }}
        >
          Database restored. Reload to see the restored data (you may need to
          sign in again if accounts changed).{" "}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              color: "inherit",
              font: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Reload now
          </button>
        </p>
      )}
      {/* offset stacks this above DatabaseBackupPage's own error Toast
          (this card is embedded on that same page), rather than both
          portaling to the same bottom-right spot. */}
      <Toast
        message={status === "error" ? error : null}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
        offset={96}
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
