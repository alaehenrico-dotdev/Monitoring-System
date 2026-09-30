import { useEffect, useState } from "react";
import { getTotalStocks } from "../api/totalStocks";
import type { TotalStockRow } from "../types";
import { DatePicker } from "../components/DatePicker";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { StockSourceFilter } from "../components/StockSourceFilter";
import { TableSkeleton } from "../components/Skeleton";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { useResetOnKeyChange } from "../hooks/useResetOnKeyChange";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { getCurrentShiftAndDate } from "../utils/shift";
import type { StockLocation } from "../types";

const allCsvColumns = [
  { key: "onlineRemainingStock", label: "Online Remaining" },
  { key: "offlineRemainingStock", label: "Offline Remaining" },
  { key: "totalRemainingStock", label: "Total Remaining" },
];

// Narrows the export (Excel/PDF) columns to match whatever the
// StockSourceFilter has on screen, so "Online only" doesn't export an
// Offline/Total column nobody asked to see.
function csvColumnsFor(source: StockLocation) {
  if (source === "ONLINE") return allCsvColumns.filter((c) => c.key === "onlineRemainingStock");
  if (source === "OFFLINE") return allCsvColumns.filter((c) => c.key === "offlineRemainingStock");
  return allCsvColumns;
}

const SOURCE_TITLES: Record<StockLocation, string> = {
  TOTAL: "Total Stocks (Online + Offline)",
  ONLINE: "Total Stocks (Online only)",
  OFFLINE: "Total Stocks (Offline only)",
};

/// Section 4.5 - a read-only, always-current grid combining Online + Offline
/// Remaining Stock per product, calculated from the same records as the
/// Online/Offline entries so it can never fall out of sync.
export function TotalStocksPage() {
  const [date, setDate] = useState(getCurrentShiftAndDate().date);
  const [rows, setRows] = useState<TotalStockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("total-stocks");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [source, setSource] = useState<StockLocation>("TOTAL");
  const realtimeVersion = useRealtimeVersion();

  useResetOnKeyChange(date, () => {
    setRows(null);
    setError(null);
  });
  useEffect(() => {
    getTotalStocks(date)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load total stocks"));
  }, [date, realtimeVersion]);

  // CsvTools expects {product, entry} rows; nulls become "" (not 0) so an
  // uncounted product reads as blank in the export rather than implying a
  // confirmed count of zero. Export always covers the full set - only the
  // on-screen table is affected by the search box.
  const csvColumns = csvColumnsFor(source);
  const csvRows = rows?.map((r) => ({
    product: r.product,
    entry: {
      onlineRemainingStock: r.onlineRemainingStock,
      offlineRemainingStock: r.offlineRemainingStock,
      totalRemainingStock: r.totalRemainingStock,
      totalManualCount: r.totalManualCount ?? "",
      totalVariance: r.totalVariance ?? "",
    },
  }));

  const categories = Array.from(new Set((rows ?? []).map((r) => r.product.category))).sort();
  const visibleRows = rows?.filter(
    (r) => matchesSearch([r.product.sku, r.product.name, r.product.category], query) && (categoryFilter === "" || r.product.category === categoryFilter),
  );

  return (
    <div>
      <PageHeader
        title={`${SOURCE_TITLES[source]} - ${formatDateDisplay(date)}`}
        subtitle="Review combined online and offline stock balances."
      >
        <Toolbar className="no-print">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
            <DatePicker aria-label="Date" value={date} onChange={setDate} todayValue={getCurrentShiftAndDate().date} style={{ maxWidth: 180 }} />
            <SearchInput value={query} onChange={setQuery} placeholder="Search SKU or category…" />
            <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
            <StockSourceFilter value={source} onChange={setSource} />
          </div>
          <ToolbarControls>
            {csvRows && (
              <>
                <CsvTools filenamePrefix="total-stocks" date={date} rows={csvRows} columns={csvColumns} onImportRow={async () => {}} getPendingValue={() => undefined} canImport={false}
                  exportFormat="excel"
                  pdf={{
                    title: SOURCE_TITLES[source],
                    subtitle: formatDateDisplay(date),
                    // Same as TotalStocksTable: only the visible "remaining" columns are summed.
                    sumKeys: csvColumns.map((c) => c.key),
                    flagKey: "totalVariance",
                  }}
                />
                <ToolbarDivider />
              </>
            )}
            <ZoomControl zoom={zoom} onChange={setZoom} />
          </ToolbarControls>
        </Toolbar>
      </PageHeader>
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
      {!rows ? (
        <TableSkeleton
          headers={["SKU", "Product", ...csvColumns.map((c) => c.label)]}
          minWidth={640}
          label="Loading total stocks…"
        />
      ) : (
        <div className="ae-grid-fill" style={zoomStyle(zoom)}>
          {/* Keyed by date so switching it remounts the table fresh - every
              category starts expanded again on a newly-loaded date, instead
              of carrying over whatever was collapsed on the last one. Also
              remounts on `source` so a collapsed category doesn't carry a
              stale column count across an Online/Offline/Total switch. */}
          <TotalStocksTable key={`${date}-${source}`} rows={visibleRows ?? []} source={source} />
        </div>
      )}
    </div>
  );
}