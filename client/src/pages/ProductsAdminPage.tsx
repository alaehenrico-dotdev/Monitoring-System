import { Spinner } from "../components/Spinner";
import { useBusyAction } from "../hooks/useBusyAction";
import { useEffect, useState, type FormEvent } from "react";
import { useRealtimeVersion } from "../context/RealtimeContext";
import {
  createProduct,
  deactivateProduct,
  deleteProductPermanently,
  listProducts,
  updateProduct,
} from "../api/products";
import type { Product } from "../types";
import { Button, Field, TextInput } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { EllipsisIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { colors } from "../theme";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import { CategoryField } from "../components/CategoryField";
import { categoriesOf, unitForCategory } from "../utils/productPlacement";

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
  const [thresholdDrafts, setThresholdDrafts] = useState<
    Record<number, string>
  >({});
  const [thresholdBusyId, setThresholdBusyId] = useState<number | null>(null);
  // The row's "..." menu (anchored under its button), the product being edited in
  // the Edit dialog, and the one waiting for a delete confirmation.
  const [rowMenu, setRowMenu] = useState<{ product: Product; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  // SKU codes being edited in their cells, and the row currently saving one.
  const [skuDrafts, setSkuDrafts] = useState<Record<number, string>>({});
  const [skuBusyId, setSkuBusyId] = useState<number | null>(null);
  // The SKU the confirm dialog is currently asking about, and which row (if
  // any) has a request in flight.
  const [pendingDeactivate, setPendingDeactivate] = useState<Product | null>(
    null,
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  // One create at a time: a double-click must not make a duplicate SKU.
  const addSku = useBusyAction();

  function reload() {
    // includeInactive: deactivated SKUs stay in this list (dimmed) so they can be reactivated.
    listProducts({ includeInactive: true })
      .then(setProducts)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load SKUs"),
      );
  }

  // Also refetched when anyone changes the product list (e.g. an import that
  // adds products), so this list never shows a stale one.
  const realtimeVersion = useRealtimeVersion();
  useEffect(reload, [realtimeVersion]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !category || !unit) {
      setError("Name, category, and unit are required.");
      return;
    }
    await addSku.run(async () => {
    try {
      await createProduct({
        sku: sku || undefined,
        name,
        category,
        unit,
        lowStockThreshold:
          lowStockThreshold.trim() === ""
            ? undefined
            : Number(lowStockThreshold),
      });
      setSku("");
      setName("");
      setCategory("");
      setUnit("");
      setLowStockThreshold("");
      // The server places a new product right after the last one of its category
      // (and moves what follows), so the list is read again rather than appended to.
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add SKU");
    }
    });
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
      setProducts(
        (prev) => prev?.map((row) => (row.id === p.id ? updated : row)) ?? prev,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update low stock alert",
      );
    } finally {
      setThresholdBusyId(null);
      setThresholdDrafts((d) => {
        const { [p.id]: _drop, ...rest } = d;
        return rest;
      });
    }
  }

  // The SKU code is edited in its cell: typed freely (hyphens, a new numbering...),
  // saved on Enter or when the cell loses focus, Escape puts the old one back. A code
  // another product already has is refused by the server, with that product's name.
  async function commitSku(p: Product) {
    const draft = skuDrafts[p.id];
    const clear = () =>
      setSkuDrafts((d) => {
        const { [p.id]: _drop, ...rest } = d;
        return rest;
      });
    if (draft === undefined) return;
    const next = draft.trim();
    if (next === (p.sku ?? "")) return clear();
    setSkuBusyId(p.id);
    setError(null);
    try {
      const updated = await updateProduct(p.id, { sku: next === "" ? null : next });
      setProducts((prev) => prev?.map((row) => (row.id === p.id ? updated : row)) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update the SKU code");
    } finally {
      setSkuBusyId(null);
      clear();
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setError(null);
    setBusyId(target.id);
    try {
      await deleteProductPermanently(target.id);
      setProducts((prev) => prev?.filter((p) => p.id !== target.id) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the product");
    } finally {
      setBusyId(null);
      setPendingDelete(null);
    }
  }

  function rowMenuItems(p: Product): ContextMenuItem[] {
    return [
      { id: "edit", label: "Edit…", title: "Change the name, SKU code, category or unit", run: () => setEditing(p) },
      {
        id: "update-sku",
        label: "Update SKU code",
        title: "Jump to this row's SKU cell",
        run: () => {
          const el = document.getElementById(`sku-${p.id}`) as HTMLInputElement | null;
          el?.focus();
          el?.select();
        },
      },
      p.isActive
        ? { id: "deactivate", label: "Deactivate…", title: "Hide it from the grids; history stays", run: () => setPendingDeactivate(p) }
        : { id: "reactivate", label: "Reactivate", run: () => void handleReactivate(p) },
      { id: "delete", label: "Delete…", danger: true, title: "Only for a product that was never used", run: () => setPendingDelete(p) },
    ];
  }

  // Both actions update the row in place (flip isActive) rather than
  // reloading the list or removing the row.
  function setActiveLocally(id: number, isActive: boolean) {
    setProducts(
      (prev) =>
        prev?.map((p) => (p.id === id ? { ...p, isActive } : p)) ?? prev,
    );
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
        subtitle="Manage SKUs and categories. Deactivated SKUs appear dimmed."
      />

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <Field label="SKU code">
          <TextInput
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. AFP071"
            style={{ width: 100 }}
          />
        </Field>
        <Field label="Product name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} style={{ textTransform: "uppercase" }} />
        </Field>
        <Field label="Category">
          <CategoryField
            categories={categoriesOf(products ?? [])}
            value={category}
            onChange={(c) => {
              setCategory(c);
              // The unit the category already uses, unless one was typed.
              if (unit === "") setUnit(unitForCategory(products ?? [], c));
            }}
          />
        </Field>
        <Field label="Unit">
          <TextInput
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. Gallon"
          />
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
        <Button
          type="submit"
          style={{ color: colors.yellow }}
          loading={addSku.busy}
          loadingLabel="Adding…"
        >
          Add SKU
        </Button>
      </form>
      <Toast
        message={error}
        onDismiss={() => setError(null)}
        variant="error"
        duration={null}
      />

      {!products ? (
        <TableSkeleton
          headers={[
            "Category",
            "SKU",
            "Product",
            "Unit",
            "Low Stock Alert",
            "",
          ]}
          minWidth={560}
          label="Loading SKUs…"
        />
      ) : (
        <RowGlowScroll>
          <table className="ae-table ae-table--left" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                {[
                  "Category",
                  "SKU",
                  "Product",
                  "Unit",
                  "Low Stock Alert",
                  "",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr
                  key={p.id}
                  style={p.isActive ? undefined : { opacity: 0.55 }}
                >
                  <td style={{ whiteSpace: "nowrap" }}>{p.category}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <TextInput
                      id={`sku-${p.id}`}
                      aria-label={`SKU code of ${p.name}`}
                      value={skuDrafts[p.id] ?? p.sku ?? ""}
                      onChange={(e) => setSkuDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onBlur={() => void commitSku(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape")
                          setSkuDrafts((d) => {
                            const { [p.id]: _drop, ...rest } = d;
                            return rest;
                          });
                      }}
                      disabled={skuBusyId === p.id}
                      placeholder="No SKU"
                      maxLength={64}
                      style={{ width: 130, color: colors.yellow }}
                    />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.name}
                    {!p.isActive && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 7px",
                          border: `1px solid ${colors.subtleInk}`,
                          borderRadius: 6,
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
                      value={
                        thresholdDrafts[p.id] ??
                        (p.lowStockThreshold === null
                          ? ""
                          : String(p.lowStockThreshold))
                      }
                      onChange={(e) =>
                        setThresholdDrafts((d) => ({
                          ...d,
                          [p.id]: e.target.value,
                        }))
                      }
                      onBlur={() => commitThreshold(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.target as HTMLInputElement).blur();
                      }}
                      disabled={thresholdBusyId === p.id}
                      placeholder="None"
                      inputMode="decimal"
                      style={{ width: 80 }}
                    />
                    {thresholdBusyId === p.id && (
                      <span role="status" aria-label="Saving" style={{ marginLeft: 6, verticalAlign: "middle", display: "inline-flex" }}>
                        <Spinner size="sm" />
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", width: 44 }}>
                    <button
                      type="button"
                      className="ae-row-menu-btn"
                      aria-label={`Actions for ${p.name}`}
                      aria-haspopup="menu"
                      disabled={busyId === p.id}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setRowMenu({ product: p, x: r.right - 160, y: r.bottom + 4 });
                      }}
                    >
                      <EllipsisIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </RowGlowScroll>
      )}

      {rowMenu && (
        <ContextMenu
          anchor={{ x: rowMenu.x, y: rowMenu.y }}
          title={rowMenu.product.name}
          ariaLabel={`Actions for ${rowMenu.product.name}`}
          items={rowMenuItems(rowMenu.product)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {editing && (
        <EditProductDialog
          product={editing}
          categories={categoriesOf(products ?? [])}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setProducts((prev) => prev?.map((row) => (row.id === updated.id ? updated : row)) ?? prev);
            setEditing(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete product?"
          confirmLabel="Delete"
          busy={busyId === pendingDelete.id}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        >
          <p style={{ margin: "0 0 10px" }}>
            <strong>{pendingDelete.name}</strong>
            {pendingDelete.sku ? ` (${pendingDelete.sku})` : ""} will be removed from the list for good.
          </p>
          <p style={{ margin: 0, color: colors.subtleInk }}>
            This only works for a product that was never used. One with stock history can't be deleted - deactivate it instead.
          </p>
        </ConfirmDialog>
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
            {pendingDeactivate.sku ? ` (${pendingDeactivate.sku})` : ""} will be
            hidden from the stock grids and receipt item lists.
          </p>
          <p style={{ margin: 0, color: colors.subtleInk }}>
            Past entries are not deleted, and you can reactivate it from this
            list at any time.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/// The row menu's "Edit...": name, SKU code, category and unit in one place. Only
/// what changed is sent; the server refuses a SKU another product already has and
/// says which one.
function EditProductDialog({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product;
  categories: string[];
  onClose: () => void;
  onSaved: (updated: Product) => void;
}) {
  const [sku, setSku] = useState(product.sku ?? "");
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category);
  const [unit, setUnit] = useState(product.unit);
  const [error, setError] = useState<string | null>(null);
  const save = useBusyAction();

  const changes: Parameters<typeof updateProduct>[1] = {};
  if (sku.trim() !== (product.sku ?? "")) changes.sku = sku.trim() === "" ? null : sku.trim();
  if (name.trim() !== product.name) changes.name = name;
  if (category.trim() !== product.category) changes.category = category;
  if (unit.trim() !== product.unit) changes.unit = unit;
  const valid = name.trim() !== "" && category.trim() !== "" && unit.trim() !== "";

  return (
    <Modal title="Edit product" onClose={save.busy ? () => {} : onClose} width={460}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || Object.keys(changes).length === 0) return;
          void save.run(async () => {
            setError(null);
            try {
              onSaved(await updateProduct(product.id, changes));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to save the product");
            }
          });
        }}
        style={{ display: "grid", gap: 12 }}
      >
        <Field label="SKU code">
          <TextInput value={sku} onChange={(e) => setSku(e.target.value)} placeholder="No SKU" maxLength={64} autoFocus />
        </Field>
        <Field label="Product name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} style={{ textTransform: "uppercase" }} />
        </Field>
        <Field label="Category">
          <CategoryField categories={categories} value={category} onChange={setCategory} />
        </Field>
        <Field label="Unit">
          <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" style={{ margin: 0, color: colors.danger }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.busy}>
            Cancel
          </Button>
          <Button type="submit" loading={save.busy} loadingLabel="Saving…" disabled={!valid || Object.keys(changes).length === 0}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
