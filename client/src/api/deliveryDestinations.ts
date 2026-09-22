import { http } from "./http";
import type { DeliveryDestination } from "../types";

/// By default only active destinations come back (what the Offline grid's
/// per-destination columns want - see config/stockColumns.ts). The admin
/// list passes `includeInactive` so a retired route stays visible there,
/// same reasoning as listProducts.
export function listDeliveryDestinations(options: { includeInactive?: boolean } = {}) {
  return http.get<DeliveryDestination[]>(
    options.includeInactive ? "/delivery-destinations?includeInactive=true" : "/delivery-destinations",
  );
}

export function createDeliveryDestination(data: { name: string }) {
  return http.post<DeliveryDestination>("/delivery-destinations", data);
}

export function updateDeliveryDestination(id: number, data: Partial<Pick<DeliveryDestination, "name" | "isActive" | "sortOrder">>) {
  return http.patch<DeliveryDestination>(`/delivery-destinations/${id}`, data);
}

/// Deactivates rather than deletes - past Offline entries still reference
/// this destination's id (deliveryByDestination), the same reasoning as
/// deactivateProduct.
export function deactivateDeliveryDestination(id: number) {
  return http.delete<DeliveryDestination>(`/delivery-destinations/${id}`);
}
