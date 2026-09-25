import {
  Fragment,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { Product } from "../types";
import { colors } from "../theme";
import { RowGlowScroll } from "./RowGlowScroll";
import { NumberCellInput, TextInput, Button } from "./ui";
import { ChevronIcon, FileAddIcon } from "./icons";
import { formatPeso, formatQty } from "../utils/consolidatedReceipts";

/** Customer cards shown per page (see the pager in the returned JSX below). */
const CUSTOMERS_PER_PAGE = 4;
/** Fixed width for the frozen SKU column, so the Product-name column next to it has a deterministic sticky offset (see .ae-bulk-fixed-col in index.css). */
const SKU_COL_WIDTH = 72;

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
 * Each customer gets its own Quantity / Price / Total column triplet
 * (matching the paper bulk-entry sheet this mirrors), so price is entered
 * per customer per product rather than once per product for the whole
 * sheet - two customers can be quoted differently for the same item.
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
  onAddCustomer,
  unitPrices,
  onUnitPriceChange,
  quantities,
  onQuantityChange,
  categoryFilter = "",
}: {
  products: Product[];
  customers: EntryCustomerColumn[];
  onRenameCustomer: (
    id: string,
    patch: Partial<Omit<EntryCustomerColumn, "id">>,
  ) => void;
  onRemoveCustomer: (id: string) => void;
  /** Renders the trailing blank "next page" sheet as a real Add Customer control when given. */
  onAddCustomer?: () => void;
  /** Keyed by `${productId}:${customerId}` - price is per customer, per product. */
  unitPrices: Record<string, string>;
  onUnitPriceChange: (
    productId: number,
    customerId: string,
    value: string,
  ) => void;
  /** Keyed by `${productId}:${customerId}`. */
  quantities: Record<string, string>;
  onQuantityChange: (
    productId: number,
    customerId: string,
    value: string,
  ) => void;
  /**
   * Shows only this category's rows ("" = every category). Purely a view
   * filter: subtotals still cover their own category and the TOTAL row
   * still sums every product, so hiding a category never changes what a
   * customer's receipt adds up to. The chosen category also opens by
   * default (unless collapsed by hand), since filtering to a category
   * you then have to expand would defeat the point.
   */
  categoryFilter?: string;
}) {
  const [expandedOverride, setExpandedOverride] = useState<
    Record<string, boolean>
  >({});

  const [page, setPage] = useState(0);
  const pageCount = Math.max(
    1,
    Math.ceil(customers.length / CUSTOMERS_PER_PAGE),
  );
  // Jumps to the newly-created last page when a customer is added (so the
  // fresh blank card is actually visible), and clamps back when removing a
  // customer leaves the current page past the end - both driven off the
  // customer count itself, never quantity/price edits, so paging away and
  // typing into a cell doesn't get yanked back to another page mid-edit.
  // Adjusted during render (React's documented pattern for state that
  // depends on a prop change) rather than in an effect, which would commit
  // the stale page for one extra render first.
  const [prevCustomerCount, setPrevCustomerCount] = useState(customers.length);
  if (customers.length !== prevCustomerCount) {
    setPrevCustomerCount(customers.length);
    if (customers.length > prevCustomerCount) {
      setPage(pageCount - 1);
    } else if (page > pageCount - 1) {
      setPage(pageCount - 1);
    }
  }
  const pageCustomers = customers.slice(
    page * CUSTOMERS_PER_PAGE,
    page * CUSTOMERS_PER_PAGE + CUSTOMERS_PER_PAGE,
  );

  // SKU + Product name columns, plus a Quantity/Price/Total triplet per
  // customer card on the current page (pagination only changes which cards
  // are on screen - it never changes how many columns a page's own table
  // has).
  const totalCols = 2 + pageCustomers.length * 3;

  const groups = new Map<string, Product[]>();
  for (const p of products) {
    if (categoryFilter !== "" && p.category !== categoryFilter) continue;
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  function cellKey(productId: number, customerId: string) {
    return `${productId}:${customerId}`;
  }

  /**
   * Each customer's Quantity/Price/Total triplet reads as its own sheet in
   * the stack: alternating paper tone, and (from the second customer on) a
   * soft inset shadow along its left edge where the previous sheet would
   * overlap it - the same "page peeking out from under the one in front"
   * cue as the reference mockup, without ever hiding real cell content.
   */
  function sheetStyle(index: number, extra?: CSSProperties): CSSProperties {
    return {
      background: index % 2 === 1 ? "var(--ae-bg-alt)" : undefined,
      boxShadow:
        index > 0 ? "inset 7px 0 6px -6px rgba(20, 17, 13, 0.28)" : undefined,
      ...extra,
    };
  }

  /**
   * A subtle brand-yellow line down a card's right edge - the same "sheet in
   * a stack" cue as sheetStyle's left-edge inset shadow, but marking where
   * this customer's card ends rather than where the one behind it peeks
   * through. Merged into every cell along a card's Total sub-column (the
   * rightmost of its Quantity/Price/Total triplet) plus its header, so the
   * line runs unbroken from the customer-name header down to the grand
   * total row.
   */
  const cardEdgeStyle: CSSProperties = {
    borderRight: "1px solid rgba(255, 212, 0, 0.45)",
  };

  function lineTotal(productId: number, customerId: string): number {
    const key = cellKey(productId, customerId);
    const qty = Number(quantities[key]) || 0;
    const price = Number(unitPrices[key]) || 0;
    return qty * price;
  }

  function focusCell(productId: number, customerId: string) {
    const el = document.querySelector<HTMLInputElement>(
      `[data-cell="${cellKey(productId, customerId)}"]`,
    );
    el?.focus();
    el?.select();
  }

  function handleKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    productId: number,
    customerId: string,
    rowProductIds: number[],
  ) {
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

  // Enter/Arrow navigation walks the rows actually on screen, so it never
  // jumps into a category the filter has hidden.
  const allProductIds = [...groups.values()].flat().map((p) => p.id);

  return (
    // The stacked-pages shell (see .ae-bulk-stack/.ae-bulk-fan in
    // index.css): each customer's Quantity/Price/Total triplet is tinted
    // and edge-shadowed as its own sheet (sheetStyle), receding behind the
    // one to its left, and a genuinely-blank "next page" sheet - Add
    // Customer, styled like the reference mockup's blank corner-plus page -
    // sits at the very front of the stack.
    <div className="ae-bulk-stack">
      {pageCount > 1 && (
        <div className="ae-bulk-pager">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous customers"
          >
            ‹
          </Button>
          <span style={{ minWidth: 130, textAlign: "center" }}>
            Page {page + 1} of {pageCount} · {customers.length} customer
            {customers.length === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            aria-label="Next customers"
          >
            ›
          </Button>
        </div>
      )}
      <div className="ae-bulk-fan">
        <RowGlowScroll className="ae-bulk-stack-scroll">
          <table
            className="ae-table ae-table--left"
            style={{
              width: "auto",
              minWidth: 400 + pageCustomers.length * 260,
            }}
          >
            <thead>
              <tr>
                <th
                  colSpan={2}
                  rowSpan={2}
                  className="ae-bulk-fixed-col ae-bulk-fixed-col--edge"
                  style={{
                    top: 0,
                    verticalAlign: "bottom",
                    left: 0,
                    zIndex: 3,
                    background: "var(--ae-header-bg)",
                  }}
                >
                  SKU / Products
                </th>
                {pageCustomers.map((c, i) => (
                  <th
                    key={c.id}
                    colSpan={3}
                    style={sheetStyle(i, {
                      top: 0,
                      position: "relative",
                      ...cardEdgeStyle,
                    })}
                  >
                    {/* Absolutely positioned in its own reserved gutter
                        (both inputs are narrower than the cell, not just
                        padded) so it never overlaps either input - customer
                        name and sales rep still measure the same as each
                        other. */}
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
                    <TextInput
                      aria-label="Customer name"
                      placeholder="Customer name"
                      value={c.customer}
                      onChange={(e) =>
                        onRenameCustomer(c.id, { customer: e.target.value })
                      }
                      // display: block (inputs default to inline-block) so
                      // it always stacks above Sales Rep rather than
                      // sitting beside it - .ae-table th is white-space:
                      // nowrap for its usual single-line labels, which
                      // would otherwise keep two width: 100% inline-block
                      // inputs from wrapping onto their own lines.
                      style={{
                        display: "block",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 5px",
                        width: "calc(100% - 22px)",
                        boxSizing: "border-box",
                        marginBottom: 3,
                      }}
                    />
                    <TextInput
                      aria-label="Sales rep (optional)"
                      placeholder="Sales rep (optional)"
                      value={c.salesRepName}
                      onChange={(e) =>
                        onRenameCustomer(c.id, { salesRepName: e.target.value })
                      }
                      style={{
                        display: "block",
                        fontSize: 10.5,
                        fontWeight: 400,
                        padding: "2px 5px",
                        width: "calc(100% - 22px)",
                        boxSizing: "border-box",
                      }}
                    />
                  </th>
                ))}
              </tr>
              <tr>
                {pageCustomers.map((c, i) => (
                  <Fragment key={c.id}>
                    <th
                      style={sheetStyle(i, {
                        top: 34,
                        minWidth: 68,
                        textAlign: "center",
                      })}
                    >
                      Quantity
                    </th>
                    <th
                      style={sheetStyle(i, {
                        top: 34,
                        minWidth: 86,
                        textAlign: "center",
                      })}
                    >
                      Price
                    </th>
                    <th
                      style={sheetStyle(i, {
                        top: 34,
                        minWidth: 96,
                        textAlign: "center",
                        ...cardEdgeStyle,
                      })}
                    >
                      Total
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>

            <tbody>
              {[...groups.entries()].map(([category, groupProducts]) => {
                const isCollapsed =
                  categoryFilter !== "" &&
                  expandedOverride[category] === undefined
                    ? false
                    : !expandedOverride[category];
                return (
                  <Fragment key={category}>
                    <tr>
                      <td colSpan={totalCols} style={{ padding: 0 }}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedOverride((e) => ({
                              ...e,
                              [category]: isCollapsed,
                            }))
                          }
                          aria-expanded={!isCollapsed}
                          aria-controls={groupProducts
                            .map(
                              (product) => `ae-receiptentry-row-${product.id}`,
                            )
                            .join(" ")}
                          title={
                            isCollapsed
                              ? `Expand ${category}`
                              : `Collapse ${category}`
                          }
                          style={categoryToggleStyle}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              transform: isCollapsed
                                ? "rotate(-90deg)"
                                : "none",
                              transition:
                                "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
                            }}
                          >
                            <ChevronIcon />
                          </span>
                          {category}
                        </button>
                      </td>
                    </tr>

                    {groupProducts.map((product) => (
                      <tr
                        key={product.id}
                        id={`ae-receiptentry-row-${product.id}`}
                        className={
                          isCollapsed
                            ? "ae-cat-row ae-row-collapsed"
                            : "ae-cat-row"
                        }
                      >
                        <td
                          className="ae-bulk-fixed-col"
                          style={{
                            ...skuCellStyle,
                            left: 0,
                            width: SKU_COL_WIDTH,
                            minWidth: SKU_COL_WIDTH,
                            maxWidth: SKU_COL_WIDTH,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={product.sku ?? undefined}
                        >
                          {product.sku ?? "—"}
                        </td>
                        <td
                          className="ae-bulk-fixed-col ae-bulk-fixed-col--edge"
                          style={{ ...nameCellStyle, left: SKU_COL_WIDTH }}
                          title={product.name}
                        >
                          {product.name}
                        </td>
                        {pageCustomers.map((c, i) => (
                          <Fragment key={c.id}>
                            <td style={sheetStyle(i)}>
                              <NumberCellInput
                                data-cell={cellKey(product.id, c.id)}
                                value={
                                  quantities[cellKey(product.id, c.id)] ?? ""
                                }
                                onChange={(v) =>
                                  onQuantityChange(product.id, c.id, v)
                                }
                                onKeyDown={(e) =>
                                  handleKeyDown(
                                    e,
                                    product.id,
                                    c.id,
                                    allProductIds,
                                  )
                                }
                                style={qtyInputStyle}
                              />
                            </td>
                            <td style={sheetStyle(i)}>
                              <NumberCellInput
                                value={
                                  unitPrices[cellKey(product.id, c.id)] ?? ""
                                }
                                onChange={(v) =>
                                  onUnitPriceChange(product.id, c.id, v)
                                }
                                step={0.5}
                                style={priceInputStyle}
                              />
                            </td>
                            <td
                              style={sheetStyle(i, {
                                ...numCellStyle,
                                ...cardEdgeStyle,
                              })}
                            >
                              {formatPeso(lineTotal(product.id, c.id)) || "—"}
                            </td>
                          </Fragment>
                        ))}
                      </tr>
                    ))}

                    <tr style={subtotalRowStyle}>
                      <td
                        colSpan={2}
                        className="ae-bulk-fixed-col ae-bulk-fixed-col--edge"
                        style={{
                          ...nameCellStyle,
                          left: 0,
                          background: colors.paperAlt,
                        }}
                      >
                        Subtotal - {category}
                      </td>
                      {pageCustomers.map((c, i) => (
                        <Fragment key={c.id}>
                          <td style={sheetStyle(i, numCellStyle)}>
                            {formatQty(
                              groupProducts.reduce(
                                (sum, p) =>
                                  sum +
                                  (Number(quantities[cellKey(p.id, c.id)]) ||
                                    0),
                                0,
                              ),
                            )}
                          </td>
                          <td style={sheetStyle(i)} />
                          <td
                            style={sheetStyle(i, {
                              ...numCellStyle,
                              ...cardEdgeStyle,
                            })}
                          >
                            {formatPeso(
                              groupProducts.reduce(
                                (sum, p) => sum + lineTotal(p.id, c.id),
                                0,
                              ),
                            ) || "—"}
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}

              <tr style={grandTotalRowStyle}>
                <td
                  colSpan={2}
                  className="ae-bulk-fixed-col ae-bulk-fixed-col--edge"
                  style={{
                    ...nameCellStyle,
                    left: 0,
                    background: colors.warningBg,
                  }}
                >
                  TOTAL
                </td>
                {pageCustomers.map((c, i) => (
                  <Fragment key={c.id}>
                    <td style={sheetStyle(i, numCellStyle)}>
                      {formatQty(
                        products.reduce(
                          (sum, p) =>
                            sum +
                            (Number(quantities[cellKey(p.id, c.id)]) || 0),
                          0,
                        ),
                      )}
                    </td>
                    <td style={sheetStyle(i)} />
                    <td
                      style={sheetStyle(i, {
                        ...numCellStyle,
                        ...cardEdgeStyle,
                      })}
                    >
                      {formatPeso(
                        products.reduce(
                          (sum, p) => sum + lineTotal(p.id, c.id),
                          0,
                        ),
                      ) || "—"}
                    </td>
                  </Fragment>
                ))}
              </tr>
            </tbody>
          </table>
        </RowGlowScroll>

        {onAddCustomer && (
          <button
            type="button"
            className="ae-bulk-add-page"
            onClick={onAddCustomer}
            aria-label="Add customer"
            title="Add customer"
          >
            <FileAddIcon />
            <span>
              Add
              <br />
              Customer
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

const nameCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: colors.ink,
};
const skuCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  color: colors.yellow,
  fontVariantNumeric: "tabular-nums",
};
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
const subtotalRowStyle: CSSProperties = {
  fontWeight: 600,
  background: colors.paperAlt,
};
const grandTotalRowStyle: CSSProperties = {
  fontWeight: 700,
  background: colors.warningBg,
  borderTop: `2px solid ${colors.black}`,
};
const removeButtonStyle: CSSProperties = {
  position: "absolute",
  top: 3,
  right: 3,
  zIndex: 2,
  flexShrink: 0,
  width: 18,
  height: 18,
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
