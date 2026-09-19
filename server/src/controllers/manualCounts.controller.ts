import type { Request, Response } from "express";
import { z } from "zod";
import { StockLocation } from "@prisma/client";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import { HttpError } from "../utils/HttpError";
import { getManualCountGrid, getVarianceReport, saveManualCount } from "../services/manualCounts.service";

const locationSchema = z.nativeEnum(StockLocation);
const entrySchema = z.object({ manualCount: z.number().min(0) });

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

  res.json(await saveManualCount(productId, entryDate, shift, location, parsed.data.manualCount, req.user?.id));
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
