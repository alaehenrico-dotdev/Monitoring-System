import { useEffect, useState } from "react";
import { getTotalStocks } from "../api/totalStocks";
import type { TotalStockRow } from "../types";
import { DatePicker } from "../components/DatePicker";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const csvColumns = [
  { key: "onlineRemainingStock", label: "Online Remaining" },
  { key: "offlineRemainingStock", label: "Offline Remaining" },
  { key: "totalRemainingStock", label: "Total Remaining" },
  { key: "totalManualCount", label: "Manual Count" },
  { key: "totalVariance", label: "Variance" },
];

/// Section 4.5 - a read-only, always-current grid combining Online + Offline
/// Remaining Stock per product, calculated from the same records as the
/// Online/Offline entries so it can never fall out of sync.
export function TotalStocksPage() {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<TotalStockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("total-stocks");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  useEffect(() => {
    setRows(null);
    setError(null);
    getTotalStocks(date)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load total stocks"));
  }, [date]);

  // CsvTools expects {product, entry} rows; nulls become "" (not 0) so an
  // uncounted product reads as blank in the export rather than implying a
  // confirmed count of zero. Export always covers the full set - only the
  // on-screen table is affected by the search box.
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
      <h2 style={{ margin: "-8px 0 0px" }}>Total Stocks (Online + Offline) - {formatDateDisplay(date)}</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Review combined online and offline stock balances.
      </p>
      <Toolbar className="no-print">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
          <DatePicker aria-label="Date" value={date} onChange={setDate} style={{ maxWidth: 180 }} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search SKU or category…" />
          <CategoryFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
        </div>
        <ToolbarControls>
          {csvRows && (
            <>
              <CsvTools filenamePrefix="total-stocks" date={date} rows={csvRows} columns={csvColumns} onImportRow={async () => {}} canImport={false}
                exportFormat="excel"
                pdf={{
                  title: "Total Stocks (Online + Offline)",
                  subtitle: formatDateDisplay(date),
                  // Same as TotalStocksTable: only the three "remaining" columns are summed.
                  sumKeys: ["onlineRemainingStock", "offlineRemainingStock", "totalRemainingStock"],
                  flagKey: "totalVariance",
                }}
              />
              <ToolbarDivider />
            </>
          )}
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {!rows ? (
        <p>Loading…</p>
      ) : (
        <div className="ae-grid-fill" style={zoomStyle(zoom)}>
          {/* Keyed by date so switching it remounts the table fresh - every
              category starts expanded again on a newly-loaded date, instead
              of carrying over whatever was collapsed on the last one. */}
          <TotalStocksTable key={date} rows={visibleRows ?? []} />
        </div>
      )}
    </div>
  );
}