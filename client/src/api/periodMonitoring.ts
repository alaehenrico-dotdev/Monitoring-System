import { http } from "./http";

export interface PeriodProductRow {
  productId: number;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  onlineOut: number;
  offlineOut: number;
  totalOut: number;
  backloads: number;
  rts: number;
  productionIn: number;
  /// Sum of system - counted (gains and losses cancel).
  netVariance: number;
  /// Sum of |system - counted| (the total size of the discrepancies).
  absVariance: number;
}

export interface PeriodTotals {
  onlineOut: number;
  offlineOut: number;
  totalOut: number;
  backloads: number;
  rts: number;
  productionIn: number;
  netVariance: number;
  absVariance: number;
  flaggedProducts: number;
  /// Days in the window with at least one audit count - variance only exists on these.
  countedDays: number;
}

export interface PeriodMonitoring {
  from: string;
  to: string;
  days: number;
  totals: PeriodTotals;
  products: PeriodProductRow[];
}

/// Totals and a per-product breakdown for every date from `from` to `to`
/// inclusive. Supervisor/Admin only.
export function getPeriodMonitoring(from: string, to: string) {
  return http.get<PeriodMonitoring>(`/total-stocks/period-monitoring?from=${from}&to=${to}`);
}
