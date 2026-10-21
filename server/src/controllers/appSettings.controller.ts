import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getEntryRules, setEntryRules } from "../services/appSettings.service";

export async function getEntryRulesHandler(_req: Request, res: Response) {
  res.json(await getEntryRules());
}

const entryRulesSchema = z
  .object({ requireEarlierDaysFinished: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export async function patchEntryRulesHandler(req: Request, res: Response) {
  const parsed = entryRulesSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid entry rules", parsed.error.flatten());
  res.json(await setEntryRules(parsed.data, req.user!.id));
}
