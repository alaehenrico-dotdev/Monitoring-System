import type { TotalStockRow } from "../types";

/// A product is "low stock" only once an admin has configured a threshold
/// for it (ProductsAdminPage) - null means no alert is configured, not an
/// alert at zero, so it never fires for the majority of SKUs that have
/// never had one set.
export function isLowStock(row: TotalStockRow): boolean {
  return (
    row.product.lowStockThreshold !== null &&
    row.totalRemainingStock <= row.product.lowStockThreshold
  );
}
