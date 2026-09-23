import { Fragment, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Product } from "../types";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { NumberCellInput, TextInput } from "./ui";
import { ChevronIcon } from "./icons";

export interface EntryCustomerColumn {
  id: string;
  customer: string;
  salesRepName: string;
}

/**
 * The editable counterpart to ConsolidatedReceiptTable (Section 4.7) -
 * customers are columns here rather than already-saved receipts, added and
 * named on the fly (see ReceiptsPage's "Bulk Entry" mode, its "+ Add
 * Customer" control), and every quantity cell is a live input instead of a
 * read-only number.
 * Products are still grouped by category with the same collapse/expand
 * treatment as StockGrid/ConsolidatedReceiptTable, and quantity cells reuse
 * StockGrid's NumberCellInput + Enter/ArrowUp/ArrowDown column navigation.
 *
 * Unlike StockGrid, there's no server-backed "current value" to diff
 * against and stage a draft on top of - the whole grid IS the not-yet-saved
 * form, so cells bind straight to `quantities`/`unitPrices` with no
 * separate draft/commit step.
 */
export function ConsolidatedReceiptEntryGrid({
  products,
  customers,
  onRenameCustomer,
  onRemoveCustomer,
  unitPrices,
  onUnitPriceChange,
  quantities,
  onQuantityChange,
}: {
  products: Product[];
  customers: EntryCustomerColumn[];
  onRenameCustomer: (id: string, patch: Partial<Omit<EntryCustomerColumn, "id">>) => void;
  onRemoveCustomer: (id: string) => void;
  /** Keyed by productId - one price applies across every customer's line for that product. */
  unitPrices: Record<number, string>;
  onUnitPriceChange: (productId: number, value: string) => void;
  /** Keyed by `${productId}:${customerId}`. */
  quantities: Record<string, string>;
  onQuantityChange: (productId: number, customerId: string, value: string) => void;
}) {
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({});
  const totalCols = 3 + customers.length;

  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  function cellKey(productId: number, customerId: string) {
    return `${productId}:${customerId}`;
  }

  function focusCell(productId: number, customerId: string) {
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${cellKey(productId, customerId)}"]`);
    el?.focus();
    el?.select();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, productId: number, customerId: string, rowProductIds: number[]) {
    const rowIndex = rowProductIds.indexOf(productId);
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextId = rowProductIds[rowIndex + 1];
      if (nextId !== undefined) focusCell(nextId, customerId);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevId = rowProductIds[rowIndex - 1];
      if (prevId !== undefined) focusCell(prevId, customerId);
    }
  }

  const allProductIds = products.map((p) => p.id);

  if (customers.length === 0) {
    return <p style={{ color: colors.subtleInk }}>Add at least one customer to start entering quantities.</p>;
  }

  return (
    <RowGlowScroll>
      <table className="ae-table ae-table--left" style={{ minWidth: 560 + customers.length * 130 }}>
        <thead>
          <tr>
            <th colSpan={2} style={{ top: 0, verticalAlign: "bottom" }}>
              Product
            </th>
            <th style={{ top: 0, verticalAlign: "bottom", textAlign: "center" }}>Unit Price ({"₱"})</th>
            {customers.map((c) => (
              <th key={c.id} style={{ top: 0, minWidth: 130 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3 }}>
                  <TextInput
                    aria-label="Customer name"
                    placeholder="Customer name"
                    value={c.customer}
                    onChange={(e) => onRenameCustomer(c.id, { customer: e.target.value })}
                    style={{ fontSize: 11, fontWeight: 700, padding: "3px 5px", minWidth: 0, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveCustomer(c.id)}
                    aria-label="Remove customer"
                    title="Remove customer"
                    className="ae-tap-target"
                    style={removeButtonStyle}
                  >
                    ×
                  </button>
                </div>
                <TextInput
                  aria-label="Sales rep (optional)"
                  placeholder="Sales rep (optional)"
                  value={c.salesRepName}
                  onChange={(e) => onRenameCustomer(c.id, { salesRepName: e.target.value })}
                  style={{ fontSize: 10.5, fontWeight: 400, padding: "2px 5px", width: "100%" }}
                />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {[...groups.entries()].map(([category, groupProducts]) => {
            const isCollapsed = !expandedOverride[category];
            return (
              <Fragment key={category}>
                <tr>
                  <td colSpan={totalCols} style={{ padding: 0 }}>
                    <button
                      type="button"
                      onClick={() => setExpandedOverride((e) => ({ ...e, [category]: isCollapsed }))}
                      aria-expanded={!isCollapsed}
                      title={isCollapsed ? `Expand ${category}` : `Collapse ${category}`}
                      style={categoryToggleStyle}
                    >
                      <span style={{ display: "inline-flex", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 120ms ease" }}>
                        <ChevronIcon />
                      </span>
                      {category}
                    </button>
                  </td>
                </tr>

                {groupProducts.map((product) => (
                  <tr key={product.id} className={isCollapsed ? "ae-row-collapsed" : undefined}>
                    <td style={skuCellStyle}>{product.sku ?? "—"}</td>
                    <td style={nameCellStyle}>{product.name}</td>
                    <td>
                      <NumberCellInput
                        value={unitPrices[product.id] ?? ""}
                        onChange={(v) => onUnitPriceChange(product.id, v)}
                        step={0.5}
                        style={priceInputStyle}
                      />
                    </td>
                    {customers.map((c) => (
                      <td key={c.id}>
                        <NumberCellInput
                          data-cell={cellKey(product.id, c.id)}
                          value={quantities[cellKey(product.id, c.id)] ?? ""}
                          onChange={(v) => onQuantityChange(product.id, c.id, v)}
                          onKeyDown={(e) => handleKeyDown(e, product.id, c.id, allProductIds)}
                          style={qtyInputStyle}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

                <tr style={subtotalRowStyle}>
                  <td colSpan={3} style={nameCellStyle}>
                    Subtotal - {category}
                  </td>
                  {customers.map((c) => (
                    <td key={c.id} style={numCellStyle}>
                      {groupProducts.reduce((sum, p) => sum + (Number(quantities[cellKey(p.id, c.id)]) || 0), 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}

          <tr style={grandTotalRowStyle}>
            <td colSpan={3} style={nameCellStyle}>
              GRAND TOTAL
            </td>
            {customers.map((c) => (
              <td key={c.id} style={numCellStyle}>
                {products.reduce((sum, p) => sum + (Number(quantities[cellKey(p.id, c.id)]) || 0), 0).toLocaleString()}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </RowGlowScroll>
  );
}

const nameCellStyle: CSSProperties = { textAlign: "left", whiteSpace: "nowrap", color: colors.ink };
const skuCellStyle: CSSProperties = { textAlign: "left", whiteSpace: "nowrap", color: colors.yellow, fontVariantNumeric: "tabular-nums" };
const numCellStyle: CSSProperties = { textAlign: "center" };
const priceInputStyle: CSSProperties = { width: 76, textAlign: "center" };
const qtyInputStyle: CSSProperties = { width: 64, textAlign: "center" };
const categoryToggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  textAlign: "left",
  font: "inherit",
  fontWeight: 700,
  padding: "6px 8px",
  border: "none",
  borderLeft: `4px solid ${colors.red}`,
  background: "var(--ae-category-bg)",
  color: colors.yellow,
  cursor: "pointer",
};
const subtotalRowStyle: CSSProperties = { fontWeight: 600, background: colors.paperAlt };
const grandTotalRowStyle: CSSProperties = { fontWeight: 700, background: colors.warningBg, borderTop: `2px solid ${colors.black}` };
const removeButtonStyle: CSSProperties = {
  flexShrink: 0,
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: "50%",
  background: "transparent",
  color: colors.danger,
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
};
