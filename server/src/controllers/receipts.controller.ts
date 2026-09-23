import type { Request, Response } from "express";
import { z } from "zod";
import { parseDateOnly } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { createReceipt, createReceiptsBatch, getLastCustomersForLocation, getReceiptById, listReceipts } from "../services/receipts.service";

const createSchema = z.object({
  orderDate: z.string(),
  customer: z.string().min(1),
  location: z.string().min(1),
  salesRepName: z.string().optional(),
  postToFulfillment: z.boolean().optional(),
  postToOfflineDelivery: z.boolean().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().finite().positive(),
        unitPrice: z.number().finite().nonnegative(),
      }),
    )
    .min(1),
});

export async function postReceipt(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid receipt payload", parsed.error.flatten());

  const { orderDate, ...rest } = parsed.data;
  const receipt = await createReceipt(
    { ...rest, orderDate: parseDateOnly(orderDate) },
    req.user?.id,
    req.user?.role,
  );
  res.status(201).json(receipt);
}

// Bulk entry (Section 4.7's Consolidated Receipt) - every receipt must post
// to Offline Delivery and only Offline Delivery, spelled out as literal
// booleans rather than left optional like createSchema's, so a batch save
// can never quietly fall back to env.receiptsAutoPostDefault or omit the
// flag by accident.
const batchItemSchema = createSchema.extend({
  postToFulfillment: z.literal(false),
  postToOfflineDelivery: z.literal(true),
});
const createBatchSchema = z.array(batchItemSchema).min(1);

export async function postReceiptsBatch(req: Request, res: Response) {
  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid receipt batch payload", parsed.error.flatten());

  const receipts = await createReceiptsBatch(
    parsed.data.map(({ orderDate, ...rest }) => ({ ...rest, orderDate: parseDateOnly(orderDate) })),
    req.user?.id,
    req.user?.role,
  );
  res.status(201).json(receipts);
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

const lastCustomersQuerySchema = z.object({
  location: z.string().min(1),
  before: z.string(),
});

// Section 4.7's Consolidated Receipt Entry pre-fill.
export async function getLastCustomers(req: Request, res: Response) {
  const parsed = lastCustomersQuerySchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid query", parsed.error.flatten());

  const customers = await getLastCustomersForLocation(parsed.data.location, parseDateOnly(parsed.data.before));
  res.json(customers);
}
