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
  const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? `backup-${Date.now()}.sql`;

  const blob = await readWithProgress(res, onProgress);

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
