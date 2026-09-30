import { useEffect, useState, type FormEvent } from "react";
import { createProduct, deactivateProduct, listProducts, updateProduct } from "../api/products";
import type { Product } from "../types";
import { Button, Field, TextInput } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";

/// Section 4.1 - Admins can add, rename, deactivate, or re-categorize
/// products without a developer; new SKUs appear in every grid automatically.
export function ProductsAdminPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which row's Low Stock Alert cell is mid-edit (its draft text) - saved on
  // blur/Enter, same "click cell, type, commit" pattern as the stock grids.
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<number, string>>({});
  const [thresholdBusyId, setThresholdBusyId] = useState<number | null>(null);
  // The SKU the confirm dialog is currently asking about, and which row (if
  // any) has a request in flight.
  const [pendingDeactivate, setPendingDeactivate] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function reload() {
    // includeInactive: deactivated SKUs stay in this list (dimmed) so they can be reactivated.
    listProducts({ includeInactive: true })
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load SKUs"));
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !category || !unit) {
      setError("Name, category, and unit are required.");
      return;
    }
    try {
      const created = await createProduct({
        sku: sku || undefined,
        name,
        category,
        unit,
        lowStockThreshold: lowStockThreshold.trim() === "" ? undefined : Number(lowStockThreshold),
      });
      setSku("");
      setName("");
      setCategory("");
      setUnit("");
      setLowStockThreshold("");
      // Append locally instead of re-fetching the whole (60+ product) list.
      setProducts((prev) => (prev ? [...prev, created] : [created]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add SKU");
    }
  }

  // Low Stock Alert - saved on blur, same as any other admin edit here.
  // Blank clears the threshold (null = no alert configured), otherwise the
  // typed number is sent as-is; a non-numeric or negative draft is dropped
  // without a request rather than sent to the server to reject.
  async function commitThreshold(p: Product) {
    const draft = thresholdDrafts[p.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setThresholdDrafts((d) => {
        const { [p.id]: _drop, ...rest } = d;
        return rest;
      });
      return;
    }
    if (next === (p.lowStockThreshold ?? null)) {
      setThresholdDrafts((d) => {
        const { [p.id]: _drop, ...rest } = d;
        return rest;
      });
      return;
    }
    setThresholdBusyId(p.id);
    setError(null);
    try {
      const updated = await updateProduct(p.id, { lowStockThreshold: next });
      setProducts((prev) => prev?.map((row) => (row.id === p.id ? updated : row)) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update low stock alert");
    } finally {
      setThresholdBusyId(null);
      setThresholdDrafts((d) => {
        const { [p.id]: _drop, ...rest } = d;
        return rest;
      });
    }
  }

  // Both actions update the row in place (flip isActive) rather than
  // reloading the list or removing the row.
  function setActiveLocally(id: number, isActive: boolean) {
    setProducts((prev) => prev?.map((p) => (p.id === id ? { ...p, isActive } : p)) ?? prev);
  }

  async function confirmDeactivate() {
    if (!pendingDeactivate) return;
    const target = pendingDeactivate;
    setError(null);
    setBusyId(target.id);
    try {
      await deactivateProduct(target.id);
      setActiveLocally(target.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate SKU");
    } finally {
      setBusyId(null);
      setPendingDeactivate(null);
    }
  }

  async function handleReactivate(p: Product) {
    setError(null);
    setBusyId(p.id);
    try {
      await updateProduct(p.id, { isActive: true });
      setActiveLocally(p.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate SKU");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="SKU &amp; Category Master List"
        subtitle="Manage the SKUs and categories used throughout the system. Deactivated SKUs stay listed here (dimmed) so they can be reactivated."
      />

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
        <Field label="SKU code">
          <TextInput value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. AFP071" style={{ width: 100 }} />
        </Field>
        <Field label="Product name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Category">
          <TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. New Products" />
        </Field>
        <Field label="Unit">
          <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Gallon" />
        </Field>
        <Field label="Low stock alert">
          <TextInput
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            placeholder="Optional"
            inputMode="decimal"
            style={{ width: 90 }}
          />
        </Field>
        <Button type="submit" style={{ color: colors.yellow }}>Add SKU</Button>
      </form>
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />

      {!products ? (
        <TableSkeleton headers={["Category", "SKU", "Product", "Unit", "Low Stock Alert", ""]} minWidth={560} label="Loading SKUs…" />
      ) : (
        <RowGlowScroll>
          <table className="ae-table ae-table--left" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                {["Category", "SKU", "Product", "Unit", "Low Stock Alert", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={p.isActive ? undefined : { opacity: 0.55 }}>
                  <td style={{ whiteSpace: "nowrap" }}>{p.category}</td>
                  <td style={{ whiteSpace: "nowrap", color: p.sku ? colors.yellow : colors.subtleInk }}>{p.sku ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.name}
                    {!p.isActive && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 7px",
                          border: `1px solid ${colors.subtleInk}`,
                          borderRadius: 999,
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: colors.subtleInk,
                        }}
                      >
                        Inactive
                      </span>
                    )}
                  </td>
                  <td>{p.unit}</td>
                  <td>
                    <TextInput
                      value={thresholdDrafts[p.id] ?? (p.lowStockThreshold === null ? "" : String(p.lowStockThreshold))}
                      onChange={(e) => setThresholdDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onBlur={() => commitThreshold(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      disabled={thresholdBusyId === p.id}
                      placeholder="None"
                      inputMode="decimal"
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    {p.isActive ? (
                      <Button variant="danger" size="sm" disabled={busyId === p.id} onClick={() => setPendingDeactivate(p)} style={{ color: colors.yellow }}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={busyId === p.id} onClick={() => handleReactivate(p)}>
                        {busyId === p.id ? "Reactivating…" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </RowGlowScroll>
      )}

      {pendingDeactivate && (
        <ConfirmDialog
          title="Deactivate SKU?"
          confirmLabel="Deactivate"
          busy={busyId === pendingDeactivate.id}
          onConfirm={confirmDeactivate}
          onCancel={() => setPendingDeactivate(null)}
        >
          <p style={{ margin: "0 0 10px" }}>
            <strong>{pendingDeactivate.name}</strong>
            {pendingDeactivate.sku ? ` (${pendingDeactivate.sku})` : ""} will be hidden from the stock grids and receipt item lists.
          </p>
          <p style={{ margin: 0, color: colors.subtleInk }}>Past entries are not deleted, and you can reactivate it from this list at any time.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}