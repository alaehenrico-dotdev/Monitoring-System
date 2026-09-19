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

export interface OfflineEntry {
  productId: number;
  entryDate: string;
  shift: Shift;
  openingStock: number;
  stockInOlToOff: number;
  stockOutOffToOl: number;
  offlineStock: number;
  productionIn: number;
  deliveryOut: number;
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
  createdBy: AuthUser | null;
  createdAt: string;
  items: ReceiptItem[];
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