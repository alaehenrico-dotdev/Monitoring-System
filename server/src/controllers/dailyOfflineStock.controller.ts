import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { getOfflineGrid, saveOfflineEntry } from "../services/dailyOfflineStock.service";

const entrySchema = z.object({
  stockInOlToOff: z.number().min(0).optional(),
  stockOutOffToOl: z.number().min(0).optional(),
  productionIn: z.number().min(0).optional(),
  deliveryOut: z.number().min(0).optional(),
  backloads: z.number().min(0).optional(),
  // See dailyOnlineStock.controller.ts's entrySchema - same reasoning.
  openingStock: z.number().optional(),
});

export async function getOfflineStockGrid(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  res.json(await getOfflineGrid(entryDate));
}

export async function putOfflineStockEntry(req: Request, res: Response) {
  const productId = Number(req.params.productId);
  const entryDate = parseDateOnly(req.query.date ?? req.body?.date);
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid offline stock entry", parsed.error.flatten());

  const saved = await saveOfflineEntry(productId, entryDate, parsed.data, req.user?.id);
  res.json(saved);
}
