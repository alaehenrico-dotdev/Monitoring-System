import { useEffect, useState } from "react";
import { getTotalStocks } from "../api/totalStocks";
import type { TotalStockRow } from "../types";
import { TextInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";

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
  const [zoom, setZoom] = useZoom("total-stocks");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(null);
    getTotalStocks(date).then(setRows);
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

  const visibleRows = rows?.filter((r) => matchesSearch([r.product.name, r.product.category], query));

  return (
    <div>
      <h2 style={{ margin: "0 0 6px" }}>Total Stocks (Online + Offline) - {formatDateDisplay(date)}</h2>
      <Toolbar className="no-print">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <TextInput type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search product or category…" />
        </div>
        <ToolbarControls>
          {csvRows && (
            <>
              <CsvTools filenamePrefix="total-stocks" date={date} rows={csvRows} columns={csvColumns} onImportRow={async () => {}} canImport={false} />
              <ToolbarDivider />
            </>
          )}
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>
      {!rows ? (
        <p>Loading…</p>
      ) : (
        <div style={zoomStyle(zoom)}>
          <TotalStocksTable rows={visibleRows ?? []} />
        </div>
      )}
    </div>
  );
}
