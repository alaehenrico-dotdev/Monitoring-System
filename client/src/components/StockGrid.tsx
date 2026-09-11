import { Fragment, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Product } from "../types";
import { colors } from "../theme";

export interface GridRow {
  product: Product;
  entry: Record<string, unknown>;
  isSaved?: boolean;
  isFlagged?: boolean;
}

export interface GridColumn {
  key: string;
  label: string;
  editable?: boolean;
  /** Read-only calculated columns are shown but locked, like a spreadsheet formula cell (Section 3.1). */
}

interface StockGridProps {
  rows: GridRow[];
  columns: GridColumn[];
  /** Called when an editable cell is committed (blur or Enter). */
  onCommit: (productId: number, key: string, value: number) => void | Promise<void>;
  readOnly?: boolean;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(v);
}

/**
 * Section 3.1 - An Excel-Like Data Entry Experience: rows are products
 * (grouped by category, in the same order as the current sheet), cells are
 * edited in place with Tab/Enter/arrow-key navigation, calculated columns are
 * shown but not directly editable, and a subtotal row per category plus a
 * grand total row sit at the bottom of the table.
 */
export function StockGrid({ rows, columns, onCommit, readOnly }: StockGridProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const groups = new Map<string, GridRow[]>();
  for (const row of rows) {
    const list = groups.get(row.product.category) ?? [];
    list.push(row);
    groups.set(row.product.category, list);
  }

  function cellId(productId: number, key: string) {
    return `${productId}:${key}`;
  }

  function focusCell(productId: number, key: string) {
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${cellId(productId, key)}"]`);
    el?.focus();
    el?.select();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, productId: number, key: string, rowIds: number[]) {
    const rowIndex = rowIds.indexOf(productId);
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextId = rowIds[rowIndex + 1];
      if (nextId !== undefined) focusCell(nextId, key);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevId = rowIds[rowIndex - 1];
      if (prevId !== undefined) focusCell(prevId, key);
    }
  }

  async function commit(productId: number, key: string) {
    const draftKey = cellId(productId, key);
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    const value = toNum(draft);
    setDrafts((d) => {
      const next = { ...d };
      delete next[draftKey];
      return next;
    });
    await onCommit(productId, key, value);
  }

  const allProductIds = rows.map((r) => r.product.id);

  return (
    <div style={{ overflowX: "auto" }} className="table-scroll">
      <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
        <thead>
          <tr>
            <th style={thStyle}>Product</th>
            {columns.map((c) => (
              <th key={c.key} style={thStyle}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([category, groupRows]) => (
            <Fragment key={category}>
              <tr key={`${category}-header`}>
                <td colSpan={columns.length + 1} style={categoryRowStyle}>
                  {category}
                </td>
              </tr>
              {groupRows.map((row) => (
                <tr key={row.product.id} style={row.isFlagged ? { background: colors.warningBg } : undefined}>
                  <td style={nameCellStyle}>{row.product.name}</td>
                  {columns.map((col) => {
                    const draftKey = cellId(row.product.id, col.key);
                    const raw = row.entry[col.key];
                    const displayValue = drafts[draftKey] ?? (raw === null || raw === undefined ? "" : String(raw));
                    if (!col.editable || readOnly) {
                      return (
                        <td key={col.key} style={{ ...tdStyle, ...(col.editable ? {} : lockedStyle) }}>
                          {raw === null || raw === undefined ? "—" : Number(raw).toLocaleString()}
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} style={tdStyle}>
                        <input
                          className="ae-input ae-input-cell"
                          data-cell={draftKey}
                          type="number"
                          value={displayValue}
                          onChange={(e) => setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))}
                          onBlur={() => commit(row.product.id, col.key)}
                          onKeyDown={(e) => handleKeyDown(e, row.product.id, col.key, allProductIds)}
                          style={inputStyle}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr key={`${category}-subtotal`} style={subtotalRowStyle}>
                <td style={tdStyle}>Subtotal - {category}</td>
                {columns.map((col) => (
                  <td key={col.key} style={tdStyle}>
                    {groupRows.reduce((sum, r) => sum + toNum(r.entry[col.key]), 0).toLocaleString()}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
          <tr style={grandTotalRowStyle}>
            <td style={tdStyle}>GRAND TOTAL</td>
            {columns.map((col) => (
              <td key={col.key} style={tdStyle}>
                {rows.reduce((sum, r) => sum + toNum(r.entry[col.key]), 0).toLocaleString()}
              </td>
            ))}
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
  whiteSpace: "nowrap",
  background: colors.border,
  position: "sticky",
  top: 0,
};
const tdStyle: CSSProperties = { textAlign: "right", padding: "3px 6px", borderBottom: `1px solid ${colors.border}` };
// Product names never wrap - a long name (e.g. "Distilled Cane Vinegar
// White") just widens this one column instead of breaking to a second line
// and inflating every row's height.
const nameCellStyle: CSSProperties = { ...tdStyle, textAlign: "left", whiteSpace: "nowrap" };
const lockedStyle: CSSProperties = { background: "#faf7ee", color: colors.subtleInk };
// Border/radius/focus ring come from the shared .ae-input class - only the
// sizing that's specific to this dense grid layout is overridden here.
const inputStyle: CSSProperties = { width: 64, textAlign: "right" };
const categoryRowStyle: CSSProperties = {
  textAlign: "left",
  fontWeight: 700,
  padding: "6px 8px",
  background: colors.black,
  color: colors.gold,
  borderLeft: `4px solid ${colors.red}`,
};
const subtotalRowStyle: CSSProperties = { fontWeight: 600, background: "#F3ECD8" };
const grandTotalRowStyle: CSSProperties = { fontWeight: 700, background: colors.warningBg, borderTop: `2px solid ${colors.black}` };
