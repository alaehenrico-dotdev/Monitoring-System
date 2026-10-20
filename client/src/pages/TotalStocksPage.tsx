import { useEffect, useState } from "react";
import { getTotalStocks } from "../api/totalStocks";
import type { TotalStockRow } from "../types";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { TotalStocksTable } from "../components/TotalStocksTable";
import { isLowStock } from "../utils/lowStock";
import { PageToolbar } from "../components/PageToolbar";
import { FilterSlot } from "../components/FilterSlot";
import { zoomSection } from "../utils/zoomMenu";
import { Dropdown } from "../components/Dropdown";
import { CollapseAllIcon, ExpandAllIcon, SyncIcon } from "../components/icons";
import { DateStepper } from "../components/DateStepper";
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
  { key: "totalRemainingStock", label: "Consolidated Remaining" },
];

// Narrows the export (Excel/PDF) columns to match whatever the
// StockSourceFilter has on screen, so "Online only" doesn't export an
// Offline/Total column nobody asked to see.
function csvColumnsFor(source: StockLocation) {
  if (source === "ONLINE")
    return allCsvColumns.filter((c) => c.key === "onlineRemainingStock");
  if (source === "OFFLINE")
    return allCsvColumns.filter((c) => c.key === "offlineRemainingStock");
  return allCsvColumns;
}

type StockRowFilter = "all" | "negative" | "low";

const SOURCE_TITLES: Record<StockLocation, string> = {
  TOTAL: "Consolidated (Online + Offline)",
  ONLINE: "Consolidated (Online only)",
  OFFLINE: "Consolidated (Offline only)",
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
  const [rowFilter, setRowFilter] = useState<StockRowFilter>("all");
  // Bumped by View > Refresh to re-read the figures from the server.
  const [refreshTick, setRefreshTick] = useState(0);
  // Expand/collapse every category (the table applies a new `id` once).
  const [catCommand, setCatCommand] = useState<{ expanded: boolean; id: number } | null>(null);
  const [anyExpanded, setAnyExpanded] = useState(false);
  const realtimeVersion = useRealtimeVersion();

  useResetOnKeyChange(date, () => {
    setRows(null);
    setError(null);
  });
  useEffect(() => {
    getTotalStocks(date)
      .then(setRows)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Failed to load consolidated stocks",
        ),
      );
  }, [date, realtimeVersion, refreshTick]);

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

  const categories = Array.from(
    new Set((rows ?? []).map((r) => r.product.category)),
  ).sort();
  const visibleRows = rows?.filter(
    (r) =>
      matchesSearch(
        [r.product.sku, r.product.name, r.product.category],
        query,
      ) &&
      (categoryFilter === "" || r.product.category === categoryFilter) &&
      (rowFilter === "all" ||
        (rowFilter === "negative" ? r.totalRemainingStock < 0 || r.onlineRemainingStock < 0 || r.offlineRemainingStock < 0 : isLowStock(r) || r.totalRemainingStock < 0)),
  );
  const negativeCount = (rows ?? []).filter((r) => r.totalRemainingStock < 0 || r.onlineRemainingStock < 0 || r.offlineRemainingStock < 0).length;
  const lowCount = (rows ?? []).filter((r) => isLowStock(r) || r.totalRemainingStock < 0).length;

  return (
    <div>
      <PageHeader
        title={`${SOURCE_TITLES[source]} - ${formatDateDisplay(date)}`}
        subtitle="Online and offline remaining stock for the date, added together."
      >
        <PageToolbar
          activeFilters={(query.trim() !== "" ? 1 : 0) + (categoryFilter !== "" ? 1 : 0) + (rowFilter !== "all" ? 1 : 0)}
          onClearFilters={() => {
            setQuery("");
            setCategoryFilter("");
            setRowFilter("all");
          }}
          label="Consolidated"
          menus={[
            {
              id: "view",
              label: "View",
              sections: [
                {
                  items: [
                    {
                      id: "expand-all",
                      label: anyExpanded ? "Collapse all categories" : "Expand all categories",
                      icon: anyExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />,
                      disabledReason: rows ? undefined : "The sheet is still loading",
                      onSelect: () => setCatCommand({ expanded: !anyExpanded, id: Date.now() }),
                    },
                    { id: "refresh", label: "Refresh", icon: <SyncIcon />, onSelect: () => setRefreshTick((t) => t + 1) },
                  ],
                },
                zoomSection(zoom, setZoom),
              ],
            },
          ]}
          filters={
            <>
              <FilterSlot active={query.trim() !== ""} label="Search">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search SKU or category…"
                />
              </FilterSlot>
              <FilterSlot active={categoryFilter !== ""} label="Category">
                <CategoryFilter
                  categories={categories}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                />
              </FilterSlot>
              <FilterSlot active={rowFilter !== "all"} label="Rows">
                <Dropdown
                  aria-label="Filter rows"
                  value={rowFilter}
                  onChange={(v) => setRowFilter(v as StockRowFilter)}
                  options={[
                    { value: "all", label: "All rows" },
                    { value: "negative", label: negativeCount ? `Only negative (${negativeCount})` : "Only negative", title: "Products whose stock is below zero" },
                    { value: "low", label: lowCount ? `Low or negative (${lowCount})` : "Low or negative", title: "Products at or under their alert level, or below zero" },
                  ]}
                />
              </FilterSlot>
              <StockSourceFilter value={source} onChange={setSource} />
              <DateStepper
                value={date}
                onChange={setDate}
                todayValue={getCurrentShiftAndDate().date}
              />
            </>
          }
          actions={
            csvRows && (
              <CsvTools
                filenamePrefix="consolidated"
                date={date}
                rows={csvRows}
                columns={csvColumns}
                onImportRow={async () => {}}
                getPendingValue={() => undefined}
                canImport={false}
                exportFormat="excel"
                pdf={{
                  title: SOURCE_TITLES[source],
                  subtitle: formatDateDisplay(date),
                  // Same as TotalStocksTable: only the visible "remaining" columns are summed.
                  sumKeys: csvColumns.map((c) => c.key),
                  flagKey: "totalVariance",
                }}
              />
            )
          }
          trailing={<ZoomControl zoom={zoom} onChange={setZoom} />}
        />
      </PageHeader>
      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />
      {!rows ? (
        <TableSkeleton
          headers={["SKU", "Product", ...csvColumns.map((c) => c.label)]}
          minWidth={640}
          label="Loading consolidated stocks…"
        />
      ) : (
        <div className="ae-grid-fill" style={zoomStyle(zoom)}>
          {/* Keyed by date so switching it remounts the table fresh - every
              category starts expanded again on a newly-loaded date, instead
              of carrying over whatever was collapsed on the last one. Also
              remounts on `source` so a collapsed category doesn't carry a
              stale column count across an Online/Offline/Total switch. */}
          <TotalStocksTable
            key={`${date}-${source}`}
            rows={visibleRows ?? []}
            source={source}
            expandAllCommand={catCommand}
            onAnyExpandedChange={setAnyExpanded}
          />
        </div>
      )}
    </div>
  );
}
