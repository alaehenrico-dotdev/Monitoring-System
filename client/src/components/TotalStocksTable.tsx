import { Fragment, type CSSProperties } from "react";
import type { TotalStockRow } from "../types";
import { colors } from "../theme";

/**
 * Section 4.5 - the Total Stocks grid, extracted so both TotalStocksPage and
 * the Daily Report render the exact same table instead of the Daily Report
 * hand-rolling its own (buggy) version. Grouped by category with a subtotal
 * row per category and a grand total row, matching Section 3.1's pattern for
 * every other grid in the app - Total Stocks was the one place missing it.
 */
export function TotalStocksTable({ rows }: { rows: TotalStockRow[] }) {
  const groups = new Map<string, TotalStockRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.totalRemainingStock, 0);

  return (
    <div style={{ overflowX: "auto" }} className="table-scroll">
      <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
        <thead>
          <tr>
            {["Product", "Online Remaining", "Offline Remaining", "Total Remaining", "Manual Count", "Variance"].map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([category, groupRows]) => (
            <Fragment key={category}>
              <tr>
                <td colSpan={6} style={categoryRowStyle}>
                  {category}
                </td>
              </tr>
              {groupRows.map((r) => (
                <tr key={r.product.id} style={r.totalVariance ? { background: colors.warningBg } : undefined}>
                  <td style={nameCellStyle}>{r.product.name}</td>
                  <td style={tdStyle}>{r.onlineRemainingStock.toLocaleString()}</td>
                  <td style={tdStyle}>{r.offlineRemainingStock.toLocaleString()}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.totalRemainingStock.toLocaleString()}</td>
                  <td style={tdStyle}>{r.totalManualCount ?? "—"}</td>
                  <td style={tdStyle}>{r.totalVariance ?? "—"}</td>
                </tr>
              ))}
              <tr style={subtotalRowStyle}>
                <td style={nameCellStyle}>Subtotal - {category}</td>
                <td style={tdStyle}>{groupRows.reduce((s, r) => s + r.onlineRemainingStock, 0).toLocaleString()}</td>
                <td style={tdStyle}>{groupRows.reduce((s, r) => s + r.offlineRemainingStock, 0).toLocaleString()}</td>
                <td style={tdStyle}>{groupRows.reduce((s, r) => s + r.totalRemainingStock, 0).toLocaleString()}</td>
                <td style={tdStyle} colSpan={2} />
              </tr>
            </Fragment>
          ))}
          <tr style={grandTotalRowStyle}>
            <td style={nameCellStyle}>GRAND TOTAL</td>
            <td style={tdStyle}>{rows.reduce((s, r) => s + r.onlineRemainingStock, 0).toLocaleString()}</td>
            <td style={tdStyle}>{rows.reduce((s, r) => s + r.offlineRemainingStock, 0).toLocaleString()}</td>
            <td style={tdStyle}>{grandTotal.toLocaleString()}</td>
            <td style={tdStyle} colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "5px 6px",
  borderBottom: `2px solid ${colors.black}`,
  background: colors.border,
  whiteSpace: "nowrap",
};
const tdStyle: CSSProperties = { textAlign: "right", padding: "3px 6px", borderBottom: `1px solid ${colors.border}` };
const nameCellStyle: CSSProperties = { ...tdStyle, textAlign: "left", whiteSpace: "nowrap" };
const categoryRowStyle: CSSProperties = {
  textAlign: "left",
  fontWeight: 700,
  padding: "6px 8px",
  background: colors.black,
  color: colors.yellow,
  borderLeft: `4px solid ${colors.red}`,
};
const subtotalRowStyle: CSSProperties = { fontWeight: 600, background: "#F3ECD8" };
const grandTotalRowStyle: CSSProperties = { fontWeight: 700, background: colors.warningBg, borderTop: `2px solid ${colors.black}` };
