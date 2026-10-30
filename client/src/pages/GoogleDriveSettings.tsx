import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  backupToDriveNow,
  disconnectDrive,
  getDriveStatus,
  startDriveConnect,
  updateDriveSettings,
  type DriveSettings,
  type DriveStatus,
  type DriveUpload,
} from "../api/drive";
import { getReportOptions, updateReportOptions, type ReportOptions } from "../api/appSettings";
import { Button } from "../components/ui";
import { InlineLoading } from "../components/Spinner";
import { Toast } from "../components/Toast";
import { resetDriveCopyConfig } from "../utils/driveCopy";
import { formatHour, localSlotToUtc, utcSlotToLocal, WEEKDAYS, wholeHourOffset } from "../utils/driveTime";
import { goTo } from "../utils/navigate";
import { colors } from "../theme";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Busy = "connect" | "disconnect" | "backup" | "save" | null;
type KindFilter = "all" | DriveUpload["kind"];

const KIND_LABEL: Record<DriveUpload["kind"], string> = { report: "Report", backup: "Backup", export: "Export" };
const FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "report", label: "Reports" },
  { id: "backup", label: "Backups" },
  { id: "export", label: "Exports" },
];

/// Google only accepts a plain-http redirect address for localhost, so Connect
/// can only complete from the PC that runs the server (or from an https address).
function canConnectFromHere(): boolean {
  const { protocol, hostname } = window.location;
  return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
}

/// What Google sent the browser back with (see the server's OAuth callback).
/// Pure - the address bar is tidied separately, in an effect, because a state
/// initializer may run twice and the second run would find it already gone.
function readOutcome(): { message: string; error: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("drive");
  if (!outcome) return null;
  const reason = params.get("reason");
  if (outcome === "connected") return { message: "Google Drive is connected.", error: false };
  if (outcome === "denied") return { message: "Google Drive was not connected - access was declined.", error: true };
  return { message: reason || "Could not connect Google Drive.", error: true };
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

const card = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: "12px 14px",
  display: "grid",
  gap: 8,
} as const;

/// One thing that is saved to Drive, with the folder it goes to and when it last did.
function AutoCard({
  title,
  badge,
  folder,
  last,
  children,
}: {
  title: string;
  badge: string;
  folder: string;
  last: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section style={card} aria-label={title}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "calc(13.5px * var(--ae-fs, 1))", color: colors.ink }}>{title}</strong>
        <span className="ae-dash-chip ae-dash-chip--done">{badge}</span>
      </div>
      <div style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk }}>
        Folder: <strong style={{ color: colors.ink, fontWeight: 600 }}>{folder}</strong>
        <span aria-hidden> · </span>
        {last}
      </div>
      {children}
    </section>
  );
}

/// Settings > Google Drive - connect one Google account, and everything the
/// system produces is saved to it by itself: each day's report the moment the
/// day is finished or corrected, the database every week, and a
/// copy of every export. The switches apply the moment they are changed.
export function GoogleDriveSettings() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [outcome] = useState(readOutcome);
  const [error, setError] = useState<string | null>(outcome?.error ? outcome.message : null);
  const [notice, setNotice] = useState<string | null>(outcome && !outcome.error ? outcome.message : null);
  const [busy, setBusy] = useState<Busy>(null);
  // Closing the "backing up" toast only hides it; the backup carries on.
  const [backupToastClosed, setBackupToastClosed] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [keepText, setKeepText] = useState("");
  // What the Daily Report PDF leaves out; null until read (the switches then stay hidden).
  const [reportOptions, setReportOptions] = useState<ReportOptions | null>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const offset = wholeHourOffset();

  const apply = useCallback((next: DriveStatus) => {
    setStatus(next);
    setKeepText(next.settings ? String(next.settings.keepBackups) : "");
    // The browsers' cached "should I send copies?" answer may now be stale.
    resetDriveCopyConfig();
  }, []);

  useEffect(() => {
    // Shown once; refreshing the page should not show it again.
    if (outcome) window.history.replaceState(null, "", window.location.pathname);
  }, [outcome]);

  // Best effort: if this cannot be read the two switches simply do not show.
  useEffect(() => {
    let cancelled = false;
    getReportOptions()
      .then((o) => !cancelled && setReportOptions(o))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDriveStatus()
      .then((s) => !cancelled && apply(s))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the Google Drive status."));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function run<T>(kind: Exclude<Busy, null>, work: () => Promise<T>, then?: (result: T) => void) {
    setBusy(kind);
    setError(null);
    try {
      then?.(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const connect = () => run("connect", startDriveConnect, ({ url }) => goTo(url));

  const disconnect = () =>
    run("disconnect", disconnectDrive, (next) => {
      apply(next);
      setConfirmDisconnect(false);
      setNotice("Google Drive disconnected. Existing files were kept.");
    });

  const change = (patch: Partial<DriveSettings>) => run("save", () => updateDriveSettings(patch), apply);
  const changeReportOptions = (patch: Partial<ReportOptions>) => run("save", () => updateReportOptions(patch), setReportOptions);

  const backupNow = () => {
    setBackupToastClosed(false);
    return run("backup", backupToDriveNow, (result) => {
      apply(result.status);
      setNotice(`Backed up to Google Drive: ${result.fileName} (${formatBytes(result.sizeBytes)}).`);
    });
  };

  function commitKeep() {
    if (!status?.settings) return;
    const value = Number(keepText);
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      setKeepText(String(status.settings.keepBackups));
      setError("Enter 1 to 365 backups.");
      return;
    }
    if (value !== status.settings.keepBackups) void change({ keepBackups: value });
  }

  const recent = useMemo(() => status?.recent ?? [], [status]);
  const shown = useMemo(() => (filter === "all" ? recent : recent.filter((u) => u.kind === filter)), [recent, filter]);
  const failed = recent.filter((u) => u.status === "FAILED").length;

  const cell = { padding: "6px 10px", fontSize: "calc(12.5px * var(--ae-fs, 1))", textAlign: "left" as const, borderBottom: `1px solid ${colors.border}` };
  const settings = status?.settings;
  const hourOptions = Array.from({ length: 24 }, (_, h) => h);
  // The weekly slot as this browser's clock shows it (plain UTC in a half-hour zone).
  const slot = settings
    ? offset === null
      ? { day: settings.backupWeekday, hour: settings.backupHourUtc }
      : utcSlotToLocal({ day: settings.backupWeekday, hour: settings.backupHourUtc }, offset)
    : { day: 0, hour: 0 };
  // Saves a day/hour picked on that clock as the UTC pair the server stores,
  // sending only what actually changed.
  function changeSlot(next: { day: number; hour: number }) {
    if (!settings) return;
    const utc = offset === null ? next : localSlotToUtc(next, offset);
    const patch: Partial<DriveSettings> = {};
    if (utc.day !== settings.backupWeekday) patch.backupWeekday = utc.day;
    if (utc.hour !== settings.backupHourUtc) patch.backupHourUtc = utc.hour;
    if (Object.keys(patch).length > 0) void change(patch);
  }

  return (
    <div className="ae-panel" style={{ maxWidth: 720, padding: "14px 18px" }}>
      <div style={{ fontSize: "calc(14px * var(--ae-fs, 1))", fontWeight: 600, color: colors.ink }}>Google Drive</div>
      <div style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, marginTop: 2 }}>
        Reports and backups are saved to Google Drive automatically - nobody has to click anything. The system can
        only see the files it puts there, never the rest of the Drive.
      </div>

      {!status ? (
        <div style={{ marginTop: 12 }}>
          <InlineLoading label="Loading…" />
        </div>
      ) : !status.configured ? (
        <div role="status" style={{ marginTop: 12, fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.ink }}>
          <strong>Google Drive is not set up on this server yet.</strong> Add <code>GOOGLE_CLIENT_ID</code> and{" "}
          <code>GOOGLE_CLIENT_SECRET</code> to the server's <code>.env</code>, then restart it. The steps are in{" "}
          <code>docs/GOOGLE_DRIVE.md</code>. When Google asks for the redirect address, use:
          <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
            <code>{status.redirectUri}</code>
          </div>
        </div>
      ) : !status.connected ? (
        <div style={{ marginTop: 12 }}>
          {!canConnectFromHere() && (
            <div role="alert" style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.danger, marginBottom: 8 }}>
              Open this page at <code>http://localhost</code> on the PC that runs the server to connect. Google only
              accepts a plain-http return address for localhost. Once connected, everything works from any PC.
            </div>
          )}
          <Button loading={busy === "connect"} loadingLabel="Opening Google…" onClick={() => void connect()}>
            Connect Google Drive
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink }}>
            <span>
              Connected as <strong>{status.accountEmail ?? "your Google account"}</strong>
            </span>
            {confirmDisconnect ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Disconnect?
                <Button className="ae-btn-solid" size="sm" loading={busy === "disconnect"} onClick={() => void disconnect()}>
                  Yes, disconnect
                </Button>
                <Button className="ae-btn-solid" size="sm" disabled={busy !== null} onClick={() => setConfirmDisconnect(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button className="ae-btn-solid" size="sm" disabled={busy !== null} onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            )}
          </div>

          {status.lastError && (
            <div role="alert" style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.danger }}>
              {status.lastError}{" "}
              <Button className="ae-btn-solid" size="sm" loading={busy === "connect"} onClick={() => void connect()}>
                Reconnect
              </Button>
            </div>
          )}

          {settings && (
            <div style={{ display: "grid", gap: 10 }}>
              <AutoCard
                title="Daily reports"
                badge="Automatic"
                folder="Ala Eh Stock Monitoring - Reports / year / month"
                last={status.lastReportAt ? `Last saved ${when(status.lastReportAt)}` : "No report has been saved yet"}
              >
                <div style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.ink }}>
                  Each day's report is saved as a PDF the moment the day is finished, and again if a
                  correction changes it. There is one file per day; earlier days stay as an archive.
                </div>
                {reportOptions && (
                  <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={reportOptions.hideEmptyRows}
                        disabled={busy !== null}
                        onChange={(e) => void changeReportOptions({ hideEmptyRows: e.target.checked })}
                      />
                      Leave out products with no figures that day
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={reportOptions.hideEmptyColumns}
                        disabled={busy !== null}
                        onChange={(e) => void changeReportOptions({ hideEmptyColumns: e.target.checked })}
                      />
                      Leave out columns that are empty for every product
                    </label>
                    <span style={{ color: colors.subtleInk, fontSize: "calc(12px * var(--ae-fs, 1))" }}>
                      Only products and columns where every figure is zero are left out, so totals do not change.
                      The report's Summary says what was left out.
                    </span>
                  </div>
                )}
              </AutoCard>

              <AutoCard
                title="Database backup"
                badge={settings.autoBackup ? "Automatic" : "Off"}
                folder="Ala Eh Stock Monitoring - Backups"
                last={
                  <>
                    {status.lastBackupAt ? `Last backup ${when(status.lastBackupAt)}` : "No backup has been sent yet"}
                    {settings.autoBackup && status.nextBackupAt && (
                      <>
                        <span aria-hidden> · </span>
                        Next backup {when(status.nextBackupAt)}
                      </>
                    )}
                  </>
                }
              >
                <div style={{ display: "grid", gap: 8, fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={settings.autoBackup}
                        disabled={busy !== null}
                        onChange={(e) => void change({ autoBackup: e.target.checked })}
                      />
                      Back up the database to Drive every week
                    </label>
                    {settings.autoBackup && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        on
                        <select
                          className="ae-select"
                          aria-label="Day of the weekly backup"
                          disabled={busy !== null}
                          value={slot.day}
                          onChange={(e) => void changeSlot({ day: Number(e.target.value), hour: slot.hour })}
                        >
                          {WEEKDAYS.map((name, d) => (
                            <option key={name} value={d}>
                              {name}
                            </option>
                          ))}
                        </select>
                        at
                        <select
                          className="ae-select"
                          aria-label="Time of the weekly backup"
                          disabled={busy !== null}
                          value={slot.hour}
                          onChange={(e) => void changeSlot({ day: slot.day, hour: Number(e.target.value) })}
                        >
                          {hourOptions.map((h) => (
                            <option key={h} value={h}>
                              {offset === null ? `${String(h).padStart(2, "0")}:00 UTC` : formatHour(h)}
                            </option>
                          ))}
                        </select>
                        <span style={{ color: colors.subtleInk, fontSize: "calc(12.5px * var(--ae-fs, 1))" }}>{offset === null ? "" : "your time"}</span>
                      </label>
                    )}
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    Keep the newest
                    <input
                      className="ae-input"
                      type="number"
                      min={1}
                      max={365}
                      aria-label="Number of backups to keep"
                      style={{ width: 72 }}
                      disabled={busy !== null}
                      value={keepText}
                      onChange={(e) => setKeepText(e.target.value)}
                      onBlur={commitKeep}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                    backups - about a year's worth at 12 (older ones go to the Drive trash)
                  </label>

                  <div>
                    <Button
                      className="ae-btn-solid"
                      size="sm"
                      loading={busy === "backup"}
                      loadingLabel="Backing up…"
                      disabled={busy !== null}
                      onClick={() => void backupNow()}
                    >
                      Back up to Drive now
                    </Button>
                  </div>
                </div>
              </AutoCard>

              <AutoCard
                title="Export copies"
                badge={settings.saveExports ? "Automatic" : "Off"}
                folder="Ala Eh Stock Monitoring - Exports"
                last="Whenever someone downloads a file"
              >
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={settings.saveExports}
                    disabled={busy !== null}
                    onChange={(e) => void change({ saveExports: e.target.checked })}
                  />
                  Save a copy of every Excel, CSV and PDF export
                </label>
              </AutoCard>
            </div>
          )}

          <section aria-label="Recent activity">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: "calc(13px * var(--ae-fs, 1))", fontWeight: 600, color: colors.ink }}>
                Recent activity
                {failed > 0 && (
                  <span className="ae-dash-chip ae-dash-chip--bad" style={{ marginLeft: 8 }}>
                    {failed} failed
                  </span>
                )}
              </div>
              <span className="ae-dash-seg" role="group" aria-label="Show">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    className={filter === f.id ? "ae-dash-seg-btn--active" : undefined}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </span>
            </div>
            {shown.length === 0 ? (
              <p style={{ fontSize: "calc(12.5px * var(--ae-fs, 1))", color: colors.subtleInk, margin: "6px 0 0" }}>
                {recent.length === 0 ? "Nothing has been sent to Drive yet." : "Nothing of this kind in the recent activity."}
              </p>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 4 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", color: colors.ink }}>
                  <thead>
                    <tr>
                      <th style={cell}>When</th>
                      <th style={cell}>Type</th>
                      <th style={cell}>File</th>
                      <th style={cell}>Size</th>
                      <th style={cell}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.id}>
                        <td style={cell}>{new Date(u.createdAt).toLocaleString()}</td>
                        <td style={cell}>{KIND_LABEL[u.kind]}</td>
                        <td style={{ ...cell, overflowWrap: "anywhere" }}>{u.fileName}</td>
                        <td style={cell}>{formatBytes(u.sizeBytes)}</td>
                        <td style={cell}>
                          <span className={`ae-dash-chip ae-dash-chip--${u.status === "OK" ? "done" : "bad"}`} title={u.error ?? undefined}>
                            {u.status === "OK" ? "Saved" : "Failed"}
                          </span>
                          {u.status === "FAILED" && u.error && (
                            <div style={{ fontSize: "calc(11.5px * var(--ae-fs, 1))", color: colors.danger, marginTop: 2, overflowWrap: "anywhere" }}>{u.error}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <Toast
        id="drive-backup-running"
        message={busy === "backup" && !backupToastClosed ? <InlineLoading size="sm" label="Backing up to Google Drive…" /> : null}
        onDismiss={() => setBackupToastClosed(true)}
        variant="info"
        duration={null}
        // The spinner in the message is the indicator; the "i" badge would be a second icon.
        hideIcon
      />
      <Toast message={notice} onDismiss={() => setNotice(null)} variant="success" />
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </div>
  );
}
