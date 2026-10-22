import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getEntryRules, setEntryRules } from "../services/appSettings.service";

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
