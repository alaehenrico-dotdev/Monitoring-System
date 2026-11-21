import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import {
  COUNT_LOCATIONS,
  MAX_NOTE_LENGTH,
  editMySubmission,
  getMySubmission,
  listMyHistory,
  listSubmissionsForSheet,
  reopenSubmissions,
  saveDraftLines,
  submitMySubmission,
} from "../services/countSubmission.service";

/// Most lines one save may carry: the whole product list, both locations, with room to spare.
const MAX_LINES_PER_SAVE = 1000;
/// Decimal(14,2) holds up to 12 whole digits; counts are far below that, this just keeps junk out.
const MAX_QTY = 999_999_999.99;

const lineSchema = z.object({
  productId: z.number().int().positive(),
  location: z.enum(COUNT_LOCATIONS),
  qty: z.number().min(0).max(MAX_QTY).nullable(),
  note: z.string().max(MAX_NOTE_LENGTH).nullable(),
});
const saveSchema = z.object({ lines: z.array(lineSchema).min(1).max(MAX_LINES_PER_SAVE) });
const submitSchema = z.object({ allowEmptyLocation: z.boolean().optional() });
const reopenSchema = z.object({
  auditorIds: z.array(z.number().int().positive()).min(1).max(20),
  reason: z.string().max(500).nullable().optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? `Invalid ${what}`, parsed.error.flatten());
  return parsed.data;
}

const sheetOf = (req: Request) => ({
  entryDate: parseDateOnly(req.query.date ?? req.body?.date),
  shift: parseShift(req.query.shift ?? req.body?.shift),
});

function auditorId(req: Request): number {
  if (!req.user) throw HttpError.unauthorized();
  return req.user.id;
}

/// GET /count-submissions/mine?date&shift - the signed-in auditor's own draft (nobody else's).
export async function getMine(req: Request, res: Response) {
  const { entryDate, shift } = sheetOf(req);
  res.json(await getMySubmission(auditorId(req), entryDate, shift));
}

/// PUT /count-submissions/mine/lines - save the lines that changed.
export async function putMyLines(req: Request, res: Response) {
  const { entryDate, shift } = sheetOf(req);
  const { lines } = parse(saveSchema, req.body, "count lines");
  res.json(await saveDraftLines(auditorId(req), entryDate, shift, lines));
}

/// POST /count-submissions/mine/submit - send both locations. 409 with `emptyLocations` when one has
/// nothing counted and `allowEmptyLocation` was not sent.
export async function postMySubmit(req: Request, res: Response) {
  const { entryDate, shift } = sheetOf(req);
  const { allowEmptyLocation } = parse(submitSchema, req.body ?? {}, "submit request");
  res.json(await submitMySubmission(auditorId(req), entryDate, shift, allowEmptyLocation === true));
}

/// GET /count-submissions?date&shift - every auditor's submission for the sheet (admin).
export async function getSubmissions(req: Request, res: Response) {
  const { entryDate, shift } = sheetOf(req);
  res.json(await listSubmissionsForSheet(entryDate, shift));
}

/// POST /count-submissions/reopen - send the chosen auditors' submitted counts back as drafts (admin).
export async function postReopen(req: Request, res: Response) {
  const { entryDate, shift } = sheetOf(req);
  const { auditorIds, reason } = parse(reopenSchema, req.body, "reopen request");
  res.json(await reopenSubmissions(entryDate, shift, [...new Set(auditorIds)], reason ?? null, req.user?.id));
}

/// POST /count-submissions/mine/edit - take the auditor's own submitted count back to edit it (until the sheet is published).
export async function postMyEdit(req: Request, res: Response) {
  const { entryDate, shift } = sheetOf(req);
  res.json(await editMySubmission(auditorId(req), entryDate, shift));
}

/// GET /count-submissions/mine/history - the auditor's own recent counts.
export async function getMyHistory(req: Request, res: Response) {
  res.json(await listMyHistory(auditorId(req)));
}
