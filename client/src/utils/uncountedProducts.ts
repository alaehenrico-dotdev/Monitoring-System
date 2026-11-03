import type { ManualCountGridRow, StockLocation } from "../types";

export interface UncountedProduct {
  productId: number;
  name: string;
  category: string;
  location: Exclude<StockLocation, "TOTAL">;
  /// The system's remaining stock for the sheet: what keeps carrying on if no count is entered.
  system: number;
}

/// Every active product with no count on this sheet, per location. This must mirror what the
/// server does when publishing with the tick on (AUDIT RULE 2, manualCounts.service.ts): it gives
/// each of these a count of 0, so they open the next day at 0. Published as an audit only, they
/// keep carrying their current figure instead. Keep the two lists in step.
///
/// Rows that were published already show blank on the sheet but carry a publishedAt, so they are
/// counted, not missing. Negative figures sort first,
/// since they are the ones that must not slip through.
export function uncountedProducts(rows: Record<"ONLINE" | "OFFLINE", ManualCountGridRow[]>): UncountedProduct[] {
  const out: UncountedProduct[] = [];
  for (const location of ["ONLINE", "OFFLINE"] as const) {
    for (const r of rows[location]) {
      if (r.isSaved || r.entry.publishedAt) continue;
      out.push({ productId: r.product.id, name: r.product.name, category: r.product.category, location, system: Number(r.entry.systemRemainingStock) || 0 });
    }
  }
  return out.sort((a, b) => Number(b.system < 0) - Number(a.system < 0) || a.system - b.system || a.name.localeCompare(b.name));
}
