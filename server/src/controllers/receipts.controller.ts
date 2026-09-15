import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { createReceipt, getReceiptById, listReceipts } from "../services/receipts.service";

const createSchema = z.object({
  orderDate: z.string(),
  customer: z.string().min(1),
  location: z.string().min(1),
  salesRepName: z.string().optional(),
  postToFulfillment: z.boolean().optional(),
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().finite().positive() }))
    .min(1),
});

export async function postReceipt(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid receipt payload", parsed.error.flatten());

  const { orderDate, ...rest } = parsed.data;
  const receipt = await createReceipt({ ...rest, orderDate: parseDateOnly(orderDate) }, req.user?.id);
  res.status(201).json(receipt);
}

export async function getReceipts(req: Request, res: Response) {
  const date = req.query.date ? parseDateOnly(req.query.date) : undefined;
  const customer = typeof req.query.customer === "string" ? req.query.customer : undefined;
  const location = typeof req.query.location === "string" ? req.query.location : undefined;
  const salesRepId = req.query.salesRepId ? Number(req.query.salesRepId) : undefined;

  res.json(await listReceipts({ date, customer, location, salesRepId }));
}

export async function getReceipt(req: Request, res: Response) {
  res.json(await getReceiptById(Number(req.params.id)));
}
