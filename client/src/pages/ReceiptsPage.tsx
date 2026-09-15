import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createReceipt, listReceipts } from "../api/receipts";
import { listProducts } from "../api/products";
import type { Product, Receipt } from "../types";
import { colors } from "../theme";
import { Divider, ReceiptCard, ReceiptPaper } from "../components/ReceiptCard";
import { Button, Select } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { PrinterIcon } from "../components/icons";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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
    // Every fetch here needs its own .catch - without one, a failed request
    // (an expired session, a network blip) left `receipts` stuck at `null`
    // forever with nothing telling the user why: the "Recent Receipts"
    // table below just silently stays on "Loading…" instead of showing an
    // error or falling back to an empty list.
    listReceipts()
      .then(setReceipts)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load receipts");
        setReceipts([]);
      });
    listProducts()
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load products"));
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
      // The create endpoint already returns the full receipt (with items and
      // product names populated) - prepend it locally instead of re-fetching
      // the whole list.
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

  // Prints just the receipt preview dialog, not the page it was opened from
  // - see the `body.ae-printing-receipt` rules in index.css and Modal's own
  // doc comment for how the dialog stays on the page while everything else
  // is hidden. `window.print()` blocks until the print dialog is dismissed
  // in every browser this app targets, so it's safe to remove the class
  // immediately after rather than needing an `afterprint` listener.
  function handlePrintReceipt() {
    document.body.classList.add("ae-printing-receipt");
    window.print();
    document.body.classList.remove("ae-printing-receipt");
  }

  // Mirrors the draft form state into the exact shape ReceiptCard expects,
  // so the right-hand preview is always exactly what Save would produce.
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

  // Newest first - matches the order the create endpoint's response gets
  // prepended in, so a freshly-saved receipt appears at the top without a
  // re-sort.
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
        <SearchInput value={query} onChange={setQuery} placeholder="Search customer, location, sales rep, or product…" />
        <ToolbarControls>
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>

      <div style={{ ...zoomStyle(zoom), display: "flex", gap: 28, flex: 1, minHeight: 0, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 0 }}>
        <form onSubmit={handleSubmit} style={{ marginTop: 34 }}>
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
                  <option value={0}>Select product…</option>
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

        <div style={{ marginTop: 34 }}>
          <ReceiptCard receipt={previewReceipt} isPreview />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: "1 1 420px", minWidth: 320, minHeight: 0 }}>
          <h3 style={{ margin: "0 0 12px" }}>Recent Receipts</h3>
          {!receipts ? (
            <p>Loading…</p>
          ) : visibleReceipts?.length === 0 ? (
            <p style={{ color: colors.subtleInk }}>{receipts.length === 0 ? "No receipts logged yet." : "No receipts match your search."}</p>
          ) : (
            <div className="table-scroll" style={{ ...zoomStyle(zoom), flex: 1, minHeight: 0, overflow: "auto", border: "1px solid #e7dfc9", borderRadius: 10 }}>
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
        <Modal title={`Receipt #${String(selectedReceipt.id).padStart(6, "0")}`} onClose={() => setSelectedReceipt(null)} width={340}>
          <ReceiptCard receipt={selectedReceipt} />
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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: colors.subtleInk, flexShrink: 0 }}>{label}</span>
      <div style={{ maxWidth: 190, flex: 1 }}>{children}</div>
    </div>
  );
}

const receiptInputStyle: CSSProperties = {
  width: "100%",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 12,
  textAlign: "right",
  padding: "3px 6px",
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
