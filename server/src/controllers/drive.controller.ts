import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { DriveApiError, DriveAuthError } from "../lib/googleDrive";
import { HttpError } from "../utils/HttpError";
import { parseDateOnly } from "../utils/date";
import {
  completeConnect,
  disconnect,
  exportConfig,
  getStatus,
  runBackup,
  saveExport,
  saveGeneratedReport,
  startConnect,
  updateSettings,
} from "../services/drive.service";

/// Google's own failures reach the admin as readable messages, not a bare 500:
/// revoked access is something they can fix (reconnect), anything else is a
/// problem on Google's side of the call.
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof DriveAuthError) throw HttpError.badRequest(err.message);
    if (err instanceof DriveApiError) throw new HttpError(502, err.message);
    throw err;
  }
}

export async function getDriveStatus(_req: Request, res: Response) {
  res.json(await getStatus());
}

export async function postDriveConnect(req: Request, res: Response) {
  res.json({ url: startConnect(req.user!.id) });
}

/// Where Google sends the browser after the consent screen. No login header is
/// possible on a redirect, so the request is trusted only through the signed,
/// short-lived `state` an admin's own Connect click created. The browser is
/// sent back to Settings (on the origin it arrived at) with the outcome.
export async function getDriveCallback(req: Request, res: Response) {
  const back = (outcome: string, reason?: string) => {
    const target = new URL("/settings", new URL(env.googleRedirectUri).origin);
    target.searchParams.set("drive", outcome);
    if (reason) target.searchParams.set("reason", reason.slice(0, 200));
    res.redirect(target.toString());
  };

  const { code, state, error } = req.query;
  if (typeof error === "string") return back("denied");
  if (typeof code !== "string" || typeof state !== "string") return back("error", "Google did not send back the expected details.");
  try {
    await guarded(() => completeConnect(code, state));
    return back("connected");
  } catch (err) {
    // Only this app's own, deliberately worded errors go into the URL (it lands in
    // browser history and proxy logs). Anything else - a database or library
    // error - is logged here and shown as a generic message.
    if (err instanceof HttpError) return back("error", err.message);
    console.error(JSON.stringify({ level: "error", event: "drive-connect-failed", message: err instanceof Error ? err.message : String(err) }));
    return back("error", "Could not connect Google Drive. Try again, and check the server log if it keeps failing.");
  }
}

const settingsSchema = z
  .object({
    autoBackup: z.boolean(),
    backupWeekday: z.number().int().min(0).max(6),
    backupHourUtc: z.number().int().min(0).max(23),
    keepBackups: z.number().int().min(1).max(365),
    saveExports: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export async function patchDriveSettings(req: Request, res: Response) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid Google Drive settings", parsed.error.flatten());
  await updateSettings(parsed.data, req.user!.id);
  res.json(await getStatus());
}

export async function postDriveDisconnect(req: Request, res: Response) {
  await disconnect(req.user!.id);
  res.json(await getStatus());
}

export async function postDriveBackupNow(req: Request, res: Response) {
  const result = await guarded(() => runBackup("manual", req.user!.id));
  res.json({ ...result, status: await getStatus() });
}

/// Any signed-in role: every role can export, so every browser needs to know
/// whether to send a copy.
export async function getDriveExportConfig(_req: Request, res: Response) {
  res.json(await exportConfig());
}

export async function postDriveExportCopy(req: Request, res: Response) {
  const header = req.header("x-filename");
  let name = "";
  try {
    name = header ? decodeURIComponent(header) : "";
  } catch {
    throw HttpError.badRequest("The file name was not valid");
  }
  if (!name) throw HttpError.badRequest("Send the file name in the X-Filename header");
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw HttpError.badRequest("The file was empty");
  res.json(await guarded(() => saveExport(name, req.body as Buffer, req.user!.id)));
}

const generatedReportSchema = z.object({ date: z.string() });

/// "Generate" was confirmed on the Daily Report page: save that date's report to
/// Drive. Every role can generate the report, so every role can ask; the file it
/// writes is the report itself, never anything the caller sends.
export async function postDriveGeneratedReport(req: Request, res: Response) {
  const parsed = generatedReportSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Expected a report `date`", parsed.error.flatten());
  const date = parseDateOnly(parsed.data.date);
  res.json({ status: await guarded(() => saveGeneratedReport(date, req.user!.id)) });
}
