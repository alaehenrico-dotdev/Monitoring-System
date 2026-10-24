import { useState, type FormEvent } from "react";
import { createProduct } from "../api/products";
import type { Product } from "../types";
import { colors } from "../theme";
import { Button, Field, TextInput } from "./ui";
import { CategoryField } from "./CategoryField";
import { categoriesOf, unitForCategory } from "../utils/productPlacement";

/**
 * Adds one product to the master list - for something the Excel template does not
 * list. The server places it right after the last product of its category (or at
 * the end for a new category) and joins a typed category to an existing one, so
 * the form only has to collect the four fields. `products` is what is already
 * in the list: it supplies the categories to choose from and, once one is
 * picked, the unit that category already uses.
 */
export function AddProductForm({
  products,
  onAdded,
  onCancel,
}: {
  products: readonly Product[];
  onAdded: (created: Product) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  // Once the unit has been typed it is the person's, not something to overwrite
  // when the category changes.
  const [unitTouched, setUnitTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim() || !category.trim() || !unit.trim()) {
      setError("Name, category and unit are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onAdded(await createProduct({ sku: sku.trim() || undefined, name: name.trim(), category: category.trim(), unit: unit.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the product");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Add product"
      style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: 10, marginBottom: 12, background: colors.paperAlt }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <Field label="Product name" style={{ flex: "1 1 180px" }}>
          <TextInput aria-label="Product name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus disabled={saving} style={{ textTransform: "uppercase" }} />
        </Field>
        <Field label="SKU code (optional)">
          <TextInput aria-label="SKU code (optional)" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. AFP071" style={{ width: 110 }} disabled={saving} />
        </Field>
        <Field label="Category">
          <CategoryField
            categories={categoriesOf(products)}
            value={category}
            disabled={saving}
            onChange={(c) => {
              setCategory(c);
              if (!unitTouched) setUnit(unitForCategory(products, c));
            }}
          />
        </Field>
        <Field label="Unit">
          <TextInput
            aria-label="Unit"
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value);
              setUnitTouched(true);
            }}
            placeholder="e.g. Gallon"
            style={{ width: 110 }}
            disabled={saving}
          />
        </Field>
      </div>
      {error && (
        <div role="alert" style={{ color: colors.danger, fontSize: "calc(13px * var(--ae-fs, 1))", marginTop: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={saving} loadingLabel="Adding…">
          Add product
        </Button>
      </div>
    </form>
  );
}
