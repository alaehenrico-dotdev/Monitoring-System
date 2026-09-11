import { useEffect, useState, type CSSProperties } from "react";
import { getManualCountGrid, saveManualCount } from "../api/manualCounts";
import type { ManualCountGridRow, StockLocation } from "../types";
import { Select, TextInput } from "../components/ui";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { CsvTools } from "../components/CsvTools";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const LOCATIONS: StockLocation[] = ["ONLINE", "OFFLINE", "TOTAL"];

const csvColumns = [
  { key: "systemRemainingStock", label: "System Remaining" },
  { key: "manualCount", label: "Manual Count" },
  { key: "variance", label: "Variance" },
];

/// Section 4.4 - the supervisor (or encoder on duty) enters the physical
/// count; Variance = System Remaining Stock - Manual Count is always
/// system-calculated, never typed directly.
export function ManualCountPage() {
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState<StockLocation>("ONLINE");
  const [rows, setRows] = useState<ManualCountGridRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useZoom("manual-count");
  const [query, setQuery] = useState("");

  function load() {
    setRows(null);
    getManualCountGrid(date, location)
      .then(setRows)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [date, location]);

  async function commit(productId: number) {
    const draft = drafts[productId];
    if (draft === undefined || draft === "") return;
    setError(null);
    try {
      const saved = await saveManualCount(productId, date, location, Number(draft));
      setDrafts((d) => {
        const next = { ...d };
        delete next[productId];
        return next;
      });
      // Merge the recalculated row (system remaining stock + variance) in
      // directly instead of re-fetching the whole grid for one edit.
      setRows((prev) =>
        prev?.map((r) => (r.product.id === productId ? { ...r, entry: saved, isSaved: true, isFlagged: Number(saved.variance) !== 0 } : r)) ??
        prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const flaggedCount = rows?.filter((r) => r.isFlagged).length ?? 0;

  // Nulls (not yet counted) export as blank cells rather than "0", which
  // would misleadingly read as a confirmed zero count.
  const csvRows = rows?.map((r) => ({
    product: r.product,
    entry: {
      systemRemainingStock: r.entry.systemRemainingStock,
      manualCount: r.entry.manualCount ?? "",
      variance: r.entry.variance ?? "",
    },
  }));

  const visibleRows = rows?.filter((r) => matchesSearch([r.product.name, r.product.category], query));

  return (
    <div>
      <h2 style={{ margin: "0 0 6px" }}>Manual Counting &amp; Variance - {formatDateDisplay(date)}</h2>
      <Toolbar className="no-print">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <TextInput type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value as StockLocation)}>
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <SearchInput value={query} onChange={setQuery} placeholder="Search product or category…" />
          {flaggedCount > 0 && (
            <span style={{ color: colors.warningText, fontSize: 13, fontWeight: 600 }}>
              ⚠ {flaggedCount} product(s) with a non-zero variance
            </span>
          )}
        </div>
        <ToolbarControls>
          {csvRows && (
            <>
              <CsvTools
                filenamePrefix={`manual-count-${location.toLowerCase()}`}
                date={date}
                rows={csvRows}
                columns={csvColumns}
                onImportRow={async () => {}}
                canImport={false}
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
        <div style={zoomStyle(zoom)}>
          {/* Same containment as StockGrid: the scrollbar belongs to this
              inner wrapper, not the page - at high zoom the table scrolls
              sideways in place instead of pushing the whole page (heading,
              date/location fields) off to the right. */}
          <div style={{ overflowX: "auto" }} className="table-scroll">
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr>
                  {["Category", "Product", "System Remaining", "Manual Count", "Variance"].map((h) => (
                    <th
                      key={h}
                      style={{ textAlign: "left", padding: "5px 6px", borderBottom: `2px solid ${colors.black}`, background: colors.border, whiteSpace: "nowrap" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(visibleRows ?? []).map((r) => (
                  <tr key={r.product.id} style={r.isFlagged ? { background: colors.warningBg } : undefined}>
                    <td style={{ ...tdStyle, textAlign: "left", whiteSpace: "nowrap" }}>{r.product.category}</td>
                    <td style={nameCellStyle}>{r.product.name}</td>
                    {/* Prisma Decimal fields serialize as JSON strings once a row is
                        persisted (unlike the plain-number preview shown before a
                        row is saved), so this is wrapped in Number() rather than
                        relying on .toLocaleString() alone - a bare string's
                        .toLocaleString() is a silent no-op, not a crash, but it
                        would drop thousands-separator formatting on saved rows. */}
                    <td style={tdStyle}>{Number(r.entry.systemRemainingStock).toLocaleString()}</td>
                    <td style={tdStyle}>
                      <input
                        className="ae-input ae-input-cell"
                        type="number"
                        value={drafts[r.product.id] ?? r.entry.manualCount ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.product.id]: e.target.value }))}
                        onBlur={() => commit(r.product.id)}
                        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                        style={{ width: 64, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: r.isFlagged ? 700 : 400 }}>{r.entry.variance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const tdStyle: CSSProperties = { textAlign: "right", padding: "3px 6px", borderBottom: `1px solid ${colors.border}` };
const nameCellStyle: CSSProperties = { ...tdStyle, textAlign: "left", whiteSpace: "nowrap" };
