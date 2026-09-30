import type { Request, Response } from "express";
import { restoreDatabaseFromStream, streamDatabaseBackup } from "../services/backup.service";
import { assertValidResetToken } from "../services/dataReset.service";
import { HttpError } from "../utils/HttpError";

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
  return `ala-eh-backup-${date}-${time}.sql`;
}

export async function getBackupDownload(_req: Request, res: Response) {
  try {
    await streamDatabaseBackup(res, backupFileName());
  } catch (err) {
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
  assertValidResetToken(token, req.user!);

  await restoreDatabaseFromStream(req);
  res.json({ success: true });
}
