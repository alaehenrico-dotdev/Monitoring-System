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
  // the prior day's Remaining Stock) but still importable, so a re-imported
  // report can seed/correct it directly. The Remaining/Total Stocks aliases
  // are listed BEFORE bare "Stocks" on purpose: a normal full daily report
  // (Section 8.1) carries both that day's own "STOCKS" column (its already-
  // stale opening balance) and its "REMAINING STOCKS" ending balance, and
  // it's the ending balance that becomes the opening balance for whatever
  // date this file is being imported onto - matchColumnIndexes resolves by
  // this alias list's own order, not by which column the header lists
  // first, so Remaining/Total Stocks always wins when both are present.
  // Bare "Stocks" only ends up used as a fallback: a switchover file with no
  // Remaining/Total Stocks column at all (just a plain "Stocks" balance).
  {
    key: "openingStock",
    label: "Stocks (Opening)",
    editable: false,
    importable: true,
    aliases: [
      "Remaining Stocks",
      "Reaining Stocks",
      "Total Remaining Stock",
      "Total Remaining Stocks",
      "Total Stocks",
      "Stocks",
    ],
  },
  {
    key: "stockInOffToOl",
    label: "Stocks In (Off→Ol)",
    editable: true,
    tone: "in",
    aliases: ["Stocks In"],
  },
  {
    key: "stockOutOlToOff",
    label: "Stocks Out (Ol→Off)",
    editable: true,
    tone: "out",
    aliases: ["Stocks Out"],
  },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  {
    key: "fulfillmentOut",
    label: "Fulfillment (Out)",
    editable: true,
    tone: "delivery",
    aliases: ["Fullfilment (Out)"],
  },
  { key: "rts", label: "RTS", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

/// Offline grid columns (Section 4.3).
export const offlineStockColumns: GridColumn[] = [
    // Not editable in the live grid (Section 4.6 auto-carries it forward from
    // the prior day's Remaining Stock) but still importable - see
    // onlineStockColumns' own copy of this comment for why the Remaining/
    // Total Stocks aliases are listed before bare "Stocks".
    {
      key: "openingStock",
      label: "Stocks (Opening)",
      editable: false,
      importable: true,
      aliases: [
        "Remaining Stocks",
        "Reaining Stocks",
        "Total Remaining Stock",
        "Total Remaining Stocks",
        "Total Stocks",
        "Stocks",
      ],
    },
    {
      key: "stockInOlToOff",
      label: "Stocks In (Ol→Off)",
      editable: true,
      tone: "in",
      aliases: ["Stocks In"],
    },
    {
      key: "stockOutOffToOl",
      label: "Stocks Out (Off→Ol)",
      editable: true,
      tone: "out",
      aliases: ["Stocks Out"],
    },
    { key: "offlineStock", label: "Offline Stocks", editable: false },
    { key: "productionIn", label: "Production (In)", editable: true },
    // Directly editable, same as any other flat figure (e.g. Backloads).
    // Also importable, same reasoning as openingStock above.
    {
      key: "deliveryOut",
      label: "Delivery (Out)",
      // Directly editable, and - like every other editable column - able to be
      // broken down into as many extra input columns as a shift actually
      // needs (right-click the header; see hooks/useExtraColumns.ts). It used
      // to be locked behind exactly five fixed "Delivery 1..5" sub-columns
      // revealed by a header arrow, which was both a second mechanism doing
      // the same job and a hard limit on a figure that has no natural limit.
      // Those five are still the storage behind the first five added columns
      // (server: resolveDelivery), so nothing already entered was lost.
      editable: true,
      tone: "delivery",
      importable: true,
      aliases: ["Delivery(Out)"],
    },
    // The monthly report (Section 8.1) headers this column "BACKLOAD"
    // (singular) - the app's own label is plural, so without this alias a
    // real import would silently drop every backload figure in the file
    // (the column just wouldn't be found, not an error), same reasoning as
    // fulfillmentOut's "Fullfilment (Out)" alias above.
    {
      key: "backloads",
      label: "Backloads",
      editable: true,
      aliases: ["Backload"],
    },
    { key: "remainingStock", label: "Remaining Stocks", editable: false },
];
