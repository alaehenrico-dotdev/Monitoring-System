import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { listExtraLabels, saveExtraLabel, MAX_LABEL_LENGTH } from "../services/extraColumnLabels.service";

const locationSchema = z.enum(["ONLINE", "OFFLINE"]);

const putSchema = z.object({
  location: locationSchema,
  columnKey: z.string().min(1).max(64),
  slotIndex: z.number().int().min(1),
  label: z.string().max(MAX_LABEL_LENGTH + 20),
});

/// Open to every role: the names are part of what an encoder sees on the sheet.
export async function getExtraLabels(req: Request, res: Response) {
  const location = locationSchema.safeParse(req.query.location);
  if (!location.success) throw HttpError.badRequest("location must be ONLINE or OFFLINE");
  res.json(await listExtraLabels(location.data, parseDateOnly(req.query.date), parseShift(req.query.shift)));
}

export async function putExtraLabel(req: Request, res: Response) {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid column name", parsed.error.flatten());
  res.json(
    await saveExtraLabel(
      { ...parsed.data, entryDate: parseDateOnly(req.body?.date), shift: parseShift(req.body?.shift) },
      req.user?.id,
    ),
  );
}
