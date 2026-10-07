import { http } from "./http";
import type {
  ManualCountEntry,
  ManualCountGridRow,
  Shift,
  StockLocation,
} from "../types";

export function getManualCountGrid(
  date: string,
  shift: Shift,
  location: StockLocation,
): Promise<ManualCountGridRow[]> {
  return http.get(
    `/manual-counts?date=${date}&shift=${shift}&location=${location}`,
  );
}

export function saveManualCount(
  productId: number,
  date: string,
  shift: Shift,
  location: StockLocation,
  manualCount: number | null,
  importBatchId?: number,
): Promise<ManualCountEntry> {
  return http.put(
    `/manual-counts/${productId}?date=${date}&shift=${shift}&location=${location}`,
    { manualCount, importBatchId },
  );
}

export interface VarianceReportFilters {
  startDate: string;
  endDate: string;
  productId?: number;
  category?: string;
  location?: StockLocation;
  shift?: Shift;
  flaggedOnly?: boolean;
}

export function getVarianceReport(filters: VarianceReportFilters) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  if (filters.productId) params.set("productId", String(filters.productId));
  if (filters.category) params.set("category", filters.category);
  if (filters.location) params.set("location", filters.location);
  if (filters.shift) params.set("shift", filters.shift);
  if (filters.flaggedOnly !== undefined)
    params.set("flaggedOnly", String(filters.flaggedOnly));
  return http.get(`/reports/variance?${params.toString()}`);
}
