import type { Request, Response } from "express";
import { z } from "zod";
import { StockLocation } from "@prisma/client";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { deleteManualCount, getManualCountGrid, getSystemRemainingStock, getVarianceReport, saveManualCount } from "../services/manualCounts.service";

const locationSchema = z.nativeEnum(StockLocation);
const entrySchema = z.object({
  // null clears a count that didn't exist before this save (the client's
  // Undo needs this - reverting a save that *created* a count has nothing
  // to restore it to but absent). Goes through deleteManualCount below,
  // same as reverting a CSV import.
  manualCount: z.number().min(0).nullable(),
  // Set only when this save comes from a confirmed CSV import (see
  // CsvTools.tsx) - tags the resulting change_log row so Import History can
  // later find and, if needed, revert exactly this write (see
  // importBatch.service.ts). Never trusted as proof an import actually
  // happened - just a label on the one row it produces.
  importBatchId: z.number().int().positive().optional(),
});

export async function getManualCounts(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  const shift = parseShift(req.query.shift);
  const location = locationSchema.parse(req.query.location ?? "ONLINE");
  res.json(await getManualCountGrid(entryDate, shift, location));
}

export async function putManualCount(req: Request, res: Response) {
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw HttpError.badRequest("Invalid product id");
  const entryDate = parseDateOnly(req.query.date ?? req.body?.date);
  const shift = parseShift(req.query.shift ?? req.body?.shift);
  const location = locationSchema.parse(req.query.location ?? req.body?.location);
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid manual count entry", parsed.error.flatten());

  if (parsed.data.manualCount === null) {
    await deleteManualCount(productId, entryDate, shift, location, req.user?.id);
    // Same shape getManualCountGrid uses for a product with no saved count -
    // the client merges this response the same way either way.
    const systemRemainingStock = await getSystemRemainingStock(productId, entryDate, shift, location);
    res.json({ productId, entryDate, shift, location, systemRemainingStock, manualCount: null, variance: null });
    return;
  }

  res.json(
    await saveManualCount(productId, entryDate, shift, location, parsed.data.manualCount, req.user?.id, parsed.data.importBatchId),
  );
}

export async function getVarianceReportHandler(req: Request, res: Response) {
  const startDate = parseDateOnly(req.query.startDate);
  const endDate = parseDateOnly(req.query.endDate);
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const location = req.query.location ? locationSchema.parse(req.query.location) : undefined;
  const shift = req.query.shift ? parseShift(req.query.shift) : undefined;
  const flaggedOnly = req.query.flaggedOnly !== "false";

  res.json(await getVarianceReport({ startDate, endDate, productId, category, location, shift, flaggedOnly }));
}
