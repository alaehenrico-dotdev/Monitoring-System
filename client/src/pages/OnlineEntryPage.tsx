import { useEffect, useState } from "react";
import { StockGrid, type GridRow } from "../components/StockGrid";
import { getOnlineGrid, saveOnlineEntry } from "../api/onlineStock";
import { useAuth } from "../context/AuthContext";
import { TextInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { onlineStockColumns as columns } from "../config/stockColumns";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OnlineEntryPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("online-entry");
  const [query, setQuery] = useState("");
  const canEdit = user?.role === "ONLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";

  // Search only affects what's displayed in the grid - CsvTools keeps
  // working off the full, unfiltered `rows` so import-matching and export
  // still cover every product regardless of the current search text.
  const visibleRows = rows?.filter((r) => matchesSearch([r.product.name, r.product.category], query));

  useEffect(() => {
    setRows(null);
    getOnlineGrid(date)
      .then((data) => setRows(data as unknown as GridRow[]))
      .catch((e) => setError(e.message));
  }, [date]);

  // The save endpoint already returns the fully-recalculated row, so a
  // single edit only needs one round trip - merge that row into local state
  // instead of re-fetching all ~60 products' worth of grid data every time
  // a cell is committed.
  function mergeEntry(productId: number, saved: unknown) {
    setRows((prev) =>
      prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved as unknown as typeof r.entry, isSaved: true } : r)) ?? prev
    );
  }

  async function handleCommit(productId: number, key: string, value: number) {
    setError(null);
    try {
      const saved = await saveOnlineEntry(productId, date, { [key]: value });
      mergeEntry(productId, saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  // CSV import applies every editable column present in the file for one
  // product/date in a single request, then merges the result exactly like a
  // manual cell edit would (Section 3.1 - bulk correction via a spreadsheet
  // file instead of retyping cell by cell).
  async function handleImportRow(productId: number, values: Record<string, number>) {
    const saved = await saveOnlineEntry(productId, date, values);
    mergeEntry(productId, saved);
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 6px" }}>Daily Online Stock Monitoring - {formatDateDisplay(date)}</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk }}>
        Stocks In/Out transfers entered here mirror automatically onto the Offline table (Section 4.3).
      </p>
      <Toolbar className="no-print">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <TextInput type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 180 }} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search product or category…" />
        </div>
        <ToolbarControls>
          {rows && (
            <>
              <CsvTools filenamePrefix="online-stock" date={date} rows={rows} columns={columns} onImportRow={handleImportRow} canImport={canEdit} />
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
        <div style={zoomStyle(zoom)}>
          <StockGrid rows={visibleRows ?? []} columns={columns} onCommit={handleCommit} readOnly={!canEdit} />
        </div>
      )}
      {!canEdit && <p style={{ fontSize: 12, color: colors.subtleInk, marginTop: 8 }}>Read-only: your role can view but not edit Online entries.</p>}
    </div>
  );
}
