import type { ManualCountGridRow, StockLocation } from "../types";

export interface UncountedProduct {
  productId: number;
  name: string;
  category: string;
  location: Exclude<StockLocation, "TOTAL">;
  /// The system's remaining stock for the sheet: what keeps carrying on if no count is entered.
  system: number;
}

/// Every active product with no count on this sheet, per location. An audit only replaces the
/// figure of a product that was counted, so these keep carrying their current figure (a negative
/// one stays negative) into the next day. Rows that were published already show blank on the
/// sheet but carry a publishedAt, so they are counted, not missing. Negative figures sort first,
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
