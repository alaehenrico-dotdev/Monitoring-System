import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createReceipt, listReceipts } from "../api/receipts";
import { listProducts } from "../api/products";
import type { Product, Receipt } from "../types";
import { colors } from "../theme";
import { Divider, ReceiptCard, ReceiptPaper, RECEIPT_CARD_WIDTH } from "../components/ReceiptCard";
import { Button, Select } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { PrinterIcon } from "../components/icons";

// Standard 80mm thermal POS roll: ~72mm is actually printable once the
// roll's own unprintable side margins are accounted for. In CSS pixels
// (96px/in ÷ 25.4mm/in) that's ~272px - what the receipt paper should
// physically measure once printed, no matter how large it's been made to
// look on screen for readability while filling it in.
const THERMAL_PRINT_WIDTH_PX = 272;

// Shared by both the on-screen "saved receipt" modal preview and the print
// path - how much to shrink the (deliberately oversized, easy-to-fill-in)
// RECEIPT_CARD_WIDTH paper down to true 80mm-roll proportions. Kept as one
// constant, derived from RECEIPT_CARD_WIDTH, so both places stay in sync if
// either width constant ever changes.
const RECEIPT_THERMAL_SCALE = THERMAL_PRINT_WIDTH_PX / RECEIPT_CARD_WIDTH;

// CSS px are defined as 1/96 inch regardless of screen DPI, so this is a
// fixed conversion (not a measurement) - used to turn the receipt paper's
// on-screen pixel height into the mm figure @page needs.
const PX_PER_MM = 96 / 25.4;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Small top nudge only, now that the receipt paper's own (larger) header
// carries most of the visual weight that used to be reserved as blank
// margin above the card - the card grows upward into that space instead
// of leaving it empty.
const RECEIPT_COLUMN_TOP = 8;

// "Recent Receipts" is capped to roughly this many rows tall before it
// scrolls internally, rather than growing the page indefinitely as more
// receipts pile up - a sticky header plus twenty ~23px data rows.
const RECEIPT_LIST_VISIBLE_ROWS = 20;
const RECEIPT_LIST_MAX_HEIGHT = 29 + RECEIPT_LIST_VISIBLE_ROWS * 23;

interface LineItem {
  productId: number;
  quantity: string;
}

/**
 * Section 4.7 - Receipt / Sales Order Entry. Previously a toggled "+ New
 * Receipt" form above a plain list; now the entry form itself is built as
 * an editable receipt (same paper/logo/divider chrome as the read-only
 * card, via the shared ReceiptPaper shell), sitting beside a live preview
 * that shows exactly what will be saved - so there's nothing to toggle,
 * the form is just always there.
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

  const [orderDate, setOrderDate] = useState(today());
  const [customer, setCustomer] = useState("");
  const [location, setLocation] = useState("");
  const [salesRepName, setSalesRepName] = useState("");
  const [postToFulfillment, setPostToFulfillment] = useState(true);
  const [items, setItems] = useState<LineItem[]>([{ productId: 0, quantity: "" }]);

  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load receipts");
        setReceipts([]);
      });
    listProducts()
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load SKUs"));
  }, []);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItemRow() {
    setItems((prev) => [...prev, { productId: 0, quantity: "" }]);
  }

  function removeItemRow(index: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (!customer || !location || !validItems.length) {
      setError("Customer, location, and at least one order item are required.");
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
        items: validItems.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
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

  function handlePrintReceipt() {
    // The `receipt` named page (index.css) can only give the roll a fixed
    // *width* - its height has to match this particular receipt's actual
    // content (more line items = a taller strip), which isn't knowable until
    // it's rendered. `size: <width> auto` looks like the answer but isn't:
    // the CSS `size` property's grammar doesn't accept `auto` paired with a
    // length, so browsers silently drop the whole declaration and fall back
    // to a default Letter/A4 page - which is exactly the oversized preview
    // this is fixing. Measuring the on-screen receipt (already rendered at
    // true thermal size below, via the same `paperStyle` zoom) and injecting
    // an explicit height in mm is the only way to get a real fixed page size
    // out of it. Scoped to `.ae-modal-panel` specifically, not just
    // `.ae-receipt-paper` - the entry form and its live preview above render
    // that same class at full (unscaled) size, and being earlier in the DOM
    // than this portaled dialog, a bare query would match one of those
    // instead of the receipt actually being printed.
    const paperEl = document.querySelector<HTMLElement>(".ae-modal-panel .ae-receipt-paper");
    const heightMM = paperEl ? paperEl.getBoundingClientRect().height / PX_PER_MM : 200;

    // Deliberately not wrapped in `@media print` - see the comment on the
    // static `@page receipt` fallback in index.css for why.
    const printStyle = document.createElement("style");
    printStyle.textContent = `@page receipt { size: 80mm ${heightMM.toFixed(2)}mm; margin: 0; }`;
    document.head.appendChild(printStyle);

    document.body.classList.add("ae-printing-receipt");
    window.print();
    document.body.classList.remove("ae-printing-receipt");

    document.head.removeChild(printStyle);
  }

  const previewReceipt: Receipt = useMemo(() => {
    const previewItems = items
      .map((it, idx) => {
        const product = products.find((p) => p.id === it.productId);
        if (!product || !(Number(it.quantity) > 0)) return null;
        return { id: idx, productId: it.productId, product, quantity: Number(it.quantity) };
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
      createdBy: user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null,
      createdAt: new Date().toISOString(),
      items: previewItems,
    };
  }, [orderDate, customer, location, items, products, user, salesRepName]);

  const visibleReceipts = receipts
    ?.filter((r) => matchesSearch([r.customer, r.location, r.salesRepName, ...r.items.map((it) => it.product.name)], query))
    .sort((a, b) => (a.orderDate < b.orderDate ? 1 : a.orderDate > b.orderDate ? -1 : b.id - a.id));

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Receipts / Sales Orders</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Fill in the receipt on the left - the card on the right always shows exactly what will be saved.
      </p>

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search customer, location, sales rep, or SKU…" />
        <ToolbarControls>
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>

      {/* Everything below the toolbar zooms together as one unit - keeping
          a single source of truth here (rather than also re-applying
          zoomStyle down on the recent-receipts table) avoids compounding
          the scale twice on that table. */}
      <div style={zoomStyle(zoom)}>
        {/* Entry form + live preview - always side by side and centered as
            a pair, never wrapped or squeezed narrower than their fixed
            paper width. This row is what scrolls (in either direction)
            once zooming in - or a narrow viewport - makes the pair wider
            or taller than the space available. */}
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
        <form onSubmit={handleSubmit} style={{ marginTop: RECEIPT_COLUMN_TOP, flexShrink: 0 }}>
          <ReceiptPaper>
            <Divider />
            <FormRow label="Date">
              <input
                type="date"
                className="ae-input"
                style={receiptInputStyle}
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
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
              <div key={i} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
                <Select
                  value={item.productId}
                  onChange={(e) => updateItem(i, { productId: Number(e.target.value) })}
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
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                  style={{ width: 46, flexShrink: 0, fontSize: 11, padding: "4px 4px", textAlign: "right" }}
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
            <Button type="button" variant="ghost" size="sm" onClick={addItemRow} style={{ width: "100%", marginBottom: 4 }}>
              + Add item
            </Button>

            <Divider dashed />

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: colors.subtleInk, marginBottom: 10 }}>
              <input type="checkbox" checked={postToFulfillment} onChange={(e) => setPostToFulfillment(e.target.checked)} />
              Post to Online Fulfillment (Out)
            </label>

            {error && <p style={{ color: colors.danger, fontSize: 11, marginBottom: 8 }}>{error}</p>}
            <Button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Saving…" : "Save Receipt"}
            </Button>
          </ReceiptPaper>
        </form>

          <div style={{ marginTop: RECEIPT_COLUMN_TOP, flexShrink: 0 }}>
            <ReceiptCard receipt={previewReceipt} isPreview />
          </div>
        </div>

        {/* Recent receipts - full page width below the form/preview pair,
            tall enough to read ~20 rows at a glance; anything beyond that
            scrolls internally instead of growing the page indefinitely. */}
        <div style={{ marginTop: 4 }}>
          <h3 style={{ margin: "0 0 12px" }}>Recent Receipts</h3>
          {!receipts ? (
            <p>Loading…</p>
          ) : visibleReceipts?.length === 0 ? (
            <p style={{ color: colors.subtleInk }}>{receipts.length === 0 ? "No receipts logged yet." : "No receipts match your search."}</p>
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
                    <tr key={r.id} onClick={() => setSelectedReceipt(r)} style={{ cursor: "pointer" }} title="Click to preview and print">
                      <td>#{String(r.id).padStart(6, "0")}</td>
                      <td>{formatDateDisplay(r.orderDate.slice(0, 10))}</td>
                      <td>{r.customer || "—"}</td>
                      <td>{r.location || "—"}</td>
                      <td>{r.salesRepName || "—"}</td>
                      <td style={{ textAlign: "right" }}>{r.items.length}</td>
                      <td style={{ textAlign: "right" }}>{r.items.reduce((sum, it) => sum + Number(it.quantity), 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selectedReceipt && (
        <Modal
          title={`Receipt #${String(selectedReceipt.id).padStart(6, "0")}`}
          onClose={() => setSelectedReceipt(null)}
          width={THERMAL_PRINT_WIDTH_PX + 96}
        >
          {/* Rendered at true 80mm-roll size (via zoom, same mechanism as
              the print path) rather than the large RECEIPT_CARD_WIDTH used
              by the entry form / live preview pair above - this modal is
              showing what was actually printed, so it should look like it. */}
          <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
            <ReceiptCard receipt={selectedReceipt} paperStyle={{ zoom: RECEIPT_THERMAL_SCALE }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }} className="no-print">
            <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedReceipt(null)}>
              Close
            </Button>
            <Button type="button" size="sm" onClick={handlePrintReceipt} title="Print or save as PDF">
              <PrinterIcon /> PDF
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 5 }}>
      <span style={{ color: colors.subtleInk, flexShrink: 0 }}>{label}</span>
      <div style={{ maxWidth: 320, flex: 1 }}>{children}</div>
    </div>
  );
}

const receiptInputStyle: CSSProperties = {
  width: "100%",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 13,
  textAlign: "right",
  padding: "4px 6px",
};

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