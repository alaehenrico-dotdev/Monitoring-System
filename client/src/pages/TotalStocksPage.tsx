import { useEffect, useState, type CSSProperties } from "react";
import { getTotalStocks } from "../api/totalStocks";
import type { TotalStockRow } from "../types";
import { Field, TextInput } from "../components/ui";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/// Section 4.5 - a read-only, always-current grid combining Online + Offline
/// Remaining Stock per product, calculated from the same records as the
/// Online/Offline entries so it can never fall out of sync.
export function TotalStocksPage() {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<TotalStockRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    getTotalStocks(date).then(setRows);
  }, [date]);

  const grandTotal = rows?.reduce((sum, r) => sum + r.totalRemainingStock, 0) ?? 0;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Total Stocks (Online + Offline)</h2>
      <Field label="Date" style={{ marginBottom: 16, maxWidth: 180 }}>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%" }} />
      </Field>
      {!rows ? (
        <p>Loading…</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr>
              {["Category", "Product", "Online Remaining", "Offline Remaining", "Total Remaining", "Manual Count", "Variance"].map((h) => (
                <th
                  key={h}
                  style={{ textAlign: "right", padding: "5px 6px", borderBottom: `2px solid ${colors.black}`, background: colors.border, whiteSpace: "nowrap" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product.id} style={r.totalVariance ? { background: colors.warningBg } : undefined}>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{r.product.category}</td>
                <td style={nameCellStyle}>{r.product.name}</td>
                <td style={tdStyle}>{r.onlineRemainingStock.toLocaleString()}</td>
                <td style={tdStyle}>{r.offlineRemainingStock.toLocaleString()}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.totalRemainingStock.toLocaleString()}</td>
                <td style={tdStyle}>{r.totalManualCount ?? "—"}</td>
                <td style={tdStyle}>{r.totalVariance ?? "—"}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: `2px solid ${colors.black}`, background: colors.warningBg }}>
              <td style={tdStyle} colSpan={4}>
                GRAND TOTAL
              </td>
              <td style={tdStyle}>{grandTotal.toLocaleString()}</td>
              <td style={tdStyle} colSpan={2} />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

const tdStyle: CSSProperties = { textAlign: "right", padding: "3px 6px", borderBottom: `1px solid ${colors.border}` };
const nameCellStyle: CSSProperties = { ...tdStyle, textAlign: "left", whiteSpace: "nowrap" };
