import { Fragment, useMemo, useState } from "react";
import { syncProducts } from "../api/products";
import { saveOrderTemplate } from "../api/orderTemplates";
import type { Product } from "../types";
import { colors } from "../theme";
import { Button, Select } from "./ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { showToast } from "./Toast";
import { categoryKey, fuzzyScore } from "../utils/importMatch";
import { planProductSync, sheetRowKey } from "../utils/productSync";
import type { TemplateRow } from "../utils/orderTemplate";

/**
 * What applying an Excel order template would do, shown before anything is
 * saved: the template's products in its exact order under its categories, and
 * for each one whether it is already there, moves to another category, or has to
 * be added.
 *
 * The product list is the source of truth for NAMES: a template row linked to an
 * existing product ("Same as") keeps that product's name, SKU and history, and
 * the template only decides its category and place in the order.
 *
 * A row can be linked in two situations:
 *  - NEW: the template has it and the system does not. "Same as" picks the
 *    existing product it really is, instead of adding a duplicate.
 *  - Already added earlier from a template (a product with no SKU) and used
 *    since: "Same as" merges it into the real product - its entries and counts
 *    move over and the duplicate is deleted.
 *
 * Applying goes through the same product sync the CSV/Excel import uses (one
 * transaction on the server): missing products are added (no SKU), merges are
 * done, moved ones take the template's category, and the template's sequence
 * becomes the order of the whole list. Products the template does not mention
 * are not touched - they stay in the system, after the listed ones.
 */
const SYNC_OPTIONS = { renameLinked: false };

export function OrderTemplateReview({
  rows,
  existing,
  saveAs,
  onBack,
  onDone,
}: {
  rows: TemplateRow[];
  existing: Product[];
  /// Applying also keeps the template under this name (a template read from a file),
  /// so it is still there after a reset or rebuild. Omitted for one that is already saved.
  saveAs?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  // Template rows the admin said are an existing product (row key -> id), for
  // rows that would otherwise be added as new.
  const [links, setLinks] = useState<Record<string, number>>({});
  // Rows that matched a product with no SKU (added earlier) which the admin said
  // is really another product (row key -> the product to keep).
  const [merges, setMerges] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  // Optionally hide the products the template does not list. Off by default: a
  // template sets the ORDER and CATEGORIES of the products the system already has,
  // it does not remove any of them. Hiding only switches a product off - its entries
  // and history stay - and it can be switched back on from the SKU list.
  const [hideOthers, setHideOthers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // As matched by name only - tells which product each row would use before any merge.
  const base = useMemo(() => planProductSync(rows, existing, links, SYNC_OPTIONS), [rows, existing, links]);
  const byId = useMemo(() => new Map(existing.map((p) => [p.id, p])), [existing]);

  /// For each row that matched a product with no SKU: that product.
  const mergeable = useMemo(() => {
    const m = new Map<string, Product>();
    for (const item of base.items) {
      const p = item.productId === undefined ? undefined : byId.get(item.productId);
      if (p && !p.sku) m.set(sheetRowKey(item.category, item.name), p);
    }
    return m;
  }, [base, byId]);

  // Products being merged away. They are taken out of what the plan can match, so
  // no other template row (one with the same name under another category, say)
  // can pick up a product that is about to be deleted - the server refuses a
  // product that is both merged away and a row of the sheet.
  const mergedAway = useMemo(() => new Set(Object.keys(merges).flatMap((k) => mergeable.get(k)?.id ?? [])), [merges, mergeable]);
  const plan = useMemo(
    () =>
      planProductSync(
        rows,
        existing.filter((p) => !mergedAway.has(p.id)),
        { ...links, ...merges },
        SYNC_OPTIONS,
      ),
    [rows, existing, links, merges, mergedAway],
  );

  // Existing products no template row has claimed - what a row can be linked to.
  // Linking one removes it from the others' choices, and a product that is being
  // merged away is not a choice for anything.
  const unclaimed = useMemo(() => {
    const claimed = new Set(plan.items.flatMap((i) => (i.productId === undefined ? [] : [i.productId])));
    return existing.filter((p) => !claimed.has(p.id) && !mergedAway.has(p.id));
  }, [plan, existing, mergedAway]);
  /// Best matches first: the same name with a size or unit tacked on ("Palm Oil
  /// Liter") ranks above unrelated products, but every free product is offered.
  const choicesFor = (item: { category: string; name: string }) =>
    unclaimed
      .map((p) => ({ p, score: fuzzyScore(item.name, p.name) + (categoryKey(p.category) === categoryKey(item.category) ? 0.05 : 0) }))
      .sort((a, b) => b.score - a.score)
      .map((c) => c.p);

  /// What is sent: the plan, with each merge naming the duplicate to fold in.
  const items = plan.items.map((item) => {
    const key = sheetRowKey(item.category, item.name);
    const duplicate = merges[key] !== undefined ? mergeable.get(key) : undefined;
    return duplicate ? { ...item, mergeFromId: duplicate.id } : item;
  });
  const mergeCount = items.filter((i) => i.mergeFromId !== undefined).length;
  // Products no template row claims, and which are not being merged away.
  const hideCount = hideOthers ? unclaimed.length : 0;

  const categories = new Set(plan.items.map((i) => categoryKey(i.category))).size;
  const placed = plan.items.filter((i) => i.productId !== undefined).length;
  const others = existing.length - placed - mergeCount;

  async function apply() {
    setConfirming(false);
    setSaving(true);
    setError(null);
    try {
      const r = await syncProducts(items, { deactivateUnlisted: hideCount > 0 });
      // The order is applied; keeping the template is a courtesy and must not turn a
      // successful apply into an error, so a failure here is only reported.
      let kept = "";
      if (saveAs) {
        try {
          await saveOrderTemplate(saveAs, rows);
          kept = `saved as "${saveAs}"`;
        } catch {
          kept = "could not be saved as a template";
        }
      }
      const parts = [
        `${r.total} products in the template's order`,
        r.created ? `${r.created} added` : "",
        r.merged ? `${r.merged} merged` : "",
        r.deactivated ? `${r.deactivated} hidden` : "",
        kept,
        r.moved ? `${r.moved} changed` : "",
      ].filter(Boolean);
      showToast(`Template applied - ${parts.join(", ")}`, "success");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the template");
      setSaving(false);
    }
  }

  const label = (p: Product) => `${p.name} (${p.sku ?? p.category})`;
  return (
    <>
      <div role="status" style={{ fontSize: 13, marginBottom: 10 }}>
        <strong>
          {plan.items.length} product{plan.items.length === 1 ? "" : "s"} in {categories} categor{categories === 1 ? "y" : "ies"}
        </strong>
        <span style={{ color: colors.subtleInk }}>
          {" "}
          - exactly as the template lists them.
          {plan.toCreate.length > 0 && ` ${plan.toCreate.length} will be added.`}
          {mergeCount > 0 && ` ${mergeCount} will be merged.`}
          {plan.toMove.length > 0 && ` ${plan.toMove.length} will move to the template's category.`}
          {others > 0 &&
            (hideOthers
              ? ` ${others} other product${others === 1 ? "" : "s"} not in the template will be hidden.`
              : ` ${others} other product${others === 1 ? "" : "s"} not in the template stay where they are, beside their own category.`)}
        </span>
      </div>
      {error && (
        <div role="alert" style={{ color: colors.danger, fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}
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
        {plan.items.map((item, i) => {
          const showHeading = i === 0 || item.category !== plan.items[i - 1].category;
          const key = sheetRowKey(item.category, item.name);
          const isNew = item.productId === undefined;
          const current = item.productId === undefined ? undefined : byId.get(item.productId);
          const moves = !!current && categoryKey(current.category) !== categoryKey(item.category);
          const linked = links[key] !== undefined && !!current;
          // A row that matched a product with no SKU (added earlier) can be merged
          // into the product it really is.
          const duplicate = mergeable.get(key);
          const merging = merges[key] !== undefined && !!duplicate;
          const canChoose = isNew || (!!duplicate && !merging);
          const choices = canChoose ? choicesFor(item) : [];
          return (
            <Fragment key={`${key}-${i}`}>
              {showHeading && (
                <li
                  style={{
                    padding: "5px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    background: colors.paperAlt,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  {item.category}
                </li>
              )}
              <li
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: "5px 8px",
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <span style={{ width: 28, textAlign: "right", fontSize: 12, color: colors.subtleInk }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 600 }}>
                  {/* The system's own name wins over the template's spelling. */}
                  {current && (linked || merging) ? current.name : item.name}
                  {current && (linked || merging) && current.name !== item.name && (
                    <span style={{ fontWeight: 400, fontSize: 11, color: colors.subtleInk }}> (template: {item.name})</span>
                  )}
                </span>
                {isNew && <span style={{ fontSize: 11, fontWeight: 700, color: colors.warningText }}>NEW</span>}
                {duplicate && !merging && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.warningText }} title="No SKU: added earlier, not one of the original products">
                    NEW · no SKU
                  </span>
                )}
                {merging && current && duplicate && (
                  <span style={{ fontSize: 11, color: colors.subtleInk }}>
                    merges &quot;{duplicate.name}&quot; into it
                  </span>
                )}
                {linked && current && <span style={{ fontSize: 11, color: colors.subtleInk }}>same as {label(current)}</span>}
                {moves && current && <span style={{ fontSize: 11, color: colors.subtleInk }}>moves from {current.category}</span>}
                {canChoose && choices.length > 0 && (
                  <Select
                    aria-label={`Is ${item.name} an existing product?`}
                    value=""
                    disabled={saving}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (!id) return;
                      if (duplicate) setMerges((prev) => ({ ...prev, [key]: id }));
                      else setLinks((prev) => ({ ...prev, [key]: id }));
                    }}
                    style={{ width: "auto", maxWidth: 240, fontSize: 12 }}
                  >
                    <option value="">{duplicate ? "Keep as a separate product" : "Add as a new product"}</option>
                    {choices.map((p) => (
                      <option key={p.id} value={p.id}>
                        Same as: {label(p)}
                      </option>
                    ))}
                  </Select>
                )}
                {(linked || merging) && (
                  <button
                    type="button"
                    className="ae-fill-down-btn"
                    disabled={saving}
                    onClick={() => {
                      const drop = (prev: Record<string, number>) => {
                        const { [key]: _removed, ...rest } = prev;
                        return rest;
                      };
                      if (merging) setMerges(drop);
                      else setLinks(drop);
                    }}
                    title={merging ? "Undo: keep it as a separate product" : "Undo the link: add it as a new product instead"}
                    aria-label={`Undo same-as for ${item.name}`}
                  >
                    &times;
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
      {unclaimed.length > 0 && (
        <div style={{ margin: "10px 0 0", fontSize: 12.5 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={hideOthers}
              disabled={saving}
              onChange={(e) => setHideOthers(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Also hide the {unclaimed.length} product{unclaimed.length === 1 ? "" : "s"} that {unclaimed.length === 1 ? "is" : "are"} not in the template (optional)
              <span style={{ display: "block", color: colors.subtleInk }}>
                Leave this off to keep every product: those not in the template stay, beside their own category. Hidden products
                disappear from every sheet and report but keep their entries and history, and can be switched back on from the SKU
                list. Their stock no longer shows in Consolidated.
              </span>
            </span>
          </label>
          <details style={{ margin: "4px 0 0 24px", color: colors.subtleInk }}>
            <summary style={{ cursor: "pointer" }}>Which products?</summary>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {unclaimed.map((p) => (
                <li key={p.id}>
                  {p.name} · {p.category}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {mergeCount > 0 && (
        <p role="note" style={{ margin: "10px 0 0", fontSize: 12.5, color: colors.warningText }}>
          {mergeCount} merge{mergeCount === 1 ? "" : "s"}: all of the entries, counts and added columns of the duplicate move to the
          product it is the same as, and the duplicate is deleted. This cannot be undone - take a backup first.
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Button type="button" variant="secondary" onClick={onBack} disabled={saving}>
          Back to list
        </Button>
        <Button
          type="button"
          onClick={() => (mergeCount > 0 || hideCount > 0 ? setConfirming(true) : void apply())}
          disabled={(plan.inSync && mergeCount === 0 && hideCount === 0) || saving}
          loading={saving}
        >
          {plan.inSync && mergeCount === 0 && hideCount === 0
            ? "Already matches"
            : mergeCount > 0
              ? `Apply template & merge ${mergeCount}`
              : "Apply template"}
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={mergeCount > 0 ? `Merge ${mergeCount} product${mergeCount === 1 ? "" : "s"}?` : `Hide ${hideCount} product${hideCount === 1 ? "" : "s"}?`}
          confirmLabel={mergeCount > 0 ? "Merge and apply" : "Hide and apply"}
          busy={saving}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
        >
          {mergeCount > 0 && (
            <p style={{ margin: "0 0 8px" }}>
              Each duplicate&apos;s entries, counts and added columns move to the product it is the same as, which keeps its own
              name and SKU, and the duplicate is deleted. If both have entries for the same date and shift nothing is merged and
              you will be told which. This cannot be undone.
            </p>
          )}
          {hideCount > 0 && (
            <p style={{ margin: 0 }}>
              {hideCount} product{hideCount === 1 ? "" : "s"} not in the template will be hidden from every sheet and report. Their
              entries and history are kept, their stock no longer shows in Consolidated, and you can switch them back on from the
              SKU list.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
