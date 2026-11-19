import { useEffect, useMemo, useState } from "react";
import { listProducts, updateProduct } from "../api/products";
import type { Product } from "../types";
import { ProductChooser } from "./ProductChooser";

/**
 * Adds products to the list being arranged (no template open) by choosing from the SKUs the system has that are not in
 * the list yet - the inactive ones, whose entries and history are kept. Adding switches them back on. The list already
 * holds every active product, so those are the only ones that can be missing. A product that does not exist at all is
 * created on the SKUs tab, which is the one place products are made.
 *
 * `products` is what is already in the list; the SKUs offered are every other SKU in the system.
 */
export function AddProductForm({
  products,
  onReactivated,
  onCancel,
}: {
  products: readonly Product[];
  /// SKUs were brought back into the list.
  onReactivated: (added: Product[]) => void;
  /// Closes the form (Cancel, or after everything chosen was added).
  onCancel: () => void;
}) {
  // Every SKU in the system, active or not: the list above only holds the active ones.
  const [all, setAll] = useState<Product[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    listProducts({ includeInactive: true }).then(
      (list) => !cancelled && setAll(list),
      () => !cancelled && setAll([]),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const inList = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const candidates = useMemo(() => (all === null ? null : all.filter((p) => !inList.has(p.id))), [all, inList]);

  async function add(chosen: Product[]): Promise<string | null> {
    const added: Product[] = [];
    let failure: string | null = null;
    for (const p of chosen) {
      try {
        added.push(await updateProduct(p.id, { isActive: true }));
      } catch (err) {
        failure = `${p.name}: ${err instanceof Error ? err.message : "could not be added"}`;
        break;
      }
    }
    if (added.length) onReactivated(added);
    // What was added is in the list now and no longer offered; what was not stays ticked to try again.
    if (!failure) onCancel();
    return failure;
  }

  return (
    <ProductChooser
      candidates={candidates}
      emptyMessage="Every SKU in the system is already in the list. A product that does not exist yet is created on the SKUs tab, then it can be arranged here."
      help="These SKUs are in the system but not in the list. Adding one brings it back with its history and puts it after the rest of its category. To make a product that does not exist yet, use the SKUs tab."
      onSubmit={add}
      onCancel={onCancel}
    />
  );
}
