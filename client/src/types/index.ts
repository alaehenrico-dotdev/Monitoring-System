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

/// A named Offline delivery route/destination (e.g. "Western", "Cavite") -
/// Section 4.3. Admin-managed (see DeliveryDestinationsAdminPage), the same
/// way Products are, so the set of destinations can change over time
/// without a code change: the monthly report this app re-imports (Section
/// 8.1) has used a different destination lineup from one period to the
/// next, each getting its own column ("SLOT 1", "SLOT 2", ... in the
/// sheet's own generic sub-header, with the real name - "WESTERN UPSELL",
/// "CAVITE" - as that column's actual header).
export interface DeliveryDestination {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
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
  /// Delivery (Out) broken down by destination - keyed by DeliveryDestination
  /// id, one entry per active destination that's ever had a value here.
  /// This is what an encoder actually fills in; deliveryOut below is
  /// computed as its sum, the same way offlineStock/remainingStock are
  /// computed rather than typed directly - the live grid shows one locked
  /// "Delivery (Out)" column, not this map, plus one editable column per
  /// destination (see buildOfflineStockColumns in config/stockColumns.ts).
  deliveryByDestination: Record<number, number>;
  deliveryOut: number;
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
}

export interface ManualCountGridRow {
  product: Product;
  entry: ManualCountEntry;
  isSaved: boolean;
  isFlagged: boolean;
}

export interface TotalStockRow {
  product: Product;
  onlineRemainingStock: number;
  offlineRemainingStock: number;
  totalRemainingStock: number;
  totalManualCount: number | null;
  totalVariance: number | null;
}

export interface ReceiptItem {
  id: number;
  productId: number;
  product: Product;
  quantity: number;
  /// Peso price for this line, fixed at the time the receipt was created
  /// (Section 4.7) - null only for receipts logged before this field
  /// existed, since there's no Product-level default price to backfill
  /// from. Every new receipt's create form requires it per line.
  unitPrice: number | null;
}

export interface Receipt {
  id: number;
  orderDate: string;
  customer: string;
  location: string;
  /// Free text (Section 4.7) - not necessarily a system user.
  salesRepName: string | null;
  salesRepId: number | null;
  salesRep: AuthUser | null;
  /// Which stock pool this receipt posted into at creation (Section 4.7) -
  /// set once server-side from the postToFulfillment/postToOfflineDelivery
  /// flags on CreateReceiptInput (see api/receipts.ts) and never changed
  /// after. See receiptPool() in utils/consolidatedReceipts.ts.
  postedPool: "NONE" | "FULFILLMENT" | "OFFLINE_DELIVERY";
  createdBy: AuthUser | null;
  createdAt: string;
  items: ReceiptItem[];
  /// Server-encrypted (AES-256-GCM) receipt id, for the printed QR code -
  /// see server/src/utils/receiptQrToken.ts. Opaque on this side; the
  /// client never has the key to decode or produce one itself.
  qrToken: string;
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
}