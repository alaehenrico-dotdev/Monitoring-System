import { useEffect, useState } from "react";
import {
  getBackupHistory,
  verifyBackupFileByName,
  type BackupHistory,
  type BackupReport,
} from "../api/backup";
import { Button } from "../components/ui";
import { InlineLoading } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { colors } from "../theme";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_TONE = { OK: "done", FAILED: "bad", INVALID: "bad" } as const;
const TRIGGER_LABEL = { manual: "Download", scheduled: "Scheduled", "pre-restore": "Before restore", "pre-migration": "Before migration" } as const;

/// Settings > Backup & Restore - what has been backed up and when, whether each
/// copy was checked and found complete, and whether a backup is overdue. Files
/// the scheduled backup script leaves in BACKUP_DIR can be verified in place.
export function BackupHistoryCard() {
  const [history, setHistory] = useState<BackupHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [report, setReport] = useState<(BackupReport & { fileName: string }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBackupHistory()
      .then((h) => !cancelled && setHistory(h))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load backup history."));
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function verify(name: string) {
    setVerifying(name);
    setError(null);
    try {
      setReport(await verifyBackupFileByName(name));
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify that file.");
    } finally {
      setVerifying(null);
    }
  }

  const health = history?.health;
  const cell = { padding: "6px 10px", fontSize: "calc(12.5px * var(--ae-fs, 1))", textAlign: "left" as const, borderBottom: `1px solid ${colors.border}` };

  return (
    <div className="ae-panel" style={{ maxWidth: 640, marginTop: 16, padding: "14px 18px" }}>
      <div style={{ fontSize: "calc(14px * var(--ae-fs, 1))", fontWeight: 600, color: colors.ink }}>Backup history</div>
      <div style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 2 }}>
        {health?.lastBackupAt
          ? `Last good backup: ${new Date(health.lastBackupAt).toLocaleString()}.`
          : "No good backup has been recorded yet."}{" "}
        {health?.overdue && (
          <strong style={{ color: colors.danger }}>Overdue - expected at least every {health.overdueHours} hours.</strong>
        )}
      </div>
      {health?.failedSince && (
        <div role="alert" style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.danger, marginTop: 6 }}>
          A backup failed or was invalid after the last good one: {health.failedSince.fileName}
          {health.failedSince.error ? ` - ${health.failedSince.error}` : ""}
        </div>
      )}

      {!history ? (
        <div style={{ marginTop: 10 }}><InlineLoading label="Loading history…" /></div>
      ) : history.records.length === 0 ? (
        <p style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk }}>Nothing recorded yet. Downloads from this page appear here.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", color: colors.ink }}>
            <thead>
              <tr>
                <th style={cell}>When</th>
                <th style={cell}>File</th>
                <th style={cell}>Source</th>
                <th style={cell}>Size</th>
                <th style={cell}>Check</th>
              </tr>
            </thead>
            <tbody>
              {history.records.slice(0, 20).map((r) => (
                <tr key={r.id} title={r.sha256 ? `SHA-256 ${r.sha256}` : undefined}>
                  <td style={cell}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ ...cell, overflowWrap: "anywhere" }}>{r.fileName}</td>
                  <td style={cell}>{TRIGGER_LABEL[r.trigger]}</td>
                  <td style={cell}>{formatBytes(r.sizeBytes)}</td>
                  <td style={cell}>
                    <span className={`ae-dash-chip ae-dash-chip--${STATUS_TONE[r.status]}`} title={r.error ?? undefined}>
                      {r.status === "OK" ? "Complete" : r.status === "INVALID" ? "Incomplete" : "Failed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history && history.files.length > 0 && (
        <>
          <div style={{ fontSize: "calc(13px * var(--ae-fs, 1))", fontWeight: 600, color: colors.ink, margin: "16px 0 6px" }}>Scheduled backup files</div>
          {history.files.slice(0, 10).map((f) => (
            <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.ink, padding: "4px 0" }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {f.name} · {formatBytes(f.sizeBytes)} · {new Date(f.modifiedAt).toLocaleString()}
              </span>
              <Button className="ae-btn-solid" size="sm" disabled={verifying !== null} onClick={() => void verify(f.name)}>
                {verifying === f.name ? "Checking…" : "Verify"}
              </Button>
            </div>
          ))}
        </>
      )}

      {report && (
        <div role="status" style={{ marginTop: 10, fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.ink }}>
          <strong style={{ color: report.ok ? undefined : colors.danger }}>
            {report.fileName}: {report.ok ? "complete and restorable." : "not usable."}
          </strong>
          {report.problems.map((p) => <div key={p} style={{ color: colors.danger }}>• {p}</div>)}
        </div>
      )}
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </div>
  );
}
