import { useEffect, useState, type FormEvent } from "react";
import { createReceipt, listReceipts } from "../api/receipts";
import { listProducts } from "../api/products";
import type { Product, Receipt } from "../types";
import { colors } from "../theme";
import { ReceiptCard } from "../components/ReceiptCard";
import { Button, Field, Select, TextInput } from "../components/ui";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LineItem {
  productId: number;
  quantity: string;
}

/// Section 4.7 - Receipt / Sales Order Entry: order date, customer, location,
/// sales rep, and one line per SKU. Saving can post straight into that date's
/// Online Fulfillment (Out) column.
export function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orderDate, setOrderDate] = useState(today());
  const [customer, setCustomer] = useState("");
  const [location, setLocation] = useState("");
  const [postToFulfillment, setPostToFulfillment] = useState(true);
  const [items, setItems] = useState<LineItem[]>([{ productId: 0, quantity: "" }]);

  function reload() {
    listReceipts().then(setReceipts);
  }

  useEffect(() => {
    reload();
    listProducts().then(setProducts);
  }, []);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItemRow() {
    setItems((prev) => [...prev, { productId: 0, quantity: "" }]);
  }

  function removeItemRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (!customer || !location || !validItems.length) {
      setError("Customer, location, and at least one order item are required.");
      return;
    }
    try {
      const saved = await createReceipt({
        orderDate,
        customer,
        location,
        postToFulfillment,
        items: validItems.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
      });
      setCustomer("");
      setLocation("");
      setItems([{ productId: 0, quantity: "" }]);
      setShowForm(false);
      // The create endpoint already returns the full receipt (with items and
      // product names populated) - prepend it locally instead of re-fetching
      // the whole list.
      setReceipts((prev) => [saved, ...(prev ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save receipt");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ marginTop: 0 }}>Receipts / Sales Orders</h2>
        <Button variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ New Receipt"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <Field label="Order date">
              <TextInput type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </Field>
            <Field label="Customer">
              <TextInput value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </Field>
            <Field label="Location">
              <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </div>

          <h4 style={{ marginBottom: 8 }}>Order items</h4>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <Select value={item.productId} onChange={(e) => updateItem(i, { productId: Number(e.target.value) })} style={{ minWidth: 220 }}>
                <option value={0}>Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.category} — {p.name}
                  </option>
                ))}
              </Select>
              <TextInput
                type="number"
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updateItem(i, { quantity: e.target.value })}
                style={{ width: 90 }}
              />
              <Button type="button" variant="danger" size="sm" onClick={() => removeItemRow(i)} disabled={items.length === 1}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addItemRow} style={{ marginBottom: 16 }}>
            + Add item
          </Button>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={postToFulfillment} onChange={(e) => setPostToFulfillment(e.target.checked)} /> Post
              quantities into that date's Online Fulfillment (Out)
            </label>
          </div>

          {error && <p style={{ color: colors.danger }}>{error}</p>}
          <Button type="submit">Save receipt</Button>
        </form>
      )}

      {!receipts ? (
        <p>Loading…</p>
      ) : receipts.length === 0 ? (
        <p style={{ color: colors.subtleInk }}>No receipts logged yet.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28, paddingTop: 4 }}>
          {receipts.map((r) => (
            <ReceiptCard key={r.id} receipt={r} />
          ))}
        </div>
      )}
    </div>
  );
}
