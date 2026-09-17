import { http } from "./http";
import type { ManualCountEntry, ManualCountGridRow, StockLocation } from "../types";

export function getManualCountGrid(date: string, location: StockLocation) {
  return http.get<ManualCountGridRow[]>(`/manual-counts?date=${date}&location=${location}`);
}

/// Returns the saved row (with its freshly-computed variance) so the caller
/// can merge it into local state instead of re-fetching the whole grid.
export function saveManualCount(productId: number, date: string, location: StockLocation, manualCount: number) {
  return http.put<ManualCountEntry>(`/manual-counts/${productId}?date=${date}&location=${location}`, { manualCount });
}

export interface VarianceReportFilters {
  startDate: string;
  endDate: string;
  productId?: number;
  category?: string;
  location?: StockLocation;
  flaggedOnly?: boolean;
}

export function getVarianceReport(filters: VarianceReportFilters) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  if (filters.productId) params.set("productId", String(filters.productId));
  if (filters.category) params.set("category", filters.category);
  if (filters.location) params.set("location", filters.location);
  if (filters.flaggedOnly !== undefined) params.set("flaggedOnly", String(filters.flaggedOnly));
  return http.get(`/reports/variance?${params.toString()}`);
}
