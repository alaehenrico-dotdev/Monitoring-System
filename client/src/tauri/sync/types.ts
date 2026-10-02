export type Shift = "MORNING" | "NIGHT";
export type StockLocation = "ONLINE" | "OFFLINE" | "TOTAL";

export interface ProductCache {
  id: number;
  sku: string | null;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  sortOrder: number;
  lowStockThreshold: number | null;
  updatedAt: string;
}

export interface OnlineStockCache {
  localId: string;
  serverId: number | null;
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
  encodedById: number | null;
  updatedAt: string;
}

export interface OnlineStockPending {
  localId: string;
  productionIn: number;
  fulfillmentOut: number;
  rts: number;
  baselineUpdatedAt: string | null;
  stagedAt: string;
}

export interface OfflineStockCache {
  localId: string;
  serverId: number | null;
  productId: number;
  entryDate: string;
  shift: Shift;
  openingStock: number;
  stockInOlToOff: number;
  stockOutOffToOl: number;
  offlineStock: number;
  productionIn: number;
  deliveryOut: number;
  delivery1: number;
  delivery2: number;
  delivery3: number;
  delivery4: number;
  delivery5: number;
  backloads: number;
  upsellOut: number;
  remainingStock: number;
  encodedById: number | null;
  updatedAt: string;
}

export interface OfflineStockPending {
  localId: string;
  productionIn: number;
  delivery1: number;
  delivery2: number;
  delivery3: number;
  delivery4: number;
  delivery5: number;
  backloads: number;
  upsellOut: number;
  baselineUpdatedAt: string | null;
  stagedAt: string;
}

export interface ManualCountCache {
  localId: string;
  serverId: number | null;
  productId: number;
  entryDate: string;
  shift: Shift;
  location: StockLocation;
  systemRemainingStock: number;
  manualCount: number;
  variance: number;
  countedById: number | null;
  updatedAt: string;
}

export interface ManualCountPending {
  localId: string;
  /// Non-additive - the desired absolute count, not a delta (see
  /// localDb.ts's stageManualCount).
  manualCount: number;
  baselineUpdatedAt: string | null;
  stagedAt: string;
}

export type SyncTableName = "daily_online_stock" | "daily_offline_stock" | "manual_counts";

export interface SyncConflict {
  id: number;
  tableName: SyncTableName;
  productId: number;
  entryDate: string;
  shift: Shift;
  location: StockLocation | null;
  /// The server's explanation - e.g. the negative-stock guard's message, or
  /// "Manual count changed on the server since this device last saw it".
  reason: string;
  mineValue: unknown;
  serverValue: unknown;
  detectedAt: string;
  resolved: boolean;
}
