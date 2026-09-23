import { http } from "./http";
import type { Receipt } from "../types";

export interface CreateReceiptInput {
  orderDate: string;
  customer: string;
  location: string;
  /// Free text - not necessarily a system user (Section 4.7).
  salesRepName?: string;
  postToFulfillment?: boolean;
  /// Mirrors postToFulfillment (Section 4.7) but for the Offline pool -
  /// tallies this receipt's item quantities onto the current shift's
  /// Offline entry Delivery (Out) column instead of Online's Fulfillment
  /// (Out). Online and Offline are separate stock pools that aren't
  /// expected to tally with each other (see MonthlyMonitoring), so the
  /// two flags are mutually exclusive - the form never sends both true.
  postToOfflineDelivery?: boolean;
  items: { productId: number; quantity: number; unitPrice: number }[];
}

export function createReceipt(input: CreateReceiptInput) {
  return http.post<Receipt>("/receipts", input);
}

/// One receipt in a createReceiptsBatch call - same shape as
/// CreateReceiptInput, but postToFulfillment/postToOfflineDelivery are
/// required literals rather than optional, matching the server's zod
/// schema (receipts.controller.ts): a bulk save has no per-receipt UI to
/// confirm a silently-defaulted pool against, so nothing here is allowed to
/// fall back to a default the way the single-receipt form's flags can.
export interface CreateReceiptBatchInput extends Omit<CreateReceiptInput, "postToFulfillment" | "postToOfflineDelivery"> {
  postToFulfillment: false;
  postToOfflineDelivery: true;
}

/// Section 4.7's Consolidated Receipt bulk entry (ReceiptsPage's "Bulk Entry" mode) -
/// creates every receipt in the batch as one atomic Prisma transaction
/// server-side (receipts.service.ts's createReceiptsBatch), so a bad line on
/// receipt #8 of 20 rolls the whole save back instead of leaving it half-saved.
export function createReceiptsBatch(inputs: CreateReceiptBatchInput[]) {
  return http.post<Receipt[]>("/receipts/batch", inputs);
}

export function listReceipts(filters: { date?: string; customer?: string; location?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.set("date", filters.date);
  if (filters.customer) params.set("customer", filters.customer);
  if (filters.location) params.set("location", filters.location);
  const qs = params.toString();
  return http.get<Receipt[]>(`/receipts${qs ? `?${qs}` : ""}`);
}

/// Section 4.7's Consolidated Receipt Entry pre-fill - the customer names
/// from this location's last prior date (strictly before `before`) that had
/// any receipts, so a new sheet starts with its usual customer list instead
/// of blank columns.
export function listLastCustomers(location: string, before: string) {
  const params = new URLSearchParams({ location, before });
  return http.get<string[]>(`/receipts/last-customers?${params.toString()}`);
}
