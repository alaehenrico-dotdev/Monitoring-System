import { createReadStream } from "fs";
import { rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  createFolder,
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
  return {
    configured: isConfigured(),
    redirectUri: env.googleRedirectUri,
    connected: Boolean(conn),
    accountEmail: conn?.accountEmail ?? null,
    connectedAt: conn?.connectedAt ?? null,
    lastBackupAt: conn?.lastBackupAt ?? null,
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
    return { fileName, sizeBytes: summary.sizeBytes };
  } catch (err) {
    // Recorded as a failed backup too, so the existing "last backup failed /
    // overdue" warnings in the admin queue see it like any other.
    await recordBackup({ fileName, trigger, status: "FAILED", error: messageOf(err), createdById: userId });
    await logUpload({ kind: "backup", fileName, status: "FAILED", error: messageOf(err), createdById: userId });
    if (!(err instanceof DriveAuthError)) await noteError(messageOf(err));
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

// --- Schedule -----------------------------------------------------------------

/// A backup is due when the most recent scheduled time (today's `hourUtc`, or
/// yesterday's if that hasn't happened yet) has passed with no backup since.
/// "Hours since the last one" would instead fire again a few hours early
/// whenever the hour is changed.
export function isBackupDue(
  conn: { autoBackup: boolean; backupHourUtc: number; lastBackupAt: Date | null },
  now: Date,
): boolean {
  if (!conn.autoBackup) return false;
  let slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), conn.backupHourUtc);
  if (now.getTime() < slot) slot -= 24 * HOUR_MS;
  return !conn.lastBackupAt || conn.lastBackupAt.getTime() < slot;
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
  kind: "backup" | "export";
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
