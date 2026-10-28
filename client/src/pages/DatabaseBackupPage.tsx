import { useEffect, useRef, useState } from "react";
import { downloadDatabaseBackup } from "../api/backup";
import { Button } from "../components/ui";
import { CheckIcon, DownloadIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { DatabaseRestoreCard } from "./DatabaseRestoreCard";
import { BackupHistoryCard } from "./BackupHistoryCard";
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
/// non-destructive (unlike its sibling tab, Data Reset), but a dump holds every
/// record, so each download asks for the signed-in admin's password again.
export function DatabaseBackupPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [doneDismissed, setDoneDismissed] = useState(false);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a download finishes so the history card re-reads.
  const [historyKey, setHistoryKey] = useState(0);
  // After a successful download the button shows a check, then the check and
  // the bar fade back to the idle look (the status itself stays "done" so the
  // toast keeps its message).
  const [showCheck, setShowCheck] = useState(false);
  const [barFading, setBarFading] = useState(false);
  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  async function handleDownload() {
    clearTimers();
    setShowCheck(false);
    setBarFading(false);
    setStatus("downloading");
    setDoneDismissed(false);
    setBytes(0);
    setError(null);
    try {
      await downloadDatabaseBackup(setBytes);
      setStatus("done");
      setHistoryKey((k) => k + 1);
      setShowCheck(true);
      timers.current.push(
        window.setTimeout(() => setBarFading(true), 900),
        window.setTimeout(() => setShowCheck(false), 1700),
      );
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
    <div style={{ width: "100%", maxWidth: 640, margin: "0 auto" }}>
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
          <div style={{ fontSize: "calc(14px * var(--ae-fs, 1))", fontWeight: 600, color: colors.ink }}>
            Backup
          </div>
          <div
            style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 2 }}
          >
            Download the whole database as a <code>.sql</code> file.
          </div>
        </div>

        {downloading && (
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: "calc(12px * var(--ae-fs, 1))", color: colors.subtleInk, flexShrink: 0 }}
          >
            {formatBytes(bytes)}
          </span>
        )}
        <Button
          variant="secondary"
          className="ae-btn-solid"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            flexShrink: 0,
            minWidth: 118,
          }}
        >
          <span
            key={downloading ? "busy" : showCheck ? "ok" : "idle"}
            className="ae-fade-in"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {downloading ? (
              <Spinner size="sm" color={colors.cream} />
            ) : showCheck ? (
              <CheckIcon />
            ) : (
              <DownloadIcon />
            )}
            {downloading ? "Downloading…" : showCheck ? "Done" : "Download"}
          </span>
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

        {(downloading || (status === "done" && showCheck)) && (
          <div
            aria-hidden="true"
            className={`ae-dl-track${barFading ? " is-fading" : ""}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              background: colors.paperAlt,
            }}
          >
            <div
              className={`ae-dl-bar${downloading ? " is-busy" : ""}`}
              style={{
                color: colors.yellow,
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
    <BackupHistoryCard key={historyKey} />
    </div>
  );
}
