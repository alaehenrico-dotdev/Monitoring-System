import type { Request, Response } from "express";
import { streamDatabaseBackup } from "../services/backup.service";

export async function getBackupDownload(_req: Request, res: Response) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.setHeader("Content-Type", "application/sql");
  res.setHeader("Content-Disposition", `attachment; filename="ala-eh-backup-${stamp}.sql"`);

  try {
    await streamDatabaseBackup(res);
    res.end();
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
