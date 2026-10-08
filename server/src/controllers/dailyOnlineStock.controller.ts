import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { MAX_EXTRAS_PER_COLUMN } from "../utils/stockExtras";
import { healOpeningStocks } from "../services/manualCounts.service";
import { getOnlineGrid, saveOnlineEntry } from "../services/dailyOnlineStock.service";

// Added columns' individual amounts ("Save individually" - see
// utils/stockExtras.ts). Which column keys are allowed, and that the column
// they belong to ends up equal to their sum, are the service's call: those
// are rules about the stock model, not about the request's shape.
const extrasSchema = z
  .array(
    z.object({
      columnKey: z.string().min(1).max(64),
      slotIndex: z.number().int().min(1).max(MAX_EXTRAS_PER_COLUMN),
      amount: z.number().min(0),
    }),
  )
  .max(600)
  .optional();
const clearExtraColumnsSchema = z.array(z.string().min(1).max(64)).max(32).optional();

const entrySchema = z.object({
  stockInOffToOl: z.number().min(0).optional(),
  stockOutOlToOff: z.number().min(0).optional(),
  productionIn: z.number().min(0).optional(),
  fulfillmentOut: z.number().min(0).optional(),
  rts: z.number().min(0).optional(),
  // Not user-editable in the live grid (auto-carried forward, Section 4.6)
  // but settable via CSV import (see CsvTools.tsx) to seed a real starting
  // balance on a file's first date - no .min(0), a negative opening stock
  // is a real thing a business's own external sheet can already show.
  openingStock: z.number().optional(),
  extras: extrasSchema,
  clearExtraColumns: clearExtraColumnsSchema,
});

export async function getOnlineStockGrid(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  const shift = parseShift(req.query.shift);
  await healOpeningStocks("ONLINE", entryDate, shift, req.user?.id);
  res.json(await getOnlineGrid(entryDate, shift));
}

export async function putOnlineStockEntry(req: Request, res: Response) {
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw HttpError.badRequest("Invalid product id");
  const entryDate = parseDateOnly(req.query.date ?? req.body?.date);
  const shift = parseShift(req.query.shift ?? req.body?.shift);
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid online stock entry", parsed.error.flatten());

  const saved = await saveOnlineEntry(productId, entryDate, shift, parsed.data, req.user?.id);
  res.json(saved);
}
