import type { Request, Response } from "express";
import { applyPendingMigrations, restoreDatabaseFromStream, streamDatabaseBackup } from "../services/backup.service";
import { assertValidResetToken, consumeResetToken, releaseResetToken, reserveResetToken } from "../services/dataReset.service";
import { logSystemEvent } from "../services/changeLog.service";
import { keepDriveConnectionAcross } from "../services/drive.service";
import { keepUserAccountsAcross } from "../services/userAccounts.service";
import { env } from "../config/env";
import { createBackupDecryptor } from "../utils/backupCrypto";
import { HttpError } from "../utils/HttpError";
import { assertAdminPassword } from "../services/adminPassword.service";
import {
  backupHealth,
  buildReport,
  inspectDump,
  listBackupFiles,
  listBackupHistory,
  recordBackup,
  verifyBackupFile,
} from "../services/backupVerify.service";

// Matches every other export's filename style across the app (e.g.
// "total-stocks-2026-09-30.xls", "online-stock-2026-09-30-morning.pdf" -
// see client/src/utils/pdfTables.ts's pdfFileName) - a plain kebab-case
// date/time, not a raw ISO timestamp ("2026-09-30T14-32-10-123Z") the way
// this used to read. Still down to the minute (not just the date) so two
// backups taken the same day don't collide.
function backupFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  return `ala-eh-backup-${date}-${time}${env.backupEncryptionKey ? ".sql.enc" : ".sql"}`;
}

/// A database dump holds everything, so on top of SUPERVISOR_ADMIN the download
/// asks for the signed-in admin's own password again (X-Admin-Password header -
/// the response is a file stream, and a password must not sit in a URL).
export async function getBackupDownload(req: Request, res: Response) {
  await assertAdminPassword(req.user!.id, req.header("x-admin-password"));
  // A full database dump must never sit in any cache.
  res.setHeader("Cache-Control", "no-store");
  const fileName = backupFileName();
  // The Restore page takes a safety copy first and says so, so history can tell
  // it apart from a routine download.
  const trigger = req.query.purpose === "pre-restore" ? "pre-restore" : "manual";
  try {
    const summary = await streamDatabaseBackup(res, fileName);
    await recordBackup({
      fileName,
      trigger,
      status: summary.complete ? "OK" : "INVALID",
      sizeBytes: summary.sizeBytes,
      sha256: summary.sha256,
      error: summary.complete ? undefined : 'mysqldump finished without its closing "Dump completed" line.',
      createdById: req.user?.id,
      verified: true,
    });
    await logSystemEvent("backup_download", { fileName }, req.user?.id);
  } catch (err) {
    await recordBackup({ fileName, trigger, status: "FAILED", error: err instanceof Error ? err.message : String(err), createdById: req.user?.id });
    // Once mysqldump has started streaming, the response headers/body are
    // already committed - there's no way to turn that into a clean JSON
    // error at this point, so the best we can do is drop the connection and
    // let the client see an incomplete/failed download.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    throw err;
  }
}

/// Restore replaces the whole database, so on top of SUPERVISOR_ADMIN it needs
/// the same short-lived passcode token Data Reset uses (POST
/// /data-reset/verify-passcode). It travels in a header because the request
/// body is the raw .sql file itself.
export async function postRestore(req: Request, res: Response) {
  const token = req.header("x-reset-token");
  if (!token) throw HttpError.unauthorized("Restore passcode required - unlock this page first");
  const tokenId = assertValidResetToken(token, req.user!);
  reserveResetToken(tokenId);
  try {
    // The file replaces every table, so two things of this server's own are kept:
    // the user accounts (passwords, roles, MFA - a restore must never change who can
    // sign in or with what), and the Drive connection (a stale or foreign token in
    // the file must not replace it).
    await keepUserAccountsAcross(async () => {
      await keepDriveConnectionAcross(() => restoreDatabaseFromStream(req));
      // The tables are replaced now, so the passcode is spent even if the
      // update below fails - a retry would restore the file all over again.
      consumeResetToken(tokenId);
      // An older backup has an older table layout; bring it up to this version
      // (before the accounts go back, so the users table has its current columns).
      await applyPendingMigrations();
    });
    // Written into the restored database, so it is the first line of its history.
    await logSystemEvent("backup_restore", {}, req.user?.id, "UPDATE");
    res.json({ success: true });
  } catch (err) {
    releaseResetToken(tokenId);
    throw err;
  }
}

/// Backup history (what this system has taken and verified) plus whatever the
/// backup scripts left in BACKUP_DIR, and whether one is overdue or failing.
export async function getBackupHistory(_req: Request, res: Response) {
  // The folder is listed once and shared with the health check.
  const filesP = listBackupFiles();
  const [records, files, health] = await Promise.all([listBackupHistory(), filesP, filesP.then((f) => backupHealth(new Date(), f))]);
  res.json({ records, files, health });
}

/// Pre-restore check: reads an uploaded dump (raw body, like /restore) without
/// touching the database, and says whether it is safe to rely on.
export async function postValidate(req: Request, res: Response) {
  // Encrypted uploads are decrypted first, so the report describes the dump inside.
  const decrypted = req.pipe(createBackupDecryptor(env.backupEncryptionKey, { lenient: true }));
  req.on("error", (e) => decrypted.destroy(e));
  const inspection = await inspectDump(decrypted);
  res.json(await buildReport(inspection));
}

export async function postVerifyFile(req: Request, res: Response) {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!name) throw HttpError.badRequest("A backup file name is required.");
  res.json(await verifyBackupFile(name, req.user?.id));
}
