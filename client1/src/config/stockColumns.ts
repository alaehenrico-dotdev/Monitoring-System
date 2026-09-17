import type { GridColumn } from "../components/StockGrid";

/**
 * Single source of truth for the Online/Offline grid columns (Section 4.2 /
 * 4.3), shared by the live entry pages, the CSV export/import, and the
 * Daily Report - previously each of those redefined its own column list
 * (or, in the Daily Report's case, just dumped whatever fields happened to
 * be on the API response), which is exactly how they drifted out of sync.
 */
// Aliases below match the monthly stock report the business re-imports
// (Section 8.1, e.g. "Online Monitoring - Sept 9, 2026 online.csv") - it
// doesn't spell out the In/Out direction the app's own export does, and
// carries a couple of long-standing typos of its own ("Fullfilment"), so
// both spellings are accepted on import.
export const onlineStockColumns: GridColumn[] = [
  // Not editable in the live grid (Section 4.6 auto-carries it forward from
  // the prior day's Remaining Stock) but still importable: a file's very
  // first date has nothing to carry forward from, so the file's own
  // "STOCKS" column is what gives that first day a real starting balance
  // instead of everything defaulting to 0.
  { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Stocks"] },
  { key: "stockInOffToOl", label: "Stocks In (Off→Ol)", editable: true, aliases: ["Stocks In"] },
  { key: "stockOutOlToOff", label: "Stocks Out (Ol→Off)", editable: true, aliases: ["Stocks Out"] },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "fulfillmentOut", label: "Fulfillment (Out)", editable: true, aliases: ["Fullfilment (Out)"] },
  { key: "rts", label: "RTS", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

export const offlineStockColumns: GridColumn[] = [
  // Not editable in the live grid (Section 4.6 auto-carries it forward from
  // the prior day's Remaining Stock) but still importable: a file's very
  // first date has nothing to carry forward from, so the file's own
  // "STOCKS" column is what gives that first day a real starting balance
  // instead of everything defaulting to 0.
  { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Stocks"] },
  { key: "stockInOlToOff", label: "Stocks In (Ol→Off)", editable: true, aliases: ["Stocks In"] },
  { key: "stockOutOffToOl", label: "Stocks Out (Off→Ol)", editable: true, aliases: ["Stocks Out"] },
  { key: "offlineStock", label: "Offline Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "deliveryOut", label: "Delivery (Out)", editable: true, aliases: ["Delivery(Out)"] },
  { key: "backloads", label: "Backloads", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];
