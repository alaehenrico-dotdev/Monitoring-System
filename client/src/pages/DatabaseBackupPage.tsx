import { useState } from "react";
import { downloadDatabaseBackup } from "../api/backup";
import { Button } from "../components/ui";
import { DownloadIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { DatabaseRestoreCard } from "./DatabaseRestoreCard";
import { colors, motionTokens } from "../theme";

type Status = "idle" | "downloading" | "done" | "error";

// The dump's total size isn't known ahead of time (see api/backup.ts), so
// there's no real 0-100% to show. This turns the one real signal that IS
// available - bytes actually received so far - into a bar that climbs
// quickly at first and eases off the more it receives, via a log curve
// capped at the same 90% "still working" ceiling the rest of the app's
// progress bars hold at (motionTokens.progressHoldPercent) until the
// download actually finishes. ~2MB as the curve's scale keeps a typical
// dump's bar moving visibly through most of the transfer.
const BYTES_SCALE = 2 * 1024 * 1024;
function estimatePercent(bytes: number): number {
  return (
    motionTokens.progressHoldPercent * (1 - Math.exp(-bytes / BYTES_SCALE))
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/// Settings > Database Backup - lets a supervisor pull a full `mysqldump` of
/// the live database straight from the browser, so an off-site copy can be
/// kept without anyone needing shell access to the DB server. Read-only and
/// non-destructive (unlike its sibling tab, Data Reset), so it sits behind
/// the ordinary SUPERVISOR_ADMIN route guard rather than a second passcode.
export function DatabaseBackupPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [doneDismissed, setDoneDismissed] = useState(false);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setStatus("downloading");
    setDoneDismissed(false);
    setBytes(0);
    setError(null);
    try {
      await downloadDatabaseBackup(setBytes);
      setStatus("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to download backup.",
      );
      setStatus("error");
    }
  }

  const downloading = status === "downloading";
  const percent = downloading
    ? estimatePercent(bytes)
    : status === "done"
      ? 100
      : 0;

  return (
    <div
      style={{
        maxWidth: 640,
        background: "var(--ae-surface-glass)",
        backdropFilter: "var(--ae-glass-blur)",
        WebkitBackdropFilter: "var(--ae-glass-blur)",
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 18px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.ink }}>
            Backup
          </div>
          <div
            style={{ fontSize: 12.5, color: colors.subtleInk, marginTop: 2 }}
          >
            Download the whole database as a <code>.sql</code> file.
          </div>
        </div>

        {downloading && (
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: 12, color: colors.subtleInk, flexShrink: 0 }}
          >
            {formatBytes(bytes)}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {downloading ? (
            <Spinner size="sm" color={colors.cream} />
          ) : (
            <DownloadIcon />
          )}
          {downloading ? "Downloading…" : "Download"}
        </Button>
        <Toast
          id="backup-done"
          message={
            status === "done" && !doneDismissed
              ? `Backup downloaded (${formatBytes(bytes)}).`
              : null
          }
          onDismiss={() => setDoneDismissed(true)}
        />
        <Toast
          message={status === "error" ? error : null}
          onDismiss={() => setError(null)}
          variant="error"
          duration={null}
        />

        {(downloading || status === "done") && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              background: colors.paperAlt,
            }}
          >
            <div
              style={{
                height: "100%",
                width: "100%",
                transform: `scaleX(${percent / 100})`,
                transformOrigin: "left center",
                background: colors.yellow,
                transition: `transform ${downloading ? "0.5s" : "0.25s"} ${motionTokens.progressEase}`,
              }}
            />
          </div>
        )}
      </div>

      <div style={{ height: 1, background: colors.border }} />
      <DatabaseRestoreCard />
    </div>
  );
}
