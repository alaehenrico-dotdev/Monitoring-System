import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { matchesSearch } from "../utils/search";
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
  const [printTarget, setPrintTarget] = useState<Receipt | null>(null);

  const [orderDate, setOrderDate] = useState(today());
  const [customer, setCustomer] = useState("");
  const [location, setLocation] = useState("");
  const [postToFulfillment, setPostToFulfillment] = useState(true);
  const [items, setItems] = useState<LineItem[]>([{ productId: 0, quantity: "" }]);

  useEffect(() => {
    listReceipts().then(setReceipts);
    listProducts().then(setProducts);
  }, []);

  // Print/Save as PDF for exactly one receipt: render it into #print-portal
  // (see index.html), flip a body class that the print CSS uses to hide
  // everything else, then invoke the browser's print dialog - "Save as PDF"
  // there produces a real PDF of just that receipt. `afterprint` fires
  // whether the user actually printed or cancelled, so cleanup runs either
  // way.
  useEffect(() => {
    if (!printTarget) return;
    document.body.classList.add("printing-single-receipt");
    const timer = setTimeout(() => window.print(), 50);
    function cleanup() {
      document.body.classList.remove("printing-single-receipt");
      setPrintTarget(null);
    }
    window.addEventListener("afterprint", cleanup, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", cleanup);
    };
  }, [printTarget]);

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
        postToFulfillment,
        items: validItems.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
      });
      // The create endpoint already returns the full receipt (with items and
      // product names populated) - prepend it locally instead of re-fetching
      // the whole list.
      setReceipts((prev) => [saved, ...(prev ?? [])]);
      setCustomer("");
      setLocation("");
      setItems([{ productId: 0, quantity: "" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save receipt");
    } finally {
      setSubmitting(false);
    }
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
      salesRepId: null,
      salesRep: null,
      createdBy: user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null,
      createdAt: new Date().toISOString(),
      items: previewItems,
    };
  }, [orderDate, customer, location, items, products, user]);

  const visibleReceipts = receipts?.filter((r) =>
    matchesSearch([r.customer, r.location, ...r.items.map((it) => it.product.name)], query)
  );

  return (
    <div>
      <h2 style={{ margin: "0 0 6px" }}>Receipts / Sales Orders</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, marginBottom: 16 }}>
        Fill in the receipt on the left - the card on the right always shows exactly what will be saved.
      </p>

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search customer, location, or product…" />
        <ToolbarControls>
          <ZoomControl zoom={zoom} onChange={setZoom} />
        </ToolbarControls>
      </Toolbar>

      <div style={{ ...zoomStyle(zoom), display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 36 }}>
        <form onSubmit={handleSubmit}>
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
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
              <span style={{ color: colors.subtleInk }}>Sales Rep</span>
              <span style={{ color: colors.subtleInk }}>—</span>
            </div>
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

        <PrintableReceipt receipt={previewReceipt} isPreview onPrint={() => setPrintTarget(previewReceipt)} />
      </div>

      <h3 style={{ marginBottom: 12 }}>Recent Receipts</h3>
      {!receipts ? (
        <p>Loading…</p>
      ) : visibleReceipts?.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>{receipts.length === 0 ? "No receipts logged yet." : "No receipts match your search."}</p>
      ) : (
        <div style={{ ...zoomStyle(zoom), display: "flex", flexWrap: "wrap", gap: 28 }}>
          {visibleReceipts?.map((r) => (
            <PrintableReceipt key={r.id} receipt={r} onPrint={() => setPrintTarget(r)} />
          ))}
        </div>
      )}

      {printTarget &&
        createPortal(<ReceiptCard receipt={printTarget} isPreview={printTarget.id === 0} />, document.getElementById("print-portal")!)}
    </div>
  );
}

/// A ReceiptCard with a small "Print / Save as PDF" button overlaid in the
/// corner - kept outside ReceiptCard itself so the plain card rendered into
/// the print portal never includes page-level button chrome.
function PrintableReceipt({ receipt, isPreview, onPrint }: { receipt: Receipt; isPreview?: boolean; onPrint: () => void }) {
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={onPrint} title="Print / Save as PDF" aria-label="Print receipt" style={printButtonStyle}>
        <PrinterIcon />
      </button>
      <ReceiptCard receipt={receipt} isPreview={isPreview} />
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

const printButtonStyle: CSSProperties = {
  position: "absolute",
  top: -10,
  right: -10,
  width: 30,
  height: 30,
  borderRadius: "50%",
  border: `1px solid ${colors.goldDark}`,
  background: colors.paper,
  color: colors.ink,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 2px 6px rgba(20,17,13,0.18)",
  zIndex: 1,
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
