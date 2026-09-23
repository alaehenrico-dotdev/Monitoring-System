import { PostedPool, Role } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
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
  unitPrice: number;
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
export async function createReceipt(input: CreateReceiptInput, createdById?: number, createdByRole?: Role, db: Db = prisma) {
  if (!input.items.length) throw HttpError.badRequest("A receipt needs at least one order item");

  // Which pool a receipt can post into is role-gated server-side, not just
  // by what the client's UI offers: an Online Encoder only touches
  // Fulfillment (Out), an Offline Encoder only Delivery (Out), and a
  // Supervisor/Admin may post either.
  if (createdByRole === Role.ONLINE_ENCODER && input.postToOfflineDelivery) {
    throw HttpError.forbidden("Online Encoders may only post to Fulfillment");
  }
  if (createdByRole === Role.OFFLINE_ENCODER && input.postToFulfillment) {
    throw HttpError.forbidden("Offline Encoders may only post to Offline Delivery");
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await Promise.all(productIds.map((productId) => productRepository.findActiveById(productId, db)));
  if (products.some((product) => !product)) throw HttpError.badRequest("Receipt contains an inactive or unknown product");

  const shouldPostFulfillment = input.postToFulfillment ?? env.receiptsAutoPostDefault;
  const shouldPostOfflineDelivery = input.postToOfflineDelivery ?? false;
  // Both flags can be true at once (see CreateReceiptInput.postToOfflineDelivery
  // above), but postedPool records a single pool - Fulfillment takes
  // precedence, matching the posting order below.
  const postedPool: PostedPool = shouldPostFulfillment
    ? PostedPool.FULFILLMENT
    : shouldPostOfflineDelivery
      ? PostedPool.OFFLINE_DELIVERY
      : PostedPool.NONE;

  const receipt = await receiptRepository.create(
    {
      orderDate: input.orderDate,
      customer: input.customer,
      location: input.location,
      salesRepName: input.salesRepName,
      createdById,
      items: input.items,
      postedPool,
    },
    db,
  );

  await recordChange({ tableName: TABLE, recordId: receipt.id, action: "CREATE", changedById: createdById, newValue: receipt }, db);

  if (shouldPostFulfillment || shouldPostOfflineDelivery) {
    // Receipts don't carry a shift of their own (orderDate has no time
    // component, and can be backdated) - posting always targets whichever
    // shift is actually open right now, the same real-time default
    // Online/Offline Entry itself uses when an encoder opens it - not a
    // shift derived from orderDate.
    const { shift } = getCurrentShiftAndDate();
    for (const item of input.items) {
      // addFulfillmentFromReceipt isn't transaction-aware (db isn't threaded
      // through) - fine here, since it only ever runs for the single-receipt
      // path, which was never wrapped in a transaction to begin with.
      // createReceiptsBatch (below) always forces postToFulfillment: false,
      // so this branch never actually runs inside a batch's transaction.
      if (shouldPostFulfillment) {
        await addFulfillmentFromReceipt(item.productId, input.orderDate, shift, item.quantity, createdById);
      }
      if (shouldPostOfflineDelivery) {
        await addDeliveryFromReceipt(item.productId, input.orderDate, shift, item.quantity, createdById, db);
      }
    }
  }

  return withQrToken(receipt);
}

/// Section 4.7 - "Consolidated Receipt" bulk entry: many receipts for the
/// same delivery date/location, one per customer, saved together. Every
/// receipt is required to explicitly carry postToFulfillment: false and
/// postToOfflineDelivery: true (see receipts.controller.ts's zod schema) -
/// unlike the single-receipt path, nothing here falls back to
/// env.receiptsAutoPostDefault, since a bulk save has no per-receipt UI to
/// confirm a silently-defaulted pool against.
///
/// Runs as one Prisma transaction across every receipt AND everything each
/// one posts (its Change Log entry, its Offline Delivery (Out) increment,
/// and that increment's mirror onto the Online table) - so a failure on,
/// say, the 8th of 20 receipts (an inactive product, a negative-stock
/// guard) rolls back all 20 instead of leaving the batch half-saved.
export async function createReceiptsBatch(
  inputs: (CreateReceiptInput & { postToFulfillment: false; postToOfflineDelivery: true })[],
  createdById?: number,
  createdByRole?: Role,
) {
  if (!inputs.length) throw HttpError.badRequest("At least one receipt is required");

  return prisma.$transaction(
    async (tx) => {
      const receipts = [];
      for (const input of inputs) {
        receipts.push(await createReceipt(input, createdById, createdByRole, tx));
      }
      return receipts;
    },
    // Default 5s timeout is comfortable for one receipt but not for a whole
    // consolidated-receipt batch, where each receipt's own posting involves
    // several sequential reads/writes (see createReceipt) - scaled generously
    // rather than per-receipt-counted, since a slow query anywhere in the
    // chain should still fail loudly rather than silently racing the clock.
    { timeout: 30_000 },
  );
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

/// Section 4.7's Consolidated Receipt Entry pre-fill - the customer names
/// from this location's last prior date that had any receipts at all, so a
/// new sheet for the same delivery route starts with its usual customer
/// list instead of blank columns. Strictly BEFORE the given date, not
/// on-or-before - a sheet already in progress for `before` itself
/// shouldn't be treated as its own "prior date".
export async function getLastCustomersForLocation(location: string, before: Date): Promise<string[]> {
  const lastDate = await receiptRepository.findLastOrderDateForLocation(location, before);
  if (!lastDate) return [];
  return receiptRepository.findDistinctCustomers(location, lastDate);
}
