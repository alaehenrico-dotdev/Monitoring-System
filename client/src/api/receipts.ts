import { http } from "./http";
import type { Receipt } from "../types";

export interface CreateReceiptInput {
  orderDate: string;
  customer: string;
  location: string;
  salesRepId?: number;
  postToFulfillment?: boolean;
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
