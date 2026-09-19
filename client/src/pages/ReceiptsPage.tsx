import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { createReceipt, listReceipts } from "../api/receipts";
import { listProducts } from "../api/products";
import type { Product, Receipt } from "../types";
import { colors } from "../theme";
import {
  Divider,
  ReceiptCard,
  ReceiptPaper,
  RECEIPT_CARD_WIDTH,
} from "../components/ReceiptCard";
import { Button, Select } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { useAuth } from "../context/AuthContext";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { generateReceiptPdf } from "../utils/receiptPdf";
import { PrinterIcon } from "../components/icons";
/*
 * ============================================================
 * THERMAL RECEIPT PRINT SETTINGS
 * ============================================================
 *
 * Standard thermal POS paper comes in two common widths:
 *
 *   58mm  - smallest widely-supported thermal roll (kiosk /
 *           handheld printers), ~48mm printable
 *   80mm  - standard counter POS printer, ~72mm printable
 *
 * There is no smaller "standard" thermal size below 58mm, so we
 * offer both rather than guessing which hardware the user has.
 */
const THERMAL_PAPER_SIZES = {
  "58mm": { paperMM: 58, printableMM: 48, label: "58mm (small)" },
  "80mm": { paperMM: 80, printableMM: 72, label: "80mm (standard)" },
} as const;

type ThermalPaperSize = keyof typeof THERMAL_PAPER_SIZES;

const DEFAULT_THERMAL_PAPER_SIZE: ThermalPaperSize = "58mm";

// CSS pixels per millimeter at the browser's standard 96 DPI.
const PX_PER_MM = 96 / 25.4;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Small top nudge for the receipt entry columns.
const RECEIPT_COLUMN_TOP = 8;

// "Recent Receipts" visible rows.
const RECEIPT_LIST_VISIBLE_ROWS = 20;
const RECEIPT_LIST_MAX_HEIGHT = 29 + RECEIPT_LIST_VISIBLE_ROWS * 23;

interface LineItem {
  productId: number;
  quantity: string;
}

/**
 * Section 4.7 - Receipt / Sales Order Entry.
 *
 * The entry form is displayed as an editable receipt on the left,
 * with a live receipt preview on the right.
 */
export function ReceiptsPage() {
  const { user } = useAuth();

  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [zoom, setZoom] = useZoom("receipts");
  const [query, setQuery] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  // Thermal paper size chosen for the print/PDF modal. Persists across
  // receipt selections within a session so repeat prints don't require
  // re-picking the same size each time.
  const [paperSize, setPaperSize] = useState<ThermalPaperSize>(
    DEFAULT_THERMAL_PAPER_SIZE
  );

  const [orderDate, setOrderDate] = useState(today());
  const [customer, setCustomer] = useState("");
  const [location, setLocation] = useState("");
  const [salesRepName, setSalesRepName] = useState("");
  const [postToFulfillment, setPostToFulfillment] = useState(true);

  const [items, setItems] = useState<LineItem[]>([
    { productId: 0, quantity: "" },
  ]);

  /*
   * Load receipts and products.
   */
  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load receipts");
        setReceipts([]);
      });

    listProducts()
      .then(setProducts)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load SKUs")
      );
  }, []);

  /*
   * Update one order item.
   */
  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  }

  /*
   * Add another product row.
   */
  function addItemRow() {
    setItems((prev) => [...prev, { productId: 0, quantity: "" }]);
  }

  /*
   * Remove a product row.
   */
  function removeItemRow(index: number) {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index)
    );
  }

  /*
   * Save the receipt.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validItems = items.filter(
      (it) => it.productId && Number(it.quantity) > 0
    );

    if (!customer || !location || !validItems.length) {
      setError(
        "Customer, location, and at least one order item are required."
      );
      return;
    }

    setSubmitting(true);

    try {
      const saved = await createReceipt({
        orderDate,
        customer,
        location,
        salesRepName: salesRepName.trim() || undefined,
        postToFulfillment,
        items: validItems.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
        })),
      });

      setReceipts((prev) => [saved, ...(prev ?? [])]);

      setCustomer("");
      setLocation("");
      setSalesRepName("");
      setItems([{ productId: 0, quantity: "" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save receipt");
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * ============================================================
   * PRINT THERMAL RECEIPT
   * ============================================================
   *
   * Printed from an isolated <iframe> containing ONLY a clone of the
   * receipt paper - nothing else exists in that document, so there is
   * nothing else for the browser to paginate around. That guarantees a
   * single page, sized to exactly the selected thermal paper width and
   * to the receipt's own rendered height (so a 3-item and a 30-item
   * receipt each get a page sized to fit them, not a fixed page with
   * blank space or clipped overflow).
   *
   * The receipt card itself (`ReceiptCard`/`ReceiptPaper`) is built at a
   * fixed pixel design width/padding/font-size. Rather than forcing a
   * narrow physical width onto that fixed layout (which would wrap or
   * clip text), we apply a `zoom` factor - computed from the selected
   * thermal paper size - to the CLONED copy inside the print-only
   * document. This shrinks the whole box uniformly (padding, text, the
   * zigzag clip-path) without affecting the full-size version shown on
   * screen, and the physical page size falls out of that already-correct
   * rendered size.
   */
  function handlePrintReceipt() {
    const paperEl = document.querySelector<HTMLElement>(
      ".ae-modal-panel .ae-receipt-paper"
    );

    if (!paperEl) {
      window.print();
      return;
    }

    const { paperMM: paperWidthMM } = THERMAL_PAPER_SIZES[paperSize];

    const styleHtml = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]')
    )
      .map((el) => el.outerHTML)
      .join("\n");

    const receiptHtml = paperEl.outerHTML;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");

    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      iframe.remove();
      window.print();
      return;
    }

    // Re-bind to a variable TS knows is non-null for the lifetime of this
    // closure - `iframeDoc`'s null-check above doesn't automatically
    // narrow inside the nested `printOnce` function below.
    const doc: Document = iframeDoc;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    ${styleHtml}
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
      }
      /* The receipt's rendered (post-zoom) width is narrower than the
         physical paper roll (printable vs. full roll width) - center it
         rather than stretching it to fill the roll. */
      body {
        display: flex;
        justify-content: center;
      }
      .ae-receipt-paper {
        margin: 0 !important;
        border: 0 !important;
        box-shadow: none !important;
        transform: none !important;
        zoom: ${thermalScale} !important;
      }
    </style>
  </head>
  <body>
    ${receiptHtml}
  </body>
</html>`);
    doc.close();

    let printed = false;

    function printOnce() {
      if (printed) return;
      printed = true;

      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        return;
      }

      // Measure the ACTUAL rendered (post-zoom) height so the page is
      // sized to exactly one receipt, whatever its line-item count.
      const printedPaper = doc.querySelector<HTMLElement>(".ae-receipt-paper");
      const heightMM = Math.max(
        30,
        (printedPaper?.getBoundingClientRect().height ?? 0) / PX_PER_MM
      );

      const pageStyle = doc.createElement("style");
      pageStyle.textContent = `
        @page {
          size: ${paperWidthMM}mm ${heightMM.toFixed(2)}mm;
          margin: 0;
        }
      `;
      doc.head.appendChild(pageStyle);

      win.focus();
      win.print();

      let removed = false;
      function cleanup() {
        if (removed) return;
        removed = true;
        iframe.remove();
      }

      win.addEventListener("afterprint", cleanup);
      // Fallback in case `afterprint` doesn't fire in some browsers.
      setTimeout(cleanup, 5000);
    }

    // document.write'd content doesn't always fire `onload` reliably, so
    // a short timeout backs it up.
    iframe.onload = printOnce;
    setTimeout(printOnce, 150);
  }

  /*
   * Build the live receipt preview from the current form.
   */
  const previewReceipt: Receipt = useMemo(() => {
    const previewItems = items
      .map((it, idx) => {
        const product = products.find((p) => p.id === it.productId);

        if (!product || !(Number(it.quantity) > 0)) {
          return null;
        }

        return {
          id: idx,
          productId: it.productId,
          product,
          quantity: Number(it.quantity),
        };
      })
      .filter((it): it is NonNullable<typeof it> => it !== null);

    return {
      id: 0,
      orderDate,
      customer,
      location,
      salesRepName: salesRepName.trim() || null,
      salesRepId: null,
      salesRep: null,
      createdBy: user
        ? { id: user.id, username: user.username, name: user.name, role: user.role }
        : null,
      createdAt: new Date().toISOString(),
      items: previewItems,
    };
  }, [orderDate, customer, location, items, products, user, salesRepName]);

  /*
   * Search and sort recent receipts.
   */
  const visibleReceipts = receipts
    ?.filter((r) =>
      matchesSearch(
        [
          r.customer,
          r.location,
          r.salesRepName,
          ...r.items.map((it) => it.product.name),
          ...r.items.map((it) => it.product.sku),
        ],
        query
      )
    )
    .sort((a, b) =>
      a.orderDate < b.orderDate ? 1 : a.orderDate > b.orderDate ? -1 : b.id - a.id
    );

  // Scale factor applied ONLY to the print output (built inside
  // handlePrintReceipt) to shrink the fixed-width receipt card down to
  // the selected thermal paper's printable width. The on-screen form,
  // live preview, and review modal above always render at full size -
  // this scale never touches them.
  const { printableMM } = THERMAL_PAPER_SIZES[paperSize];
  const thermalPrintWidthPx = printableMM * PX_PER_MM;
  const thermalScale = thermalPrintWidthPx / RECEIPT_CARD_WIDTH;

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Receipts / Sales Orders</h2>

      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Fill in the receipt on the left - the card on the right always shows
        exactly what will be saved.
      </p>

      <Toolbar>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search customer, location, sales rep, or SKU…"
        />

        <ToolbarControls>
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>

      {/*
       * Everything below the toolbar zooms together.
       */}
      <div style={zoomStyle(zoom)}>
        {/*
         * Entry form + live preview.
         */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            flexWrap: "nowrap",
            gap: 28,
            overflow: "auto",
            padding: "0 4px 20px",
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{ marginTop: RECEIPT_COLUMN_TOP, flexShrink: 0 }}
          >
            <ReceiptPaper>
              <Divider />

              <FormRow label="Date">
                <DatePicker aria-label="Order date" style={receiptInputStyle} value={orderDate} onChange={setOrderDate} />
              </FormRow>

              <FormRow label="Customer">
                <input
                  className="ae-input"
                  style={receiptInputStyle}
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="Name"
                />
              </FormRow>

              <FormRow label="Location">
                <input
                  className="ae-input"
                  style={receiptInputStyle}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Delivery address"
                />
              </FormRow>

              <FormRow label="Sales Rep">
                <input
                  className="ae-input"
                  style={receiptInputStyle}
                  value={salesRepName}
                  onChange={(e) => setSalesRepName(e.target.value)}
                  placeholder="Name"
                />
              </FormRow>

              <Divider />

              {items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <Select
                    value={item.productId}
                    onChange={(e) =>
                      updateItem(i, { productId: Number(e.target.value) })
                    }
                    style={{ flex: 1, minWidth: 0, fontSize: 11, padding: "4px 4px" }}
                  >
                    <option value={0}>Select SKU…</option>

                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.category} — {p.name}
                      </option>
                    ))}
                  </Select>

                  <input
                    type="number"
                    className="ae-input"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(i, { quantity: e.target.value })
                    }
                    style={{
                      width: 46,
                      flexShrink: 0,
                      fontSize: 11,
                      padding: "4px 4px",
                      textAlign: "right",
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => removeItemRow(i)}
                    disabled={items.length === 1}
                    aria-label="Remove item"
                    style={removeButtonStyle}
                  >
                    ×
                  </button>
                </div>
              ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addItemRow}
                style={{ width: "100%", marginBottom: 4 }}
              >
                + Add item
              </Button>

              <Divider dashed />

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  color: colors.subtleInk,
                  marginBottom: 10,
                }}
              >
                <input
                  type="checkbox"
                  checked={postToFulfillment}
                  onChange={(e) => setPostToFulfillment(e.target.checked)}
                />
                Post to Online Fulfillment (Out)
              </label>

              {error && (
                <p style={{ color: colors.danger, fontSize: 11, marginBottom: 8 }}>
                  {error}
                </p>
              )}

              <Button type="submit" disabled={submitting} style={{ width: "100%" }}>
                {submitting ? "Saving…" : "Save Receipt"}
              </Button>
            </ReceiptPaper>
          </form>

          <div style={{ marginTop: RECEIPT_COLUMN_TOP, flexShrink: 0 }}>
            <ReceiptCard receipt={previewReceipt} isPreview />
          </div>
        </div>

        {/*
         * Recent receipts.
         */}
        <div style={{ marginTop: 4 }}>
          <h3 style={{ margin: "0 0 12px" }}>Recent Receipts</h3>

          {!receipts ? (
            <p>Loading…</p>
          ) : visibleReceipts?.length === 0 ? (
            <p style={{ color: colors.subtleInk }}>
              {receipts.length === 0
                ? "No receipts logged yet."
                : "No receipts match your search."}
            </p>
          ) : (
            <div
              className="table-scroll"
              style={{
                maxHeight: RECEIPT_LIST_MAX_HEIGHT,
                overflow: "auto",
                border: `1px solid ${colors.border}`,
                borderRadius: 0,
              }}
            >
              <table className="ae-table ae-table--left" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Location</th>
                    <th>Sales Rep</th>
                    <th style={{ textAlign: "right" }}>Items</th>
                    <th style={{ textAlign: "right" }}>Total Qty</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleReceipts?.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedReceipt(r)}
                      style={{ cursor: "pointer" }}
                      title="Click to preview and print"
                    >
                      <td>#{String(r.id).padStart(6, "0")}</td>
                      <td>{formatDateDisplay(r.orderDate.slice(0, 10))}</td>
                      <td>{r.customer || "—"}</td>
                      <td>{r.location || "—"}</td>
                      <td>{r.salesRepName || "—"}</td>
                      <td style={{ textAlign: "right", color: "var(--ae-num-text)" }}>{r.items.length}</td>
                      <td style={{ textAlign: "right", color: "var(--ae-num-text)" }}>
                        {r.items.reduce((sum, it) => sum + Number(it.quantity), 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/*
       * ========================================================
       * RECEIPT PREVIEW / PRINT MODAL
       * ========================================================
       */}
      {selectedReceipt && (
        <Modal
          title={`Receipt #${String(selectedReceipt.id).padStart(6, "0")}`}
          onClose={() => setSelectedReceipt(null)}
          width={RECEIPT_CARD_WIDTH + 96}
        >
          {/*
           * Shown at full/normal size, same as the entry form and live
           * preview - this is for the encoder to review comfortably.
           * Shrinking to actual thermal-paper size only happens in the
           * isolated print document built by handlePrintReceipt below,
           * so it never affects what's shown on screen here.
           */}
          <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
            <ReceiptCard receipt={selectedReceipt} />
          </div>

          {/*
           * These controls are hidden when printing.
           */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 8,
              marginTop: 16,
            }}
            className="no-print"
          >
            <Select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as ThermalPaperSize)}
              style={{ fontSize: 11, padding: "4px 6px", marginRight: "auto" }}
              aria-label="Thermal paper size"
            >
              {Object.entries(THERMAL_PAPER_SIZES).map(([key, size]) => (
                <option key={key} value={key}>
                  {size.label}
                </option>
              ))}
            </Select>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedReceipt(null)}
            >
              Close
            </Button>

            <Button
              type="button"
              size="sm"
                 onClick={() => selectedReceipt && generateReceiptPdf(selectedReceipt, paperSize)}
              title="Print or save as PDF"
            >
              <PrinterIcon /> PDF
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/*
 * Receipt form row.
 */
function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        marginBottom: 5,
      }}
    >
      <span style={{ color: colors.subtleInk, flexShrink: 0 }}>{label}</span>
      <div style={{ maxWidth: 320, flex: 1 }}>{children}</div>
    </div>
  );
}

/*
 * Receipt input styling.
 */
const receiptInputStyle: CSSProperties = {
  width: "100%",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 13,
  textAlign: "right",
  padding: "4px 6px",
};

/*
 * Remove-item button styling.
 */
const removeButtonStyle: CSSProperties = {
  width: 20,
  height: 20,
  flexShrink: 0,
  border: `1px solid ${colors.goldDark}`,
  borderRadius: 4,
  background: "transparent",
  color: colors.danger,
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};