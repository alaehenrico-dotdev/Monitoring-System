import { receiptRepository } from "../repositories/receiptRepository";
import { recordChange } from "./changeLog.service";
import { addFulfillmentFromReceipt } from "./dailyOnlineStock.service";
import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";

const TABLE = "receipts";

export interface ReceiptItemInput {
  productId: number;
  quantity: number;
}

export interface CreateReceiptInput {
  orderDate: Date;
  customer: string;
  location: string;
  /// Free text - not necessarily a system user (Section 4.7).
  salesRepName?: string;
  items: ReceiptItemInput[];
  postToFulfillment?: boolean;
}

/**
 * Section 4.7 - Receipt / Sales Order Entry. Each receipt records an order
 * date, customer, delivery location, sales rep, and one line per SKU. Saving
 * a receipt can optionally post the ordered quantities straight into that
 * date's Online Fulfillment (Out) column (Section 4.7 / 6, step 4), so the
 * two no longer have to be reconciled by hand (Section 2.1).
 */
export async function createReceipt(input: CreateReceiptInput, createdById?: number) {
  if (!input.items.length) throw HttpError.badRequest("A receipt needs at least one order item");

  const receipt = await receiptRepository.create({
    orderDate: input.orderDate,
    customer: input.customer,
    location: input.location,
    salesRepName: input.salesRepName,
    createdById,
    items: input.items,
  });

  await recordChange({ tableName: TABLE, recordId: receipt.id, action: "CREATE", changedById: createdById, newValue: receipt });

  const shouldPost = input.postToFulfillment ?? env.receiptsAutoPostDefault;
  if (shouldPost) {
    for (const item of input.items) {
      await addFulfillmentFromReceipt(item.productId, input.orderDate, item.quantity, createdById);
    }
  }

  return receipt;
}

export async function listReceipts(filters: { date?: Date; customer?: string; location?: string; salesRepId?: number }) {
  return receiptRepository.findMany(filters);
}

export async function getReceiptById(id: number) {
  const receipt = await receiptRepository.findById(id);
  if (!receipt) throw HttpError.notFound("Receipt not found");
  return receipt;
}
