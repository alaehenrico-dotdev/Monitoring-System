import { API_URL, ApiError, getToken } from "./http";

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
export async function downloadDatabaseBackup(onProgress?: (bytesReceived: number) => void): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/backup/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Failed to download backup");
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  // Same kebab-case date-time style as the server's real filename (see
  // backup.controller.ts's backupFileName) - this fallback should now only
  // ever fire for a genuinely non-CORS-exposed deployment, not the normal
  // case (see app.ts's `exposedHeaders`).
  const fallbackStamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? `ala-eh-backup-${fallbackStamp}.sql`;

  const blob = await readWithProgress(res, onProgress);
  // A dump is never legitimately empty - saving a 0-byte "backup" (and, for
  // Data Reset, going on to wipe the data after it) would be worse than failing.
  if (blob.size === 0) throw new Error("The server returned an empty backup.");

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the save in some browsers (the download
  // starts asynchronously after click()) - which for a large dump meant a
  // missing or empty file. Give it time to be picked up first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function readWithProgress(res: Response, onProgress?: (bytesReceived: number) => void): Promise<Blob> {
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
export function restoreDatabaseBackup(file: File, resetToken: string, onProgress?: (fraction: number) => void): Promise<void> {
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
    xhr.onerror = () => reject(new Error("Network error - the restore did not complete."));
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
