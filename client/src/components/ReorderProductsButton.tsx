import { useEffect, useState } from "react";
import { listProducts, reorderProducts } from "../api/products";
import type { Product } from "../types";
import { colors } from "../theme";
import { Button } from "./ui";
import { Modal } from "./Modal";
import { ReorderIcon } from "./icons";
import { moveItem } from "../utils/moveItem";

/**
 * Toolbar icon (Supervisor/Admin only) that opens the product-order dialog.
 * The order is one shared sequence: saving it reorders the Online/Offline
 * entries, the Audit page, Total Stocks, the Daily Report and every product
 * picker, for everyone. A product always moves together with its SKU - the SKU
 * is part of the same row, so the two cannot be separated.
 */
export function ReorderProductsButton({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Arrange product order"
        title="Arrange product order (applies everywhere)"
        className="ae-tap-target ae-toolbar-icon-btn ae-toolbar-collapse-btn"
      >
        <ReorderIcon />
      </Button>
      {open && <ReorderProductsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ReorderProductsDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Product[] | null>(null);
  const [original, setOriginal] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProducts()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setOriginal(list.map((p) => p.id));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load products");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changed = items !== null && items.some((p, i) => p.id !== original[i]);

  async function save() {
    if (!items || !changed) return;
    setSaving(true);
    setError(null);
    try {
      await reorderProducts(items.map((p) => p.id));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the order");
      setSaving(false);
    }
  }

  function endDrag() {
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <Modal title="Arrange product order" onClose={saving ? () => {} : onClose} width={560}>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.subtleInk }}>
        Drag a row by its handle, or use the arrows. Each product keeps its SKU. The new order applies to every page
        and report, for everyone.
      </p>
      {error && (
        <div role="alert" style={{ color: colors.danger, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}
      {!items && !error && <div style={{ fontSize: 13, color: colors.subtleInk }}>Loading…</div>}
      {items && (
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: "calc(var(--ae-vh) * 0.5)",
            overflowY: "auto",
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
          }}
        >
          {items.map((p, i) => (
            <li
              key={p.id}
              draggable={!saving}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(p.id));
                setDragIndex(i);
              }}
              onDragEnter={() => dragIndex !== null && setOverIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) setItems((cur) => (cur ? moveItem(cur, dragIndex, i) : cur));
                endDrag();
              }}
              onDragEnd={endDrag}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderBottom: i === items.length - 1 ? "none" : `1px solid ${colors.border}`,
                background: dragIndex === i ? colors.paperAlt : colors.surface,
                opacity: dragIndex === i ? 0.6 : 1,
                boxShadow:
                  overIndex === i && dragIndex !== null && dragIndex !== i
                    ? `inset 0 ${dragIndex < i ? -2 : 2}px 0 ${colors.gold}`
                    : "none",
              }}
            >
              <span
                aria-hidden
                title="Drag to move"
                style={{ cursor: "grab", color: colors.subtleInk, userSelect: "none", fontSize: 16, lineHeight: 1 }}
              >
                ⠿
              </span>
              <span style={{ width: 28, textAlign: "right", fontSize: 12, color: colors.subtleInk }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </span>
                <span style={{ display: "block", fontSize: 11, color: colors.subtleInk }}>
                  {p.sku ?? "No SKU"} · {p.category}
                </span>
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={i === 0 || saving}
                onClick={() => setItems((cur) => (cur ? moveItem(cur, i, i - 1) : cur))}
                aria-label={`Move ${p.name} up`}
                title="Move up"
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={i === items.length - 1 || saving}
                onClick={() => setItems((cur) => (cur ? moveItem(cur, i, i + 1) : cur))}
                aria-label={`Move ${p.name} down`}
                title="Move down"
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={!changed || saving} loading={saving}>
          Save order
        </Button>
      </div>
    </Modal>
  );
}
