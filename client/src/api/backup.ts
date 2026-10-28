import { API_URL, ApiError, getToken, http } from "./http";
import { saveBlob } from "../utils/saveBlob";
import { localDateStamp } from "../utils/dateFormat";
import { requestAdminPassword } from "../utils/passwordPrompt";

/// "pre-restore" marks the safety copy taken just before a restore, so the
/// backup history can tell it apart from a routine download.
export type BackupPurpose = "pre-restore";

export interface BackupReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  sizeBytes: number;
  sha256: string;
  tableCount: number;
  missingTables: string[];
  known: { id: number; fileName: string; createdAt: string } | null;
}

export interface BackupRecord {
  id: number;
  fileName: string;
  trigger: "manual" | "scheduled" | "pre-restore" | "pre-migration";
  status: "OK" | "FAILED" | "INVALID";
  sizeBytes: number | null;
  sha256: string | null;
  error: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface BackupHistory {
  records: BackupRecord[];
  files: BackupFile[];
  health: {
    lastBackupAt: string | null;
    overdue: boolean;
    overdueHours: number;
    failedSince: { createdAt: string; fileName: string; error: string | null } | null;
  };
}

export function getBackupHistory() {
  return http.get<BackupHistory>("/backup/history");
}

export function verifyBackupFileByName(name: string) {
  return http.post<BackupReport & { fileName: string }>("/backup/verify-file", { name });
}

/// Pre-restore check: the server reads the file (nothing is written to the
/// database) and reports whether it is complete and restorable. The file goes
/// up raw, like the restore itself, so this bypasses the JSON helper.
export async function validateBackupFile(file: File): Promise<BackupReport> {
  const token = getToken();
  const res = await fetch(`${API_URL}/backup/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/sql", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Couldn't check that file");
  return body as BackupReport;
}

/**
 * Database Backup - GET /backup/download streams a raw `mysqldump` file, not
 * JSON, so this bypasses the shared `http` helper (which always expects a
 * JSON body) and drives fetch()/streaming directly.
 *
 * The server can't report a `Content-Length` (mysqldump's output size isn't
 * known ahead of time - see backup.controller.ts), so there's no "percent of
 * total" to bind to. `onProgress` instead reports real bytes actually
 * received off the network, read chunk-by-chunk via the stream reader
 * (Section: Loading system - "if real progress data is available, bind to
 * it" still applies even when the *total* isn't knowable, just not as a
 * clean 0-100 percentage) - DatabaseBackupPage turns that into a growing
 * byte counter plus a bar that eases toward, but never quite reaches, 100%.
 */
export async function downloadDatabaseBackup(
  onProgress?: (bytesReceived: number) => void,
  purpose?: BackupPurpose,
): Promise<void> {
  const { blob, filename } = await fetchDatabaseBackup(onProgress, purpose);
  saveBlob(blob, filename);
}

/**
 * Pulls the dump into memory without saving it - what the end-of-day pack
 * needs, since it bundles the dump with the reports into one download.
 * downloadDatabaseBackup above is just this plus the save.
 */
export async function fetchDatabaseBackup(
  onProgress?: (bytesReceived: number) => void,
  purpose?: BackupPurpose,
): Promise<{ blob: Blob; filename: string }> {
  const token = getToken();
  // The server re-checks the signed-in admin's password for every download;
  // a wrong one asks again rather than failing the whole backup.
  let message = "Enter your password to download the database.";
  let res: Response;
  for (;;) {
    const password = await requestAdminPassword(message);
    if (password === null) throw new Error("Backup cancelled - password not entered.");
    res = await fetch(`${API_URL}/backup/download${purpose ? `?purpose=${purpose}` : ""}`, {
      headers: { "X-Admin-Password": password, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.status !== 403) break;
    message = "Incorrect password. Try again.";
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Failed to download backup");
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  // Same kebab-case date-time style as the server's real filename (see
  // backup.controller.ts's backupFileName) - this fallback should now only
  // ever fire for a genuinely non-CORS-exposed deployment, not the normal
  // case (see app.ts's `exposedHeaders`).
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  // Local date and time, like the server's own file name.
  const fallbackStamp = `${localDateStamp(now)}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename =
    /filename="?([^"]+)"?/.exec(disposition)?.[1] ??
    `ala-eh-backup-${fallbackStamp}.sql`;

  const blob = await readWithProgress(res, onProgress);
  // A dump is never legitimately empty - saving a 0-byte "backup" (and, for
  // Data Reset, going on to wipe the data after it) would be worse than failing.
  if (blob.size === 0) throw new Error("The server returned an empty backup.");
  return { blob, filename };
}

async function readWithProgress(
  res: Response,
  onProgress?: (bytesReceived: number) => void,
): Promise<Blob> {
  const reader = res.body?.getReader();
  // Older browsers (or a response body already consumed) - fall back to the
  // plain, all-at-once path with no progress signal rather than failing.
  if (!reader) return res.blob();

  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received);
  }
  return new Blob(chunks);
}

/**
 * Database Restore - uploads a `.sql` file made by downloadDatabaseBackup to
 * POST /backup/restore, which replaces the live database with it. The body is
 * the raw file (not JSON), so this uses XMLHttpRequest for real upload
 * progress. `resetToken` is the same short-lived passcode token Data Reset
 * uses (verifyResetPasscode in api/dataReset.ts) - enforced server-side.
 */
export function restoreDatabaseBackup(
  file: File,
  resetToken: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/backup/restore`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("X-Reset-Token", resetToken);
    xhr.setRequestHeader("Content-Type", "application/sql");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(new Error("Network error - the restore did not complete."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "Failed to restore backup";
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {
        // non-JSON error body - keep the generic message
      }
      reject(new ApiError(xhr.status, message));
    };
    xhr.send(file);
  });
}
