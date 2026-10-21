import { getToken } from "../api/http";
import { getDriveExportConfig, uploadExportCopy } from "../api/drive";

/// The server refuses bigger bodies, so do not send them at all.
export const MAX_COPY_BYTES = 30 * 1024 * 1024;
/// How long "should I send copies?" is remembered, so a burst of exports asks
/// once, and a switch flipped in Settings reaches every browser soon after.
const CONFIG_TTL_MS = 60_000;

let cached: { saveExports: boolean; at: number } | null = null;
let asking: Promise<boolean> | null = null;

async function shouldCopy(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.saveExports;
  asking ??= getDriveExportConfig()
    .then((c) => c.saveExports)
    // Unreachable server or no Drive: no copy, and ask again shortly.
    .catch(() => false)
    .then((saveExports) => {
      cached = { saveExports, at: Date.now() };
      return saveExports;
    })
    .finally(() => {
      asking = null;
    });
  return asking;
}

/// Forget what the server said (after Settings changes it, and between tests).
export function resetDriveCopyConfig(): void {
  cached = null;
  asking = null;
}

/**
 * Sends a copy of a file the person just downloaded to Google Drive, if the
 * admin has connected Drive and left "save export copies" on.
 *
 * Fire-and-forget by design: the download has already happened, and a slow or
 * failed upload must never delay it, throw into the export that called this,
 * or show the person an error about something they did not ask for. Failures
 * that reach the server are recorded on Settings > Google Drive; a request that
 * never got there is only logged to the console.
 */
export function copyExportToDrive(filename: string, blob: Blob): void {
  if (!getToken() || blob.size === 0 || blob.size > MAX_COPY_BYTES) return;
  void (async () => {
    try {
      if (await shouldCopy()) await uploadExportCopy(filename, blob);
    } catch (err) {
      console.warn("Could not save a copy to Google Drive:", err);
    }
  })();
}
