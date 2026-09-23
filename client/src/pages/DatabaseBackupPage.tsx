import { useState } from "react";
import { downloadDatabaseBackup } from "../api/backup";
import { Button } from "../components/ui";
import { Spinner } from "../components/Spinner";
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
  return motionTokens.progressHoldPercent * (1 - Math.exp(-bytes / BYTES_SCALE));
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
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setStatus("downloading");
    setBytes(0);
    setError(null);
    try {
      await downloadDatabaseBackup(setBytes);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download backup.");
      setStatus("error");
    }
  }

  const downloading = status === "downloading";
  const percent = downloading ? estimatePercent(bytes) : status === "done" ? 100 : 0;

  return (
    <div
      style={{
        maxWidth: 760,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        padding: "32px 36px",
      }}
    >
      <h3 style={{ margin: "0 0 10px", fontSize: 19, fontWeight: 700, color: colors.ink }}>
        Download a full database backup
      </h3>
      <p style={{ margin: "0 0 24px", fontSize: 13.5, lineHeight: 1.6, color: colors.subtleInk, maxWidth: 560 }}>
        Generates a complete SQL dump of the live database - every product, entry, count, receipt,
        report, and account - as a single <code>.sql</code> file you can store off-site. Restoring
        from it requires a developer to load it back into a MySQL server.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={handleDownload}
          disabled={downloading}
          style={{ padding: "10px 22px", display: "inline-flex", alignItems: "center", gap: 8, color: colors.yellow }}
        >
          {downloading && <Spinner size="sm" color={colors.cream} />}
          {downloading ? "Downloading…" : "Download Backup"}
        </Button>

        {downloading && (
          <span role="status" aria-live="polite" style={{ fontSize: 12.5, color: colors.subtleInk }}>
            {formatBytes(bytes)} received
          </span>
        )}
        {status === "done" && (
          <p style={{ margin: 0, fontSize: 12.5, color: colors.gold, fontWeight: 600 }}>
            Backup downloaded ({formatBytes(bytes)}).
          </p>
        )}
        {status === "error" && error && (
          <p style={{ margin: 0, fontSize: 12.5, color: colors.danger }}>{error}</p>
        )}
      </div>

      {(downloading || status === "done") && (
        <div
          aria-hidden="true"
          style={{ marginTop: 18, height: 4, borderRadius: 2, background: colors.paperAlt, overflow: "hidden" }}
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
  );
}
