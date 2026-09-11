import type { GridColumn } from "../components/StockGrid";

/**
 * Single source of truth for the Online/Offline grid columns (Section 4.2 /
 * 4.3), shared by the live entry pages, the CSV export/import, and the
 * Daily Report - previously each of those redefined its own column list
 * (or, in the Daily Report's case, just dumped whatever fields happened to
 * be on the API response), which is exactly how they drifted out of sync.
 */
export const onlineStockColumns: GridColumn[] = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false },
  { key: "stockInOffToOl", label: "Stocks In (Off→Ol)", editable: true },
  { key: "stockOutOlToOff", label: "Stocks Out (Ol→Off)", editable: true },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "fulfillmentOut", label: "Fulfillment (Out)", editable: true },
  { key: "rts", label: "RTS", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

export const offlineStockColumns: GridColumn[] = [
  { key: "openingStock", label: "Stocks (Opening)", editable: false },
  { key: "stockInOlToOff", label: "Stocks In (Ol→Off)", editable: true },
  { key: "stockOutOffToOl", label: "Stocks Out (Off→Ol)", editable: true },
  { key: "offlineStock", label: "Offline Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "deliveryOut", label: "Delivery (Out)", editable: true },
  { key: "backloads", label: "Backloads", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];
