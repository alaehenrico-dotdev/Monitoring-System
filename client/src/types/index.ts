export type Role = "ONLINE_ENCODER" | "OFFLINE_ENCODER" | "SUPERVISOR_ADMIN";
export type StockLocation = "ONLINE" | "OFFLINE" | "TOTAL";
/// Entries are recorded per operating shift, not just per day: Morning
/// (7am-4pm) and Night (4pm-1am). Night crosses midnight - see
/// utils/shift.ts for how a wall-clock time maps to {shift, date}.
export type Shift = "MORNING" | "NIGHT";

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}

export interface Product {
  id: number;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  sortOrder: number;
  // Section 4.1/4.5 - Low Stock. Null = no alert configured for this SKU;
  // Total Stocks flags a product only once this is set, against its
  // remainingStock (same unit as `unit`).
  lowStockThreshold: number | null;
}

export interface OnlineEntry {
  productId: number;
  entryDate: string;
  shift: Shift;
  openingStock: number;
  stockInOffToOl: number;
  stockOutOlToOff: number;
  onlineStock: number;
  productionIn: number;
  fulfillmentOut: number;
  rts: number;
  remainingStock: number;
}

export interface OnlineGridRow {
  product: Product;
  entry: OnlineEntry;
  isSaved: boolean;
}

export interface OfflineEntry {
  productId: number;
  entryDate: string;
  shift: Shift;
  openingStock: number;
  stockInOlToOff: number;
  stockOutOffToOl: number;
  offlineStock: number;
  productionIn: number;
  /// Delivery (Out) is the sum of these five slots - the grid's expandable
  /// Delivery columns.
  deliveryOut: number;
  delivery1: number;
  delivery2: number;
  delivery3: number;
  delivery4: number;
  delivery5: number;
  /// A distinct Out figure from Delivery (Out) - e.g. free/upsell samples
  /// handed out rather than delivered against a route. Its own column on
  /// the monthly report ("UPSELL (OUT)"), usually 0.
  upsellOut: number;
  /// Stock a delivery route brought back undelivered - Section 4.3. This
  /// ADDS BACK onto Remaining Stock rather than subtracting: cross-checked
  /// against the monthly report's own totals (Section 8.1), e.g. Class A
  /// (Gallon) - Offline Stocks 3554 + Production 804 - Delivery 752 +
  /// Backload 29 = Remaining 3635, which only balances with backloads
  /// added. Confirmed correct server-side (calculateOfflineRemaining in
  /// server/src/utils/stockMath.ts adds backloads) - see that file's own
  /// test for this exact pinned example.
  backloads: number;
  remainingStock: number;
}

export interface OfflineGridRow {
  product: Product;
  entry: OfflineEntry;
  isSaved: boolean;
}

export interface ManualCountEntry {
  productId: number;
  entryDate: string;
  shift: Shift;
  location: StockLocation;
  systemRemainingStock: number;
  manualCount: number | null;
  variance: number | null;
  /// Why the count differs from the system figure (free text).
  remarks?: string | null;
  /// When the count was published (it then carries into the next shift's opening
  /// stock); null = saved but not yet published.
  publishedAt?: string | null;
}

export interface ManualCountGridRow {
  product: Product;
  entry: ManualCountEntry;
  isSaved: boolean;
  isFlagged: boolean;
  /// This period's opening stock is not what the previous period carries
  /// forward (a CSV import set it) - null when it matches or can't be compared.
  openingBreak?: { expected: number; actual: number } | null;
}

export interface TotalStockRow {
  product: Product;
  onlineRemainingStock: number;
  offlineRemainingStock: number;
  totalRemainingStock: number;
  totalManualCount: number | null;
  totalVariance: number | null;
}

export interface ChangeLogEntry {
  id: number;
  tableName: string;
  recordId: number;
  action: "CREATE" | "UPDATE" | "DELETE";
  changedAt: string;
  changedBy: { id: number; name: string; username: string; role: Role } | null;
  oldValue: unknown;
  newValue: unknown;
  /// Added by GET /change-log - absent on rows from anything older.
  context?: ChangeLogContext | null;
  source?: "import" | "reset" | null;
  /// One-line "what changed" with friendly field names; null for system rows.
  summary?: string | null;
  /// Set on a follow-on change the system made because of another one.
  causedById?: number | null;
  changes?: { key: string; label: string; before: string; after: string }[];
}

/// What a change row points at (see server changeLog.service ChangeLogContext).
export interface ChangeLogContext {
  productId: number | null;
  sku: string | null;
  productName: string | null;
  /// YYYY-MM-DD
  entryDate: string | null;
  shift: "MORNING" | "NIGHT" | null;
  location: "ONLINE" | "OFFLINE" | "TOTAL" | null;
}