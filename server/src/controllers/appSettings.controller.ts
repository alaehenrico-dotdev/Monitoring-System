import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getEntryRules, getReportOptions, setEntryRules, setReportOptions } from "../services/appSettings.service";

export async function getEntryRulesHandler(_req: Request, res: Response) {
  res.json(await getEntryRules());
}

/// The one rule every role needs (the entry pages change shape with it), so it
/// has its own read; the full rules stay Supervisor/Admin only.
export async function getShiftModeHandler(_req: Request, res: Response) {
  res.json({ useShifts: (await getEntryRules()).useShifts });
}

const entryRulesSchema = z
  .object({ requireEarlierDaysFinished: z.boolean(), useShifts: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export async function patchEntryRulesHandler(req: Request, res: Response) {
  const parsed = entryRulesSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid entry rules", parsed.error.flatten());
  res.json(await setEntryRules(parsed.data, req.user!.id));
}

export async function getReportOptionsHandler(_req: Request, res: Response) {
  res.json(await getReportOptions());
}

const reportOptionsSchema = z
  .object({ hideEmptyRows: z.boolean(), hideEmptyColumns: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export async function patchReportOptionsHandler(req: Request, res: Response) {
  const parsed = reportOptionsSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid report options", parsed.error.flatten());
  res.json(await setReportOptions(parsed.data, req.user!.id));
}
