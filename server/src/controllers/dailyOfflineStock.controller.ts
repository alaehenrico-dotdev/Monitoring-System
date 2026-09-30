import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { healOpeningStocks } from "../services/manualCounts.service";
import { getOfflineGrid, saveOfflineEntry } from "../services/dailyOfflineStock.service";

const entrySchema = z.object({
  stockInOlToOff: z.number().min(0).optional(),
  stockOutOffToOl: z.number().min(0).optional(),
  productionIn: z.number().min(0).optional(),
  // Flat total (CSV import) - stored in slot 1 when no slots are given.
  deliveryOut: z.number().min(0).optional(),
  delivery1: z.number().min(0).optional(),
  delivery2: z.number().min(0).optional(),
  delivery3: z.number().min(0).optional(),
  delivery4: z.number().min(0).optional(),
  delivery5: z.number().min(0).optional(),
  backloads: z.number().min(0).optional(),
  upsellOut: z.number().min(0).optional(),
  // See dailyOnlineStock.controller.ts's entrySchema - same reasoning.
  openingStock: z.number().optional(),
});

export async function getOfflineStockGrid(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  const shift = parseShift(req.query.shift);
  await healOpeningStocks("OFFLINE", entryDate, shift, req.user?.id);
  res.json(await getOfflineGrid(entryDate, shift));
}

export async function putOfflineStockEntry(req: Request, res: Response) {
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw HttpError.badRequest("Invalid product id");
  const entryDate = parseDateOnly(req.query.date ?? req.body?.date);
  const shift = parseShift(req.query.shift ?? req.body?.shift);
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid offline stock entry", parsed.error.flatten());

  const saved = await saveOfflineEntry(productId, entryDate, shift, parsed.data, req.user?.id);
  res.json(saved);
}
