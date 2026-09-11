import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { getOnlineGrid, saveOnlineEntry } from "../services/dailyOnlineStock.service";

const entrySchema = z.object({
  stockInOffToOl: z.number().min(0).optional(),
  stockOutOlToOff: z.number().min(0).optional(),
  productionIn: z.number().min(0).optional(),
  fulfillmentOut: z.number().min(0).optional(),
  rts: z.number().min(0).optional(),
});

export async function getOnlineStockGrid(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  res.json(await getOnlineGrid(entryDate));
}

export async function putOnlineStockEntry(req: Request, res: Response) {
  const productId = Number(req.params.productId);
  const entryDate = parseDateOnly(req.query.date ?? req.body?.date);
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid online stock entry", parsed.error.flatten());

  const saved = await saveOnlineEntry(productId, entryDate, parsed.data, req.user?.id);
  res.json(saved);
}
