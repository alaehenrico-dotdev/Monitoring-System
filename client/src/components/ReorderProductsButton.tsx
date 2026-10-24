import { useEffect, useRef, useState } from "react";
import { listProducts, reorderProducts } from "../api/products";
import { deleteOrderTemplate, listOrderTemplates, type SavedOrderTemplate } from "../api/orderTemplates";
import type { Product } from "../types";
import { colors } from "../theme";
import { Button, Select } from "./ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { showToast } from "./Toast";
import { Modal } from "./Modal";
import { ReorderIcon } from "./icons";
import { moveItem } from "../utils/moveItem";
import { readXlsxColumnA, type XlsxStyledSheet } from "../utils/xlsx";
import { templateRowsFromColumn, type TemplateRow } from "../utils/orderTemplate";
import { OrderTemplateReview } from "./OrderTemplateReview";
import { AddProductForm } from "./AddProductForm";
import { insertAfterCategory } from "../utils/productPlacement";

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
        <span className="ae-toolbar-btn-label">Reorder</span>
      </Button>
      {open && <ReorderProductsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReorderProductsDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Product[] | null>(null);
  const [original, setOriginal] = useState<number[]>([]);
  // Add product (for one the template does not list): the form is open, and each
  // product's category by id, so a product added now can be placed in `original`
  // (the order as saved) the same way the server placed it.
  const [adding, setAdding] = useState(false);
  const categoryOf = useRef(new Map<number, string>());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Excel template (see utils/orderTemplate.ts): the workbook that was picked
  // and the rows read from one of its sheets. While there are rows the dialog
  // shows OrderTemplateReview instead of the drag list; nothing is saved until
  // the review's "Apply template".
  const fileInput = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<{ fileName: string; sheets: XlsxStyledSheet[]; sheet: number } | null>(null);
  const [templateRows, setTemplateRows] = useState<TemplateRow[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  // Templates kept in the database (so they survive a reset or rebuild) and the one
  // currently chosen from them. A template read from a file is saved by applying it.
  const [saved, setSaved] = useState<SavedOrderTemplate[]>([]);
  const [activeSaved, setActiveSaved] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    // A failure here only means no saved templates are offered; the file picker still works.
    listOrderTemplates().then(setSaved, () => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    listProducts()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setOriginal(list.map((p) => p.id));
        categoryOf.current = new Map(list.map((p) => [p.id, p.category]));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load products");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A shorter list (a template that lists fewer products) is a change even when it starts the same.
  const changed = items !== null && (items.length !== original.length || items.some((p, i) => p.id !== original[i]));

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

  /// The server has already saved the new product, right after the last one of its
  /// category. Put it in the same place in the list on screen and in the saved
  /// order, so adding a product is not an unsaved change and any reordering in
  /// progress is kept.
  function handleAdded(created: Product) {
    categoryOf.current.set(created.id, created.category);
    setItems((cur) => (cur ? insertAfterCategory(cur, created) : [created]));
    setOriginal((ids) =>
      insertAfterCategory(
        ids.map((id) => ({ id, category: categoryOf.current.get(id) ?? "" })),
        { id: created.id, category: created.category },
      ).map((x) => x.id),
    );
    setAdding(false);
    showToast(`${created.name} added to ${created.category}.`, "success");
  }

  /// Reads one sheet of the template into rows for the review.
  function applyTemplate(sheets: XlsxStyledSheet[], sheet: number) {
    const rows = templateRowsFromColumn(sheets[sheet].cells);
    if (rows.length === 0) {
      setTemplateRows(null);
      setTemplateError(
        `No bold category and product names were found in column A of "${sheets[sheet].name}". Pick another sheet or file.`,
      );
      return;
    }
    setTemplateError(null);
    setTemplateRows(rows);
  }

  async function pickTemplate(file: File | undefined) {
    if (!file) return;
    setTemplateError(null);
    try {
      setActiveSaved(null);
      const sheets = await readXlsxColumnA(await file.arrayBuffer());
      // The first sheet that has something to read: a workbook may open on a cover page.
      const first = Math.max(0, sheets.findIndex((s) => templateRowsFromColumn(s.cells).length > 0));
      setTemplate({ fileName: file.name, sheets, sheet: first });
      applyTemplate(sheets, first);
    } catch (e) {
      setTemplate(null);
      setTemplateRows(null);
      setTemplateError(e instanceof Error ? e.message : "Could not read that file");
    }
  }

  /// The name a template read from a file is saved under when it is applied: the file
  /// name or, for a workbook with a tab per day, "Encoder order - OCT 8". Applying the
  /// same file again replaces that template rather than adding another.
  const saveAs = template
    ? template.fileName.replace(/\.xlsx$/i, "") + (template.sheets.length > 1 ? ` - ${template.sheets[template.sheet].name}` : "")
    : undefined;

  async function removeSavedTemplate() {
    const id = activeSaved;
    setConfirmDelete(false);
    if (id === null) return;
    try {
      await deleteOrderTemplate(id);
      setSaved((cur) => cur.filter((t) => t.id !== id));
      setActiveSaved(null);
      setTemplateRows(null);
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : "Could not delete the template");
    }
  }

  return (
    <Modal title="Arrange product order" onClose={saving ? () => {} : onClose} width={560}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {saved.length > 0 && (
          <>
            <Select
              aria-label="Saved templates"
              value={activeSaved ?? ""}
              disabled={saving || !items}
              onChange={(e) => {
                const t = saved.find((x) => x.id === Number(e.target.value));
                setTemplate(null);
                setTemplateError(null);
                setActiveSaved(t?.id ?? null);
                setTemplateRows(t ? t.rows : null);
              }}
              style={{ width: "auto", maxWidth: 240 }}
            >
              <option value="">Saved templates…</option>
              {saved.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.rows.length})
                </option>
              ))}
            </Select>
            {activeSaved !== null && (
              <button
                type="button"
                className="ae-fill-down-btn"
                onClick={() => setConfirmDelete(true)}
                title="Delete this saved template"
                aria-label="Delete saved template"
              >
                &times;
              </button>
            )}
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file again re-applies it.
            e.target.value = "";
            void pickTemplate(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving || !items}
          onClick={() => fileInput.current?.click()}
          title="Arrange the list from an Excel template: bold headings are categories, bold lines under them are products"
        >
          Select Excel template
        </Button>
        {!templateRows && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving || !items || adding}
            onClick={() => setAdding(true)}
            title="Add a product the template does not list"
          >
            Add product
          </Button>
        )}
        {template && (
          <span style={{ fontSize: 12, color: colors.subtleInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }} title={template.fileName}>
            {template.fileName}
          </span>
        )}
        {template && template.sheets.length > 1 && (
          <Select
            aria-label="Template sheet"
            value={template.sheet}
            disabled={saving}
            onChange={(e) => {
              const sheet = Number(e.target.value);
              setTemplate({ ...template, sheet });
              applyTemplate(template.sheets, sheet);
            }}
            style={{ width: "auto", minWidth: 120 }}
          >
            {template.sheets.map((s, i) => (
              <option key={i} value={i}>
                {s.name || `Sheet ${i + 1}`}
              </option>
            ))}
          </Select>
        )}
      </div>
      {templateError && (
        <div role="alert" style={{ color: colors.danger, fontSize: 13, marginBottom: 10 }}>
          {templateError}
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this saved template?"
          confirmLabel="Delete"
          onConfirm={() => void removeSavedTemplate()}
          onCancel={() => setConfirmDelete(false)}
        >
          {saved.find((t) => t.id === activeSaved)?.name} will no longer be offered. Products already arranged by it are not changed.
        </ConfirmDialog>
      )}
      {templateRows && items ? (
        <OrderTemplateReview
          rows={templateRows}
          existing={items}
          saveAs={saveAs}
          onBack={() => setTemplateRows(null)}
          onDone={onClose}
        />
      ) : (
        <>
      {adding && items && <AddProductForm products={items} onAdded={handleAdded} onCancel={() => setAdding(false)} />}
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
        </>
      )}
    </Modal>
  );
}
