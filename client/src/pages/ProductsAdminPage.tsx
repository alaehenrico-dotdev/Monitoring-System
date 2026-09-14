import { useEffect, useState, type FormEvent } from "react";
import { createProduct, deactivateProduct, listProducts } from "../api/products";
import type { Product } from "../types";
import { Button, Field, TextInput } from "../components/ui";
import { colors } from "../theme";

/// Section 4.1 - Admins can add, rename, deactivate, or re-categorize
/// products without a developer; new SKUs appear in every grid automatically.
export function ProductsAdminPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    listProducts()
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load products"));
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
      const created = await createProduct({ name, category, unit });
      setName("");
      setCategory("");
      setUnit("");
      // Append locally instead of re-fetching the whole (60+ product) list.
      setProducts((prev) => (prev ? [...prev, created] : [created]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add product");
    }
  }

  async function handleDeactivate(id: number) {
    await deactivateProduct(id);
    setProducts((prev) => prev?.filter((p) => p.id !== id) ?? prev);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Product &amp; Category Master List</h2>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
        <Field label="Product name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Category">
          <TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. New Products" />
        </Field>
        <Field label="Unit">
          <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Gallon" />
        </Field>
        <Button type="submit">Add product</Button>
      </form>
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {!products ? (
        <p>Loading…</p>
      ) : (
        <div className="ae-table-scroll table-scroll">
          <table className="ae-table ae-table--left" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                {["Category", "Product", "Unit", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{p.category}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{p.name}</td>
                  <td>{p.unit}</td>
                  <td>
                    <Button variant="danger" size="sm" onClick={() => handleDeactivate(p.id)}>
                      Deactivate
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
