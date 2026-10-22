import { createReadStream } from "fs";
import { rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  createFolder,
  DriveApiError,
  DriveAuthError,
  exchangeCode,
  fetchAccountEmail,
  listFolder,
  refreshAccessToken,
  revokeToken,
  trashFile,
  uploadFile,
  buildAuthUrl,
  type OAuthClient,
} from "../lib/googleDrive";
import { HttpError } from "../utils/HttpError";
import { open, seal } from "../utils/secretBox";
import { dumpDatabaseToGzipFile } from "./backup.service";
import { recordBackup } from "./backupVerify.service";
import { logSystemEvent } from "./changeLog.service";
import { buildDailyReportWorkbook, latestEntryDate } from "./dailyReportWorkbook.service";
import { XLSX_MIME } from "../utils/xlsx";
import { toDateOnlyString } from "../utils/date";
import { setReportSavedHandler } from "../lib/reportSaved";
import { broadcastNotice } from "../lib/realtime";

/// The one Drive permission the app needs (see DRIVE_SCOPES in lib/googleDrive.ts).
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * Settings > Google Drive: one connected Google account that receives the
 * daily database backup and a copy of each Excel/CSV/PDF export.
 *
 * Connecting is a one-time OAuth consent by an admin. What is stored is the
 * refresh token (encrypted, see utils/secretBox.ts), which is what lets the
 * server upload while nobody is logged in. Access is the narrow drive.file
 * scope: the app can only see files and folders it created.
 */

const CONNECTION_ID = 1;
const BACKUP_FOLDER_NAME = "Ala Eh Monitoring - Backups";
const EXPORT_FOLDER_NAME = "Ala Eh Monitoring - Exports";
const REPORTS_FOLDER_NAME = "Ala Eh Stocks Monitoring - Reports";
/// Where the Reports folder's id is kept (app_settings, a plain key/value table),
/// so adding it needed no schema change.
const REPORTS_FOLDER_KEY = "drive.reportsFolderId";
/// Who is told, as a toast, about what the server saves to Drive on its own.
const NOTICE_ROLES = ["SUPERVISOR_ADMIN"] as const;
const STATE_TTL = "10m";
const HOUR_MS = 60 * 60 * 1000;

/// The largest export copy the server accepts (the route enforces the same).
export const MAX_EXPORT_BYTES = 30 * 1024 * 1024;

const tokenSecret = () => env.driveTokenKey || env.jwtSecret;

export function isConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

function oauthClient(): OAuthClient {
  if (!isConfigured()) throw HttpError.badRequest("Google Drive is not set up on this server - see docs/GOOGLE_DRIVE.md.");
  return { clientId: env.googleClientId, clientSecret: env.googleClientSecret, redirectUri: env.googleRedirectUri };
}

// --- Connecting -----------------------------------------------------------

// The OAuth `state`: proves the callback belongs to a connect an admin started
// in the last ten minutes. Signed with a key derived from (not equal to) the
// login secret, so a login token can never be replayed as one, or the reverse.
const stateKey = () => `${env.jwtSecret}:drive-state`;

export function startConnect(userId: number): string {
  const client = oauthClient();
  const state = jwt.sign({ purpose: "drive-connect", uid: userId }, stateKey(), { algorithm: "HS256", expiresIn: STATE_TTL });
  return buildAuthUrl(client, state);
}

function verifyState(state: string): number {
  try {
    const decoded = jwt.verify(state, stateKey(), { algorithms: ["HS256"] }) as { purpose?: string; uid?: number };
    if (decoded.purpose !== "drive-connect" || typeof decoded.uid !== "number") throw new Error("wrong purpose");
    return decoded.uid;
  } catch {
    throw HttpError.badRequest("This connect link has expired or is not valid - start again from Settings > Google Drive.");
  }
}

export async function completeConnect(code: string, state: string): Promise<void> {
  const userId = verifyState(state);
  const client = oauthClient();
  const tokens = await exchangeCode(client, code);
  if (!tokens.refreshToken) {
    throw HttpError.badRequest(
      "Google did not return a long-lived access token. Remove this app at myaccount.google.com/permissions, then connect again.",
    );
  }
  // Google's consent screen lets the person untick a permission, and the sign-in
  // still "succeeds". Without the Drive permission every upload later fails with
  // a bare 403, so say what is wrong now, while they are still at the screen.
  if (tokens.scope !== undefined && !tokens.scope.split(" ").includes(DRIVE_FILE_SCOPE)) {
    throw HttpError.badRequest(
      "Google Drive access was not granted: the permission to create files and folders was left unticked. Connect again and tick every box on Google's permission screen.",
    );
  }
  const accountEmail = await fetchAccountEmail(tokens.accessToken);

  // Reconnecting the same account (e.g. after revoking access) keeps its
  // folders and settings, so the backup history stays in one place.
  const existing = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
  const sameAccount = Boolean(existing && accountEmail && existing.accountEmail === accountEmail);
  const backupFolderId = sameAccount ? existing!.backupFolderId : await createFolder(tokens.accessToken, BACKUP_FOLDER_NAME);
  const exportFolderId = sameAccount ? existing!.exportFolderId : await createFolder(tokens.accessToken, EXPORT_FOLDER_NAME);

  const data = {
    accountEmail,
    refreshTokenEnc: seal(tokens.refreshToken, tokenSecret()),
    backupFolderId,
    exportFolderId,
    lastError: null,
    connectedById: userId,
    connectedAt: new Date(),
  };
  await prisma.driveConnection.upsert({ where: { id: CONNECTION_ID }, create: { id: CONNECTION_ID, ...data }, update: data });
  clearAccessToken();
  await logSystemEvent("drive_connected", { accountEmail }, userId);
}

export async function disconnect(userId: number): Promise<void> {
  const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
  if (!conn) return;
  try {
    await revokeToken(open(conn.refreshTokenEnc, tokenSecret()));
  } catch {
    // An unreadable token cannot be revoked; it is deleted below regardless.
  }
  await prisma.driveConnection.delete({ where: { id: CONNECTION_ID } });
  clearAccessToken();
  await logSystemEvent("drive_disconnected", { accountEmail: conn.accountEmail }, userId, "DELETE");
}

// --- Access tokens ----------------------------------------------------------

let cached: { token: string; expiresAt: number } | null = null;
const clearAccessToken = () => {
  cached = null;
};

type Connection = NonNullable<Awaited<ReturnType<typeof prisma.driveConnection.findUnique>>>;

async function requireConnection(): Promise<Connection> {
  const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
  if (!conn) throw HttpError.badRequest("Google Drive is not connected.");
  return conn;
}

/// A valid access token for `conn`, refreshed (and cached for its lifetime
/// less a minute) when needed. If Google says the access is gone, the reason
/// is stored on the connection so Settings can tell the admin to reconnect.
async function accessTokenFor(conn: Connection): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  try {
    const tokens = await refreshAccessToken(oauthClient(), open(conn.refreshTokenEnc, tokenSecret()));
    cached = { token: tokens.accessToken, expiresAt: Date.now() + (tokens.expiresIn - 60) * 1000 };
    return tokens.accessToken;
  } catch (err) {
    clearAccessToken();
    if (err instanceof DriveAuthError) await noteError(err.message);
    throw err;
  }
}

async function noteError(message: string | null): Promise<void> {
  await prisma.driveConnection
    .update({ where: { id: CONNECTION_ID }, data: { lastError: message ? message.slice(0, 500) : null } })
    .catch(() => undefined);
}

// --- Status & settings --------------------------------------------------------

export interface DriveSettings {
  autoBackup: boolean;
  backupHourUtc: number;
  keepBackups: number;
  saveExports: boolean;
}

export async function getStatus() {
  const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
  const recent = conn
    ? await prisma.driveUpload.findMany({ orderBy: { createdAt: "desc" }, take: 20 })
    : [];
  // Reports are saved on their own schedule (whenever a day is finished), so the
  // page shows when the last one landed - which the 20 newest uploads may not
  // include on a day with many exports.
  const lastReport = conn ? await prisma.driveUpload.findFirst({ where: { kind: "report", status: "OK" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
  return {
    configured: isConfigured(),
    redirectUri: env.googleRedirectUri,
    connected: Boolean(conn),
    accountEmail: conn?.accountEmail ?? null,
    connectedAt: conn?.connectedAt ?? null,
    lastBackupAt: conn?.lastBackupAt ?? null,
    lastReportAt: lastReport?.createdAt ?? null,
    nextBackupAt: conn && conn.autoBackup ? nextBackupAt(conn.backupHourUtc, new Date()) : null,
    lastError: conn?.lastError ?? null,
    settings: conn
      ? ({ autoBackup: conn.autoBackup, backupHourUtc: conn.backupHourUtc, keepBackups: conn.keepBackups, saveExports: conn.saveExports } satisfies DriveSettings)
      : null,
    recent: recent.map((u) => ({
      id: u.id,
      kind: u.kind,
      fileName: u.fileName,
      sizeBytes: u.sizeBytes === null ? null : Number(u.sizeBytes),
      status: u.status,
      error: u.error,
      createdAt: u.createdAt,
    })),
  };
}

export async function updateSettings(patch: Partial<DriveSettings>, userId: number): Promise<void> {
  await requireConnection();
  await prisma.driveConnection.update({ where: { id: CONNECTION_ID }, data: patch });
  await logSystemEvent("drive_settings", { ...patch }, userId, "UPDATE");
}

/// Whether the browser should send a copy of each export (any signed-in role).
export async function exportConfig(): Promise<{ saveExports: boolean }> {
  const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID }, select: { saveExports: true } });
  return { saveExports: Boolean(conn?.saveExports) };
}

// --- Exports ------------------------------------------------------------------

const EXPORT_TYPES: Record<string, string> = {
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  zip: "application/zip",
};

/// A safe Drive file name and its content type, or null for anything that is
/// not one of the app's own export types. The name comes from the browser, so
/// it is treated as untrusted: no path parts, no control characters, bounded.
export function exportFileInfo(rawName: string): { name: string; mimeType: string } | null {
  const base = rawName.split(/[\\/]/).pop() ?? "";
  // Filtered by character code rather than a regex: a control-character range
  // in a regex is easy to get subtly wrong, and lint rightly refuses it.
  const name = [...base]
    .filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127 && !'<>:"|?*'.includes(ch))
    .join("")
    .trim()
    .slice(-150);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!name || !(ext in EXPORT_TYPES)) return null;
  return { name, mimeType: EXPORT_TYPES[ext] };
}

export async function saveExport(rawName: string, data: Buffer, userId: number): Promise<{ saved: boolean }> {
  const info = exportFileInfo(rawName);
  if (!info) throw HttpError.badRequest("Only CSV, Excel, PDF and ZIP exports can be saved to Google Drive.");
  const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
  if (!conn || !conn.saveExports) return { saved: false };

  try {
    const id = await uploadFile(await accessTokenFor(conn), {
      name: info.name,
      parentId: conn.exportFolderId,
      mimeType: info.mimeType,
      size: data.length,
      body: data,
    });
    await logUpload({ kind: "export", fileName: info.name, driveFileId: id, sizeBytes: data.length, status: "OK", createdById: userId });
    return { saved: true };
  } catch (err) {
    await logUpload({ kind: "export", fileName: info.name, sizeBytes: data.length, status: "FAILED", error: messageOf(err), createdById: userId });
    throw err;
  }
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Backups --------------------------------------------------------------------

function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `ala-eh-backup-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.sql.gz`;
}

let backupInFlight: Promise<unknown> | null = null;

/// Dumps the database, gzips it, uploads it and trims old copies. Only one
/// runs at a time: a second request while one is working is refused rather
/// than starting a competing mysqldump.
export async function runBackup(trigger: "manual" | "scheduled", userId?: number): Promise<{ fileName: string; sizeBytes: number }> {
  if (backupInFlight) throw HttpError.conflict("A backup to Google Drive is already running.");
  const run = doBackup(trigger, userId);
  backupInFlight = run;
  try {
    return await run;
  } finally {
    backupInFlight = null;
  }
}

async function doBackup(trigger: "manual" | "scheduled", userId?: number) {
  const conn = await requireConnection();
  const fileName = backupFileName();
  const tmp = join(tmpdir(), `ala-eh-drive-${process.pid}-${Date.now()}.sql.gz`);
  try {
    const summary = await dumpDatabaseToGzipFile(tmp);
    if (!summary.complete) throw new Error('mysqldump finished without its closing "Dump completed" line.');
    const { size } = await stat(tmp);
    const id = await uploadFile(await accessTokenFor(conn), {
      name: fileName,
      parentId: conn.backupFolderId,
      mimeType: "application/gzip",
      size,
      body: createReadStream(tmp),
    });
    await recordBackup({ fileName, trigger, status: "OK", sizeBytes: summary.sizeBytes, sha256: summary.sha256, createdById: userId, verified: true });
    await logUpload({ kind: "backup", fileName, driveFileId: id, sizeBytes: summary.sizeBytes, status: "OK", createdById: userId });
    await prisma.driveConnection.update({ where: { id: CONNECTION_ID }, data: { lastBackupAt: new Date(), lastError: null } });
    await logSystemEvent("drive_backup", { fileName, trigger }, userId);
    await trimOldBackups(conn);
    await saveDailyReports(conn, userId);
    // A backup someone asked for answers them directly; only the ones the
    // schedule runs on its own need announcing.
    if (trigger === "scheduled") {
      broadcastNotice({ level: "success", message: `Google Drive backup saved: ${fileName} (${formatSize(summary.sizeBytes)}).` }, NOTICE_ROLES);
    }
    return { fileName, sizeBytes: summary.sizeBytes };
  } catch (err) {
    // Recorded as a failed backup too, so the existing "last backup failed /
    // overdue" warnings in the admin queue see it like any other.
    await recordBackup({ fileName, trigger, status: "FAILED", error: messageOf(err), createdById: userId });
    await logUpload({ kind: "backup", fileName, status: "FAILED", error: messageOf(err), createdById: userId });
    if (!(err instanceof DriveAuthError)) await noteError(messageOf(err));
    if (trigger === "scheduled") {
      broadcastNotice({ level: "error", message: `The scheduled Google Drive backup failed: ${messageOf(err)}` }, NOTICE_ROLES);
    }
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}

/// Keeps the newest `keepBackups` files in the backup folder and trashes the
/// rest. A failure here never fails the backup that just succeeded.
async function trimOldBackups(conn: Connection): Promise<void> {
  try {
    const token = await accessTokenFor(conn);
    const files = await listFolder(token, conn.backupFolderId);
    for (const old of files.slice(conn.keepBackups)) await trashFile(token, old.id);
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", event: "drive-retention-failed", message: messageOf(err) }));
  }
}

// --- Daily Report files ---------------------------------------------------------

async function findOrCreateChild(token: string, parentId: string, name: string): Promise<string> {
  const existing = (await listFolder(token, parentId)).find((f) => f.name === name);
  return existing ? existing.id : createFolder(token, name, parentId);
}

/// The Reports folder, created on first use. A remembered folder that Google no
/// longer knows (deleted, or the account was changed) is simply made again.
async function reportsRootFolder(token: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: REPORTS_FOLDER_KEY } });
  if (row) {
    try {
      await listFolder(token, row.value);
      return row.value;
    } catch (err) {
      if (!(err instanceof DriveApiError && err.status === 404)) throw err;
    }
  }
  const id = await createFolder(token, REPORTS_FOLDER_NAME);
  await prisma.appSetting.upsert({
    where: { key: REPORTS_FOLDER_KEY },
    create: { key: REPORTS_FOLDER_KEY, value: id },
    update: { value: id },
  });
  return id;
}

/// "2026-10-22" -> the day before, as a date-only value.
function dayBefore(date: Date): Date {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}

/// Uploads one day's Daily Report workbook into Reports / year / month, replacing
/// that day's earlier file. False when the day has nothing saved to report.
async function uploadDailyReport(token: string, root: string, date: Date, userId?: number): Promise<boolean> {
  const built = await buildDailyReportWorkbook(date);
  if (!built) return false;
  const [year, month] = toDateOnlyString(date).split("-");
  const folder = await findOrCreateChild(token, await findOrCreateChild(token, root, year), month);
  try {
    for (const old of (await listFolder(token, folder)).filter((f) => f.name === built.fileName)) await trashFile(token, old.id);
    const id = await uploadFile(token, { name: built.fileName, parentId: folder, mimeType: XLSX_MIME, size: built.data.length, body: built.data });
    await logUpload({ kind: "report", fileName: built.fileName, driveFileId: id, sizeBytes: built.data.length, status: "OK", createdById: userId });
  } catch (err) {
    await logUpload({ kind: "report", fileName: built.fileName, sizeBytes: built.data.length, status: "FAILED", error: messageOf(err), createdById: userId });
    throw err;
  }
  return true;
}

/**
 * Saves the Daily Report workbook of the latest day with entries, and of the day
 * before it (which is often still being finished), under
 * "Ala Eh Stocks Monitoring - Reports" / year / month. A day's file is replaced with the
 * current one each time, so Drive holds one file per day, never a pile of copies;
 * files for earlier days are left alone, so the folder becomes the archive.
 *
 * Runs after a backup that has already succeeded, so it never throws: a failure
 * here is logged and shown in the upload list, and the backup stands.
 */
export async function saveDailyReports(conn: Connection, userId?: number): Promise<void> {
  try {
    const latest = await latestEntryDate();
    if (!latest) return;
    const token = await accessTokenFor(conn);
    const root = await reportsRootFolder(token);
    for (const date of [latest, dayBefore(latest)]) await uploadDailyReport(token, root, date, userId);
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", event: "drive-reports-failed", message: messageOf(err) }));
  }
}

/// One upload at a time per day, in the order they were asked for: a correction
/// that lands while the finish-day upload is still running waits for it, so the
/// older report can never overwrite the newer one in Drive.
const reportUploads = new Map<string, Promise<void>>();

/**
 * A day's report was just saved (finished, or re-saved by a correction): put its
 * workbook in Drive now, if Drive is connected, without making the save wait for
 * it. Never throws; a failure is logged and listed on Settings > Google Drive,
 * and the nightly backup tries the recent days again.
 */
export function queueDailyReportUpload(date: Date, userId?: number): Promise<void> {
  const key = toDateOnlyString(date);
  const run = (reportUploads.get(key) ?? Promise.resolve()).then(async () => {
    try {
      const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
      if (!conn) return;
      const token = await accessTokenFor(conn);
      if (await uploadDailyReport(token, await reportsRootFolder(token), date, userId)) {
        broadcastNotice({ level: "success", message: `Daily Report for ${key} saved to Google Drive.` }, NOTICE_ROLES);
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "warn", event: "drive-report-upload-failed", date: key, message: messageOf(err) }));
      broadcastNotice({ level: "error", message: `Could not save the ${key} Daily Report to Google Drive: ${messageOf(err)}` }, NOTICE_ROLES);
    }
  });
  reportUploads.set(key, run);
  void run.finally(() => {
    if (reportUploads.get(key) === run) reportUploads.delete(key);
  });
  return run;
}

setReportSavedHandler((date) => void queueDailyReportUpload(date));

// --- Schedule -----------------------------------------------------------------

/// The scheduled backup is monthly: the last day of each month (by the UTC
/// calendar, which is what the server runs on) at `hourUtc`. `Date.UTC` rolls a
/// month of -1 or 12 over into the neighbouring year, and day 0 is the last day
/// of the month before - so no month length is spelled out anywhere.
function monthEndSlot(year: number, month: number, hourUtc: number): number {
  return Date.UTC(year, month + 1, 0, hourUtc);
}

/// The most recent scheduled time that is not in the future.
function latestBackupSlot(hourUtc: number, now: Date): number {
  const thisMonth = monthEndSlot(now.getUTCFullYear(), now.getUTCMonth(), hourUtc);
  return now.getTime() >= thisMonth ? thisMonth : monthEndSlot(now.getUTCFullYear(), now.getUTCMonth() - 1, hourUtc);
}

/// The next scheduled time after `now`.
export function nextBackupAt(hourUtc: number, now: Date): Date {
  const thisMonth = monthEndSlot(now.getUTCFullYear(), now.getUTCMonth(), hourUtc);
  return new Date(now.getTime() < thisMonth ? thisMonth : monthEndSlot(now.getUTCFullYear(), now.getUTCMonth() + 1, hourUtc));
}

/// A backup is due when the most recent end-of-month slot has passed with no
/// backup since. "A month since the last one" would instead drift (and fire
/// early whenever the hour is changed); a slot also catches up by itself after
/// downtime, and a manual "Back up now" mid-month does not bring it forward.
/// A connection that has never been backed up is due straight away, so there is
/// a first copy without waiting for the month to end.
export function isBackupDue(
  conn: { autoBackup: boolean; backupHourUtc: number; lastBackupAt: Date | null },
  now: Date,
): boolean {
  if (!conn.autoBackup) return false;
  return !conn.lastBackupAt || conn.lastBackupAt.getTime() < latestBackupSlot(conn.backupHourUtc, now);
}

/// After a failed attempt, wait this long before trying again, so a Drive
/// outage is not hammered every tick.
const RETRY_AFTER_FAILURE_MS = HOUR_MS;
let lastAttemptAt = 0;

export async function runScheduledBackupIfDue(now = new Date()): Promise<boolean> {
  const conn = await prisma.driveConnection.findUnique({ where: { id: CONNECTION_ID } });
  if (!conn || !isBackupDue(conn, now)) return false;
  if (now.getTime() - lastAttemptAt < RETRY_AFTER_FAILURE_MS) return false;
  lastAttemptAt = now.getTime();
  try {
    await runBackup("scheduled");
    return true;
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "drive-backup-failed", message: messageOf(err) }));
    return false;
  }
}

/// Test hook: forget the retry delay between attempts.
export function resetScheduleState(): void {
  lastAttemptAt = 0;
}

const TICK_MS = 10 * 60 * 1000;

export function startDriveScheduler(): () => void {
  const first = setTimeout(() => void runScheduledBackupIfDue(), 2 * 60 * 1000);
  const tick = setInterval(() => void runScheduledBackupIfDue(), TICK_MS);
  first.unref();
  tick.unref();
  return () => {
    clearTimeout(first);
    clearInterval(tick);
  };
}

// --- Shared -----------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function logUpload(input: {
  kind: "backup" | "export" | "report";
  fileName: string;
  driveFileId?: string;
  sizeBytes?: number;
  status: "OK" | "FAILED";
  error?: string;
  createdById?: number;
}): Promise<void> {
  try {
    await prisma.driveUpload.create({
      data: {
        kind: input.kind,
        fileName: input.fileName.slice(0, 200),
        driveFileId: input.driveFileId ?? null,
        sizeBytes: input.sizeBytes === undefined ? null : BigInt(input.sizeBytes),
        status: input.status,
        error: input.error ? input.error.slice(0, 500) : null,
        createdById: input.createdById ?? null,
      },
    });
  } catch (err) {
    console.error("Could not record Drive upload:", err);
  }
}
