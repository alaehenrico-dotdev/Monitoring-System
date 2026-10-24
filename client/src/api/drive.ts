import { API_URL, ApiError, getToken, http } from "./http";

export interface DriveSettings {
  autoBackup: boolean;
  /// The UTC hour (0-23) the weekly (Sunday) backup becomes due.
  backupHourUtc: number;
  keepBackups: number;
  saveExports: boolean;
}

export interface DriveUpload {
  id: number;
  kind: "backup" | "export" | "report";
  fileName: string;
  sizeBytes: number | null;
  status: "OK" | "FAILED";
  error: string | null;
  createdAt: string;
}

export interface DriveStatus {
  /// The server has a Google client id and secret.
  configured: boolean;
  /// The redirect address Google must have registered.
  redirectUri: string;
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  lastBackupAt: string | null;
  /// When the last Daily Report file was saved to Drive.
  lastReportAt: string | null;
  /// When the next scheduled (end-of-month) backup is due; null while that is switched off.
  nextBackupAt: string | null;
  /// The last thing that went wrong talking to Google (e.g. access revoked).
  lastError: string | null;
  settings: DriveSettings | null;
  recent: DriveUpload[];
}

export const getDriveStatus = () => http.get<DriveStatus>("/drive/status");
/// The Google consent address to send the browser to.
export const startDriveConnect = () => http.post<{ url: string }>("/drive/connect");
export const disconnectDrive = () => http.post<DriveStatus>("/drive/disconnect");
export const updateDriveSettings = (patch: Partial<DriveSettings>) => http.patch<DriveStatus>("/drive/settings", patch);
export const backupToDriveNow = () => http.post<{ fileName: string; sizeBytes: number; status: DriveStatus }>("/drive/backup-now");

/// What came of saving a date's Daily Report to Drive: "saved" (new or changed
/// file), "unchanged" (Drive already had exactly this one), "empty" (nothing saved
/// that day) or "not-connected".
export type GeneratedReportStatus = "saved" | "unchanged" | "empty" | "not-connected";

/// Saves the Daily Report of `date` to Google Drive - one file per date, replaced
/// when the report changed, left alone when it did not.
export const saveDailyReportToDrive = (date: string) =>
  http.post<{ status: GeneratedReportStatus }>("/drive/daily-report", { date });

/// Whether this browser should send a copy of each export (any signed-in role).
export const getDriveExportConfig = () => http.get<{ saveExports: boolean }>("/drive/export-config");

/// Sends one exported file to the server, which puts it in Google Drive. The
/// file is the request body; its name travels in a header (URL-encoded, since
/// header values are not unicode-safe).
export async function uploadExportCopy(filename: string, blob: Blob): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_URL}/drive/exports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(filename),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });
  if (!response.ok) {
    let message = "Could not save a copy to Google Drive";
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // not JSON - keep the generic message
    }
    throw new ApiError(response.status, message);
  }
}
