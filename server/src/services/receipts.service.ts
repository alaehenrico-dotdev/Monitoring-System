import { receiptRepository } from "../repositories/receiptRepository";
import { recordChange } from "./changeLog.service";
import { addFulfillmentFromReceipt } from "./dailyOnlineStock.service";
import { addDeliveryFromReceipt } from "./dailyOfflineStock.service";
import { env } from "../config/env";
import { HttpError } from "../utils/HttpError";
import { productRepository } from "../repositories/productRepository";
import { getCurrentShiftAndDate } from "../utils/shift";
import { encryptReceiptId } from "../utils/receiptQrToken";

const TABLE = "receipts";

// Adds the encrypted QR token every returned receipt needs (see
// utils/receiptQrToken.ts) - one place, so every path a Receipt can leave
// this service through (create/list/getById) carries it, rather than each
// caller having to remember to compute it.
function withQrToken<T extends { id: number }>(receipt: T): T & { qrToken: string } {
  return { ...receipt, qrToken: encryptReceiptId(receipt.id) };
}

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
  /// Mirrors postToFulfillment but posts onto the Offline pool's Delivery
  /// (Out) instead of Online's Fulfillment (Out). The two are mutually
  /// exclusive from the client (a receipt belongs to one pool or the
  /// other), but handled independently here - nothing stops both, or
  /// neither, from being true.
  postToOfflineDelivery?: boolean;
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

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await Promise.all(productIds.map((productId) => productRepository.findActiveById(productId)));
  if (products.some((product) => !product)) throw HttpError.badRequest("Receipt contains an inactive or unknown product");

  const receipt = await receiptRepository.create({
    orderDate: input.orderDate,
    customer: input.customer,
    location: input.location,
    salesRepName: input.salesRepName,
    createdById,
    items: input.items,
  });

  await recordChange({ tableName: TABLE, recordId: receipt.id, action: "CREATE", changedById: createdById, newValue: receipt });

  const shouldPostFulfillment = input.postToFulfillment ?? env.receiptsAutoPostDefault;
  const shouldPostOfflineDelivery = input.postToOfflineDelivery ?? false;
  if (shouldPostFulfillment || shouldPostOfflineDelivery) {
    // Receipts don't carry a shift of their own (orderDate has no time
    // component, and can be backdated) - posting always targets whichever
    // shift is actually open right now, the same real-time default
    // Online/Offline Entry itself uses when an encoder opens it - not a
    // shift derived from orderDate.
    const { shift } = getCurrentShiftAndDate();
    for (const item of input.items) {
      if (shouldPostFulfillment) {
        await addFulfillmentFromReceipt(item.productId, input.orderDate, shift, item.quantity, createdById);
      }
      if (shouldPostOfflineDelivery) {
        await addDeliveryFromReceipt(item.productId, input.orderDate, shift, item.quantity, createdById);
      }
    }
  }

  return withQrToken(receipt);
}

export async function listReceipts(filters: { date?: Date; customer?: string; location?: string; salesRepId?: number }) {
  const receipts = await receiptRepository.findMany(filters);
  return receipts.map(withQrToken);
}

export async function getReceiptById(id: number) {
  const receipt = await receiptRepository.findById(id);
  if (!receipt) throw HttpError.notFound("Receipt not found");
  return withQrToken(receipt);
}
