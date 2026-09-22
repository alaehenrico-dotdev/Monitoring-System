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
  items: { productId: number; quantity: number }[];
}

export function createReceipt(input: CreateReceiptInput) {
  return http.post<Receipt>("/receipts", input);
}

export function listReceipts(filters: { date?: string; customer?: string; location?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.set("date", filters.date);
  if (filters.customer) params.set("customer", filters.customer);
  if (filters.location) params.set("location", filters.location);
  const qs = params.toString();
  return http.get<Receipt[]>(`/receipts${qs ? `?${qs}` : ""}`);
}
