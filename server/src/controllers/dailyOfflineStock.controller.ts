import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { getOfflineGrid, saveOfflineEntry } from "../services/dailyOfflineStock.service";

const entrySchema = z.object({
  stockInOlToOff: z.number().min(0).optional(),
  stockOutOffToOl: z.number().min(0).optional(),
  productionIn: z.number().min(0).optional(),
  // Flat total (CSV-import backward compat) - ignored when
  // deliveryByDestination is also given. See resolveDeliveryOut.
  deliveryOut: z.number().min(0).optional(),
  // Partial: only the destination(s) actually being changed on this save.
  deliveryByDestination: z.record(z.string().regex(/^\d+$/, "must be a destination id"), z.number().min(0)).optional(),
  backloads: z.number().min(0).optional(),
  upsellOut: z.number().min(0).optional(),
  // See dailyOnlineStock.controller.ts's entrySchema - same reasoning.
  openingStock: z.number().optional(),
});

export async function getOfflineStockGrid(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  const shift = parseShift(req.query.shift);
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
