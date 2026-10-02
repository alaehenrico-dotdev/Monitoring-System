import type { Request, Response } from "express";
import { z } from "zod";
import { Shift, StockLocation } from "@prisma/client";
import { parseDateOnly } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { createImportBatch, finalizeImportBatch, listImportBatches, revertImportBatch } from "../services/importBatch.service";

const locationSchema = z.nativeEnum(StockLocation);
const shiftSchema = z.nativeEnum(Shift);

const createSchema = z.object({
  location: locationSchema,
  date: z.string(),
  shift: shiftSchema,
  fileName: z.string().min(1).max(255),
});

export async function postImportBatch(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid import batch", parsed.error.flatten());

  const batch = await createImportBatch(
    { location: parsed.data.location, entryDate: parseDateOnly(parsed.data.date), shift: parsed.data.shift, fileName: parsed.data.fileName },
    req.user?.id,
  );
  res.json({ id: batch.id });
}

const finalizeSchema = z.object({ rowCount: z.number().int().min(0) });

export async function patchImportBatch(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw HttpError.badRequest("Invalid import batch id");
  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid import batch update", parsed.error.flatten());

  await finalizeImportBatch(id, parsed.data.rowCount);
  res.status(204).end();
}

export async function getImportBatches(req: Request, res: Response) {
  const location = req.query.location ? locationSchema.parse(req.query.location) : undefined;
  res.json(await listImportBatches(location));
}

export async function deleteImportBatchHandler(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw HttpError.badRequest("Invalid import batch id");
  res.json(await revertImportBatch(id, req.user?.id));
}
