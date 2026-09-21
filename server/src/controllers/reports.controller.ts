import type { Request, Response } from "express";
import { z } from "zod";
import { StockLocation } from "@prisma/client";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { getDailyReport } from "../services/reports.service";
import { getVarianceReport } from "../services/manualCounts.service";
import { HttpError } from "../utils/HttpError";

// `startDate`/`endDate`/`shift` go through parseDateOnly/parseShift below
// (already strict, already used the same way everywhere else in the app) -
// this only covers the fields that previously had no validation at all:
// an unchecked `Number()` for productId, and a blind `as StockLocation`
// cast that let any string through as a filter value.
const varianceQuerySchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  category: z.string().min(1).optional(),
  location: z.nativeEnum(StockLocation).optional(),
  // Not z.coerce.boolean() - that coerces on JS truthiness, so the literal
  // string "false" (being non-empty) would coerce to `true`. Defaults to
  // true; the only way to opt out is passing the literal string "false".
  flaggedOnly: z.string().optional().transform((v) => v !== "false"),
});

export async function getDailyReportHandler(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  res.json(await getDailyReport(entryDate));
}

export async function getVarianceReportHandler(req: Request, res: Response) {
  const startDate = parseDateOnly(req.query.startDate);
  const endDate = parseDateOnly(req.query.endDate);
  const shift = req.query.shift ? parseShift(req.query.shift) : undefined;

  const parsed = varianceQuerySchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid variance report query", parsed.error.flatten());

  res.json(await getVarianceReport({ startDate, endDate, shift, ...parsed.data }));
}
