import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Product } from "../types";
import { colors } from "../theme";
import { Button, Field, Select, TextInput } from "./ui";

const ALL = "";

/**
 * Picks products from a list of candidates: choose a category (with how many each has), narrow by name, SKU or category,
 * and tick the products to take - one, several, or everything shown. Nothing is typed, so a real product can never be
 * duplicated here.
 *
 * `candidates` is what is on offer (`null` while it loads). `onSubmit` receives the ticked products and returns an error
 * message, or null when it all worked; the chooser shows the message and keeps what is still on offer ticked, so a
 * partly failed batch can be retried. It never closes itself: the caller does, through `onCancel`.
 */
export function ProductChooser({
  candidates,
  emptyMessage,
  help,
  formLabel = "Add product",
  onSubmit,
  onCancel,
}: {
  candidates: readonly Product[] | null;
  /// Shown when there is nothing to choose from.
  emptyMessage: ReactNode;
  /// A line under the list saying what choosing does.
  help: ReactNode;
  formLabel?: string;
  onSubmit: (chosen: Product[]) => Promise<string | null> | string | null;
  onCancel: () => void;
}) {
  const sorted = useMemo(
    () => [...(candidates ?? [])].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [candidates],
  );
  // The categories that have something to choose, with how many.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of sorted) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [sorted]);

  const [category, setCategory] = useState(ALL);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter(
      (p) => (category === ALL || p.category === category) && (!q || `${p.sku ?? ""} ${p.name} ${p.category}`.toLowerCase().includes(q)),
    );
  }, [sorted, category, search]);
  // Only what is still on offer counts, so a product taken a moment ago cannot stay ticked.
  const chosen = sorted.filter((p) => picked.has(p.id));
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.id));

  function toggle(ids: number[], on: boolean) {
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (chosen.length === 0) {
      setError("Tick at least one product to add.");
      return;
    }
    setSaving(true);
    setError(null);
    const message = await onSubmit(chosen);
    if (message) {
      setError(message);
      setSaving(false);
    }
  }

  const label = (p: Product) => `${p.sku ?? "no SKU"} · ${p.name}`;
  const loading = candidates === null;
  const empty = !loading && sorted.length === 0;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label={formLabel}
      style={{ border: `1px solid ${colors.border}`, borderRadius: 4, padding: 10, marginBottom: 12, background: colors.paperAlt }}
    >
      {loading ? (
        <div style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk }}>Loading SKUs…</div>
      ) : empty ? (
        <div style={{ fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.subtleInk }}>{emptyMessage}</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 8 }}>
            <Field label="Category" style={{ flex: "1 1 200px" }}>
              <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={saving}>
                <option value={ALL}>All categories ({sorted.length})</option>
                {categories.map(([c, n]) => (
                  <option key={c} value={c}>
                    {c} ({n})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Search" style={{ flex: "1 1 160px" }}>
              <TextInput aria-label="Search SKUs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU or category" disabled={saving} />
            </Field>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "calc(12px * var(--ae-fs, 1))", color: colors.subtleInk, marginBottom: 4 }}>
            <input
              type="checkbox"
              aria-label="Select all shown"
              checked={allShownPicked}
              disabled={saving || shown.length === 0}
              onChange={(e) => toggle(shown.map((p) => p.id), e.target.checked)}
            />
            {shown.length === 0 ? "No SKU matches" : `Select all ${shown.length} shown`}
          </label>
          <ul
            aria-label="SKUs to add"
            style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "calc(var(--ae-vh) * 0.28)", overflowY: "auto", border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.surface }}
          >
            {shown.map((p, i) => (
              <li key={p.id}>
                {category === ALL && (i === 0 || shown[i - 1].category !== p.category) && (
                  <div style={{ padding: "4px 8px", fontSize: "calc(11px * var(--ae-fs, 1))", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", background: colors.paperAlt }}>{p.category}</div>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", cursor: "pointer", fontSize: "calc(13px * var(--ae-fs, 1))" }}>
                  <input type="checkbox" checked={picked.has(p.id)} disabled={saving} onChange={(e) => toggle([p.id], e.target.checked)} aria-label={label(p)} />
                  <span style={{ flex: 1, minWidth: 0 }}>{label(p)}</span>
                  {!p.isActive && <span style={{ fontSize: "calc(11px * var(--ae-fs, 1))", color: colors.subtleInk }}>inactive</span>}
                </label>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 6, fontSize: "calc(12px * var(--ae-fs, 1))", color: colors.subtleInk }}>{help}</div>
        </>
      )}
      {error && (
        <div role="alert" style={{ color: colors.danger, fontSize: "calc(13px * var(--ae-fs, 1))", marginTop: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={saving} loadingLabel="Adding…" disabled={loading || empty}>
          {chosen.length > 1 ? `Add ${chosen.length} products` : "Add product"}
        </Button>
      </div>
    </form>
  );
}
