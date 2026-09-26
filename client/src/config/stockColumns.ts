import type { GridColumn } from "../components/StockGrid";
import type { DeliveryDestination } from "../types";
import { deliveryColumnKey } from "../api/offlineStock";

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
  { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Remaining Stocks", "Reaining Stocks", "Total Remaining Stock", "Total Remaining Stocks", "Total Stocks", "Stocks"] },
  { key: "stockInOffToOl", label: "Stocks In (Off→Ol)", editable: true, aliases: ["Stocks In"] },
  { key: "stockOutOlToOff", label: "Stocks Out (Ol→Off)", editable: true, aliases: ["Stocks Out"] },
  { key: "onlineStock", label: "Online Stocks", editable: false },
  { key: "productionIn", label: "Production (In)", editable: true },
  { key: "fulfillmentOut", label: "Fulfillment (Out)", editable: true, aliases: ["Fullfilment (Out)"] },
  { key: "rts", label: "RTS", editable: true },
  { key: "remainingStock", label: "Remaining Stocks", editable: false },
];

/**
 * The Offline grid's columns depend on the current set of delivery
 * destinations (Section 4.3, admin-managed - see DeliveryDestinationsAdminPage
 * and api/deliveryDestinations.ts), so - unlike onlineStockColumns above -
 * this is a function, not a static list. Callers (OfflineEntryPage,
 * DailyReportPage) fetch the active destinations once and pass them in;
 * everything downstream (StockGrid, CsvTools, the PDF/Excel builders,
 * usePendingEntryChanges) already takes `columns: GridColumn[]` as a plain
 * prop, so none of it needs to know these particular columns are dynamic.
 *
 * One editable column per active destination sits between Production (In)
 * and the (also directly editable) Delivery (Out) total - each destination's
 * `label` is its own name (e.g. "Western", "Cavite"), matching that
 * destination's column header verbatim on the monthly report this
 * re-imports (Section 8.1), so a renamed or newly-added destination there is
 * recognized on import with no code change, the same way a newly-added
 * Product SKU already is.
 */
export function buildOfflineStockColumns(destinations: DeliveryDestination[]): GridColumn[] {
  const deliveryColumns: GridColumn[] = [...destinations]
    .filter((d) => d.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((d) => ({ key: deliveryColumnKey(d.id), label: d.name, editable: true }));

  return [
    // Not editable in the live grid (Section 4.6 auto-carries it forward from
    // the prior day's Remaining Stock) but still importable - see
    // onlineStockColumns' own copy of this comment for why the Remaining/
    // Total Stocks aliases are listed before bare "Stocks".
    { key: "openingStock", label: "Stocks (Opening)", editable: false, importable: true, aliases: ["Remaining Stocks", "Reaining Stocks", "Total Remaining Stock", "Total Remaining Stocks", "Total Stocks", "Stocks"] },
    { key: "stockInOlToOff", label: "Stocks In (Ol→Off)", editable: true, aliases: ["Stocks In"] },
    { key: "stockOutOffToOl", label: "Stocks Out (Off→Ol)", editable: true, aliases: ["Stocks Out"] },
    { key: "offlineStock", label: "Offline Stocks", editable: false },
    { key: "productionIn", label: "Production (In)", editable: true },
    ...deliveryColumns,
    // Directly editable, same as any other flat figure (e.g. Backloads) -
    // typing here bypasses the per-destination breakdown entirely (the
    // server's resolveDeliveryOut already treats a flat `deliveryOut` and a
    // `deliveryByDestination` breakdown as mutually exclusive - whichever
    // one this save's changes actually touch wins), so a shift with no
    // destinations configured (or one that just doesn't need the breakdown)
    // still has a normal way to enter this figure. Still importable, same
    // reasoning as openingStock: a plain file with only a flat
    // "Delivery(Out)" total and no per-destination breakdown (an older
    // export, or a report from before a destination existed) still imports
    // a usable number instead of silently dropping it.
    { key: "deliveryOut", label: "Delivery (Out)", editable: true, importable: true, aliases: ["Delivery(Out)"] },
    { key: "upsellOut", label: "Upsell (Out)", editable: true },
    // The monthly report (Section 8.1) headers this column "BACKLOAD"
    // (singular) - the app's own label is plural, so without this alias a
    // real import would silently drop every backload figure in the file
    // (the column just wouldn't be found, not an error), same reasoning as
    // fulfillmentOut's "Fullfilment (Out)" alias above.
    { key: "backloads", label: "Backloads", editable: true, aliases: ["Backload"] },
    { key: "remainingStock", label: "Remaining Stocks", editable: false },
  ];
}
