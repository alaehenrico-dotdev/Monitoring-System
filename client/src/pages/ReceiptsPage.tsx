import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { createReceipt, createReceiptsBatch, listLastCustomers, listReceipts, type CreateReceiptBatchInput } from "../api/receipts";
import { listProducts } from "../api/products";
import { listDeliveryDestinations } from "../api/deliveryDestinations";
import type { DeliveryDestination, Product, Receipt } from "../types";
import { colors } from "../theme";
import {
  Divider,
  ReceiptCard,
  ReceiptPaper,
  RECEIPT_CARD_WIDTH,
} from "../components/ReceiptCard";
import { ConsolidatedReceiptEntryGrid, type EntryCustomerColumn } from "../components/ConsolidatedReceiptEntryGrid";
import { Button, Select } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { useAuth } from "../context/AuthContext";
import { Toolbar, ToolbarControls, ToolbarDivider } from "../components/Toolbar";
import { SearchInput } from "../components/SearchInput";
import { CategoryFilter } from "../components/CategoryFilter";
import { SkuCombobox } from "../components/SkuCombobox";
import { formatPeso } from "../utils/consolidatedReceipts";
import { AddDestinationModal, ADD_DESTINATION_VALUE } from "../components/AddDestinationModal";
import { useSessionState } from "../hooks/useSessionState";
import { RECEIPT_DRAFT_PREFIX } from "../utils/unsavedWork";
import { useZoom, zoomStyle, ZoomControl } from "../components/ZoomControl";
import { Modal } from "../components/Modal";
import { matchesSearch } from "../utils/search";
import { formatDateDisplay } from "../utils/dateFormat";
import { generateReceiptPdf } from "../utils/receiptPdf";
import { PrinterIcon, SaveIcon } from "../components/icons";
import { TableSkeleton } from "../components/Skeleton";
import { useTopProgress } from "../hooks/useTopProgress";
/*
 * ============================================================
 * THERMAL RECEIPT PRINT SETTINGS
 * ============================================================
 *
 * Standard thermal POS paper comes in two common widths:
 *
 *   58mm  - smallest widely-supported thermal roll (kiosk /
 *           handheld printers), ~48mm printable
 *   80mm  - standard counter POS printer, ~72mm printable
 *
 * There is no smaller "standard" thermal size below 58mm, so we
 * offer both rather than guessing which hardware the user has.
 */
const THERMAL_PAPER_SIZES = {
  "58mm": { paperMM: 58, printableMM: 48, label: "58mm (small)" },
  "80mm": { paperMM: 80, printableMM: 72, label: "80mm (standard)" },
} as const;

type ThermalPaperSize = keyof typeof THERMAL_PAPER_SIZES;

const DEFAULT_THERMAL_PAPER_SIZE: ThermalPaperSize = "58mm";

/// Which entry surface is showing - one receipt at a time (any pool, any
/// encoder role) or a whole sheet of customers at once for one delivery
/// date/location (Offline-only, see EntryMode's own gating below). Both
/// write into the same `receipts` table through the same recent-receipts
/// list at the bottom of this page - there was never a need for two
/// separate pages, just two different ways of filling the same form.
type EntryMode = "single" | "bulk";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function newCustomerId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function bulkCellKey(productId: number, customerId: string): string {
  return `${productId}:${customerId}`;
}

// Small top nudge for the receipt entry columns.
const RECEIPT_COLUMN_TOP = 8;

// "Recent Receipts" visible rows.
const RECEIPT_LIST_VISIBLE_ROWS = 20;
const RECEIPT_LIST_MAX_HEIGHT = 29 + RECEIPT_LIST_VISIBLE_ROWS * 23;

interface LineItem {
  productId: number;
  quantity: string;
  unitPrice: string;
}

/**
 * Section 4.7 - Receipt / Sales Order Entry.
 *
 * Two entry modes share this one page:
 * - Single: the editable receipt form on the left, with a live preview card
 *   on the right - any pool, any encoder role.
 * - Bulk: one delivery date/location for a whole sheet, customers as
 *   editable columns, products as rows - Offline Delivery only, so only
 *   visible to Offline Encoders/Supervisors.
 *
 * Both modes feed the same "Recent Receipts" list below, since they create
 * the exact same kind of record either way.
 */
export function ReceiptsPage() {
  const { user } = useAuth();
  const progress = useTopProgress();
  const canBulk = user?.role === "OFFLINE_ENCODER" || user?.role === "SUPERVISOR_ADMIN";

  // Everything typed on this page (both modes) is kept in sessionStorage
  // under RECEIPT_DRAFT_PREFIX, so switching to another tab and back doesn't
  // wipe an in-progress receipt or bulk sheet - same idea as the Online/
  // Offline Entry pages' staged edits. Cleared by a successful save, by
  // Data Reset, or by closing the browser tab.
  const [modeState, setModeState] = useSessionState<EntryMode>(`${RECEIPT_DRAFT_PREFIX}mode`, "single");
  // A restored "bulk" is ignored for roles that can't use it.
  const mode: EntryMode = canBulk ? modeState : "single";
  function setMode(next: EntryMode) {
    setModeState(next);
    setError(null);
    setBulkSaved(null);
  }

  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [destinations, setDestinations] = useState<DeliveryDestination[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [zoom, setZoom] = useZoom("receipts");
  const [query, setQuery] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  // Thermal paper size chosen for the print/PDF modal. Persists across
  // receipt selections within a session so repeat prints don't require
  // re-picking the same size each time.
  const [paperSize, setPaperSize] = useState<ThermalPaperSize>(
    DEFAULT_THERMAL_PAPER_SIZE
  );

  const [orderDate, setOrderDate] = useSessionState(`${RECEIPT_DRAFT_PREFIX}order-date`, today);
  const [customer, setCustomer] = useSessionState(`${RECEIPT_DRAFT_PREFIX}customer`, "");
  const [location, setLocation] = useSessionState(`${RECEIPT_DRAFT_PREFIX}location`, "");
  const [salesRepName, setSalesRepName] = useSessionState(`${RECEIPT_DRAFT_PREFIX}sales-rep`, "");
  // Which stock pool (if any) this receipt tallies against. Online and
  // Offline are separate pools that aren't expected to tally with each
  // other (Section 2.1), so at most one of these is ever true - checking
  // one clears the other rather than letting both post at once. Defaults
  // to the pre-existing Online behavior so nothing changes for anyone who
  // never touches the new control.
  const [postToFulfillment, setPostToFulfillment] = useSessionState(`${RECEIPT_DRAFT_PREFIX}post-fulfillment`, true);
  const [postToOfflineDelivery, setPostToOfflineDelivery] = useSessionState(`${RECEIPT_DRAFT_PREFIX}post-offline`, false);

  function toggleFulfillment(checked: boolean) {
    setPostToFulfillment(checked);
    if (checked) setPostToOfflineDelivery(false);
  }

  function toggleOfflineDelivery(checked: boolean) {
    setPostToOfflineDelivery(checked);
    if (checked) setPostToFulfillment(false);
  }

  const [items, setItems] = useSessionState<LineItem[]>(`${RECEIPT_DRAFT_PREFIX}items`, [
    { productId: 0, quantity: "", unitPrice: "" },
  ]);

  // ---------------------------------------------------------------------
  // Bulk entry state (Section 4.7's Consolidated Receipt bulk entry).
  // ---------------------------------------------------------------------
  const [bulkDate, setBulkDate] = useSessionState(`${RECEIPT_DRAFT_PREFIX}bulk-date`, today);
  const [bulkLocation, setBulkLocation] = useSessionState(`${RECEIPT_DRAFT_PREFIX}bulk-location`, "");
  const [bulkCustomers, setBulkCustomers] = useSessionState<EntryCustomerColumn[]>(`${RECEIPT_DRAFT_PREFIX}bulk-customers`, []);
  // Keyed by `${productId}:${customerId}` - price is entered per customer, per product.
  const [bulkUnitPrices, setBulkUnitPrices] = useSessionState<Record<string, string>>(`${RECEIPT_DRAFT_PREFIX}bulk-prices`, {});
  const [bulkQuantities, setBulkQuantities] = useSessionState<Record<string, string>>(`${RECEIPT_DRAFT_PREFIX}bulk-quantities`, {});
  // View-only filter for the bulk grid's rows - not part of the draft.
  const [bulkCategory, setBulkCategory] = useState("");
  // Which destination <select> asked for "+ Add new destination…" (null = modal closed).
  const [addDestinationFor, setAddDestinationFor] = useState<"single" | "bulk" | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSaved, setBulkSaved] = useState<{ count: number; date: string } | null>(null);

  /*
   * Load receipts, products, and delivery destinations.
   */
  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load receipts");
        setReceipts([]);
      });

    listProducts()
      .then(setProducts)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load SKUs")
      );

    listDeliveryDestinations()
      .then(setDestinations)
      .catch(() => setDestinations([])); // best-effort, same as OfflineEntryPage
  }, []);

  // Pre-fill the bulk sheet's customer columns from this location's last
  // prior sheet instead of starting blank, whenever its date or location
  // changes - but only while the sheet is still untouched (no quantities
  // entered yet), so switching dates mid-entry can never silently wipe
  // someone's in-progress work. bulkQuantities is intentionally left out of
  // the dependency list: this should fire on date/location changes only,
  // using the current quantities purely as a guard at the moment it runs.
  // A sheet restored from sessionStorage (customer columns already there)
  // must not be replaced by the prefill on the very render it comes back on -
  // that would silently swap the customers the person had just set up for
  // the location's previous ones. Only skips the restored date/location
  // pair; changing either one afterwards behaves as before.
  const skipPrefillKey = useRef<string | null>(bulkCustomers.length > 0 ? `${bulkLocation}|${bulkDate}` : null);

  useEffect(() => {
    if (!bulkLocation) return;
    if (Object.keys(bulkQuantities).length > 0) return;
    const prefillKey = `${bulkLocation}|${bulkDate}`;
    if (skipPrefillKey.current === prefillKey) return;
    skipPrefillKey.current = null;

    let cancelled = false;
    listLastCustomers(bulkLocation, bulkDate)
      .then((names) => {
        if (cancelled || names.length === 0) return;
        setBulkCustomers(names.map((name) => ({ id: newCustomerId(), customer: name, salesRepName: "" })));
      })
      .catch(() => {}); // best-effort - never blocks manually adding customers
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkLocation, bulkDate]);

  /*
   * Update one order item.
   */
  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  }

  /*
   * Add another product row.
   */
  function addItemRow() {
    setItems((prev) => [...prev, { productId: 0, quantity: "", unitPrice: "" }]);
  }

  /*
   * Remove a product row.
   */
  function removeItemRow(index: number) {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index)
    );
  }

  /*
   * Save the receipt.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validItems = items.filter(
      (it) => it.productId && Number(it.quantity) > 0 && Number(it.unitPrice) > 0
    );

    if (!customer || !location || !validItems.length) {
      setError(
        "Customer, location, and at least one order item (with a unit price) are required."
      );
      return;
    }

    setSubmitting(true);

    try {
      const saved = await createReceipt({
        orderDate,
        customer,
        location,
        salesRepName: salesRepName.trim() || undefined,
        postToFulfillment,
        postToOfflineDelivery,
        items: validItems.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
      });

      setReceipts((prev) => [saved, ...(prev ?? [])]);

      setCustomer("");
      setLocation("");
      setSalesRepName("");
      setItems([{ productId: 0, quantity: "", unitPrice: "" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save receipt");
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * Build the live receipt preview from the current form.
   */
  const previewReceipt: Receipt = useMemo(() => {
    const previewItems = items
      .map((it, idx) => {
        const product = products.find((p) => p.id === it.productId);

        if (!product || !(Number(it.quantity) > 0)) {
          return null;
        }

        return {
          id: idx,
          productId: it.productId,
          product,
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice !== "" ? Number(it.unitPrice) : null,
        };
      })
      .filter((it): it is NonNullable<typeof it> => it !== null);

    return {
      id: 0,
      orderDate,
      customer,
      location,
      salesRepName: salesRepName.trim() || null,
      salesRepId: null,
      salesRep: null,
      createdBy: user
        ? { id: user.id, username: user.username, name: user.name, role: user.role }
        : null,
      createdAt: new Date().toISOString(),
      items: previewItems,
      postedPool: postToFulfillment ? "FULFILLMENT" : postToOfflineDelivery ? "OFFLINE_DELIVERY" : "NONE",
      // Never actually rendered - ReceiptCard skips the QR code entirely
      // for `isPreview` receipts (there's nothing stable to encode until
      // the receipt has a real, server-issued id/token).
      qrToken: "",
    };
  }, [orderDate, customer, location, items, products, user, salesRepName, postToFulfillment, postToOfflineDelivery]);

  // ---------------------------------------------------------------------
  // Destination dropdowns' "+ Add new destination…" option.
  // ---------------------------------------------------------------------

  function handleDestinationChange(value: string, target: "single" | "bulk") {
    if (value === ADD_DESTINATION_VALUE) {
      setAddDestinationFor(target);
      return;
    }
    if (target === "bulk") setBulkLocation(value);
    else setLocation(value);
  }

  function handleDestinationCreated(destination: DeliveryDestination) {
    setDestinations((prev) => (prev.some((d) => d.id === destination.id) ? prev : [...prev, destination]));
    if (addDestinationFor === "bulk") setBulkLocation(destination.name);
    else setLocation(destination.name);
    setAddDestinationFor(null);
  }

  const bulkCategories = useMemo(() => Array.from(new Set(products.map((p) => p.category))).sort(), [products]);

  // ---------------------------------------------------------------------
  // Bulk entry handlers.
  // ---------------------------------------------------------------------

  function addBulkCustomer() {
    setBulkCustomers((prev) => [...prev, { id: newCustomerId(), customer: "", salesRepName: "" }]);
  }

  function renameBulkCustomer(id: string, patch: Partial<Omit<EntryCustomerColumn, "id">>) {
    setBulkCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeBulkCustomer(id: string) {
    setBulkCustomers((prev) => prev.filter((c) => c.id !== id));
    setBulkQuantities((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.endsWith(`:${id}`)) delete next[key];
      }
      return next;
    });
    setBulkUnitPrices((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.endsWith(`:${id}`)) delete next[key];
      }
      return next;
    });
  }

  function setBulkUnitPrice(productId: number, customerId: string, value: string) {
    setBulkUnitPrices((prev) => ({ ...prev, [bulkCellKey(productId, customerId)]: value }));
  }

  function setBulkQuantity(productId: number, customerId: string, value: string) {
    setBulkQuantities((prev) => ({ ...prev, [bulkCellKey(productId, customerId)]: value }));
  }

  function resetBulkForm() {
    setBulkCustomers([]);
    setBulkQuantities({});
    setBulkUnitPrices({});
  }

  async function handleBulkSave() {
    setError(null);
    setBulkSaved(null);

    if (!bulkLocation) {
      setError("Pick a delivery location first.");
      return;
    }

    const missingPriceNames = new Set<string>();
    for (const c of bulkCustomers) {
      for (const p of products) {
        const qty = Number(bulkQuantities[bulkCellKey(p.id, c.id)]);
        if (qty > 0 && !(Number(bulkUnitPrices[bulkCellKey(p.id, c.id)]) > 0)) {
          missingPriceNames.add(p.name);
        }
      }
    }
    if (missingPriceNames.size > 0) {
      setError(`Set a unit price for: ${[...missingPriceNames].join(", ")}`);
      return;
    }

    const batch: CreateReceiptBatchInput[] = [];
    for (const c of bulkCustomers) {
      if (!c.customer.trim()) continue;
      const batchItems = products
        .map((p) => {
          const qty = Number(bulkQuantities[bulkCellKey(p.id, c.id)]);
          if (!(qty > 0)) return null;
          return { productId: p.id, quantity: qty, unitPrice: Number(bulkUnitPrices[bulkCellKey(p.id, c.id)]) };
        })
        .filter((it): it is NonNullable<typeof it> => it !== null);
      if (batchItems.length === 0) continue;

      batch.push({
        orderDate: bulkDate,
        customer: c.customer.trim(),
        location: bulkLocation,
        salesRepName: c.salesRepName.trim() || undefined,
        postToFulfillment: false,
        postToOfflineDelivery: true,
        items: batchItems,
      });
    }

    if (batch.length === 0) {
      setError("Add a customer name and at least one quantity before saving.");
      return;
    }

    setBulkSaving(true);
    try {
      const created = await createReceiptsBatch(batch);
      setReceipts((prev) => [...created, ...(prev ?? [])]);
      setBulkSaved({ count: created.length, date: bulkDate });
      resetBulkForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the batch");
    } finally {
      setBulkSaving(false);
    }
  }

  /*
   * Search and sort recent receipts.
   */
  const visibleReceipts = receipts
    ?.filter((r) =>
      matchesSearch(
        [
          r.customer,
          r.location,
          r.salesRepName,
          ...r.items.map((it) => it.product.name),
          ...r.items.map((it) => it.product.sku),
        ],
        query
      )
    )
    .sort((a, b) =>
      a.orderDate < b.orderDate ? 1 : a.orderDate > b.orderDate ? -1 : b.id - a.id
    );

  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Receipts / Sales Orders</h2>

      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        {mode === "single"
          ? "Fill in the receipt on the left - the card on the right always shows exactly what will be saved."
          : "One delivery date and location for the whole sheet - add a customer column per order, fill in quantities, and Save creates every customer's receipt together, posted to Offline Delivery."}
      </p>

      <Toolbar>
        <div>
          <div style={{ display: "flex", flex: mode === "bulk" ? "0 0 auto" : "1 1 auto", minWidth: 0 }}>
            <SearchInput
              className={mode === "bulk" ? "ae-search-fixed" : undefined}
              value={query}
              onChange={setQuery}
              placeholder="Search customer, location, sales rep, or SKU…"
            />
          </div>

          {mode === "bulk" && (
            <>
              <DatePicker aria-label="Delivery date" value={bulkDate} onChange={setBulkDate} />
              <Select aria-label="Delivery location" value={bulkLocation} onChange={(e) => handleDestinationChange(e.target.value, "bulk")} required>
                <option value="" disabled>
                  Select destination…
                </option>
                {/* Same as the single form: a saved-in-draft destination that
                    isn't in the active list any more still renders as selected. */}
                {bulkLocation && !destinations.some((d) => d.name === bulkLocation) && <option value={bulkLocation}>{bulkLocation}</option>}
                {destinations.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
                <option value={ADD_DESTINATION_VALUE}>+ Add new destination…</option>
              </Select>
              <CategoryFilter categories={bulkCategories} value={bulkCategory} onChange={setBulkCategory} />
            </>
          )}

          {canBulk && (
            <Button type="button" variant="secondary" onClick={() => setMode(mode === "single" ? "bulk" : "single")}>
              {mode === "single" ? "Bulk Entry" : "Single Receipt"}
            </Button>
          )}
        </div>

        <ToolbarControls>
          {mode === "bulk" && (
            <>
              {/* Icon + .ae-toolbar-btn-label, same as Save on the entry pages.
                  --keep-label (index.css) makes it show "Save All" in the
                  full AND compact tiers and only shrink to a round icon in
                  the circle tier, when the toolbar genuinely has no room. */}
              <Button
                className="ae-toolbar-save ae-toolbar-save--keep-label"
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleBulkSave}
                disabled={bulkSaving}
                aria-label="Save all receipts"
                title="Save every customer's receipt"
              >
                <SaveIcon />
                <span className="ae-toolbar-btn-label">{bulkSaving ? "Saving…" : "Save All"}</span>
              </Button>
              <ToolbarDivider />
            </>
          )}
          <ZoomControl zoom={zoom} onChange={setZoom} />
          <Link to="/consolidated-receipts" className="ae-btn ae-btn-secondary" style={{ textDecoration: "none" }}>
            Consolidated Receipt
          </Link>
        </ToolbarControls>
      </Toolbar>

      {mode === "bulk" && error && <p style={{ color: colors.danger }}>{error}</p>}
      {mode === "bulk" && bulkSaved && (
        <p style={{ color: colors.ink, fontWeight: 600 }}>
          Saved {bulkSaved.count} receipt{bulkSaved.count === 1 ? "" : "s"} for {formatDateDisplay(bulkSaved.date)} -{" "}
          <Link to="/consolidated-receipts">view in Consolidated Receipt</Link>.
        </p>
      )}

      {mode === "bulk" && (
        <div style={{ marginBottom: 8 }}>
          <ConsolidatedReceiptEntryGrid
            products={products}
            customers={bulkCustomers}
            onRenameCustomer={renameBulkCustomer}
            onRemoveCustomer={removeBulkCustomer}
            onAddCustomer={addBulkCustomer}
            unitPrices={bulkUnitPrices}
            onUnitPriceChange={setBulkUnitPrice}
            quantities={bulkQuantities}
            onQuantityChange={setBulkQuantity}
            categoryFilter={bulkCategory}
          />
        </div>
      )}

      {/*
       * Everything below zooms together - single-mode entry form only
       * (the bulk grid above isn't part of this zoomable section).
       */}
      {mode === "single" && (
        <div style={zoomStyle(zoom)}>
          {/*
           * Entry form + live preview.
           */}
          <div
            className="ae-receipt-columns"
            style={{
              display: "flex",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: 28,
              overflow: "auto",
              padding: "0 4px 20px",
            }}
          >
            <form
              onSubmit={handleSubmit}
              style={{ marginTop: RECEIPT_COLUMN_TOP, flexShrink: 0 }}
            >
              <ReceiptPaper>
                <Divider />

                <FormRow label="Date">
                  <DatePicker aria-label="Order date" style={receiptInputStyle} value={orderDate} onChange={setOrderDate} />
                </FormRow>

                <FormRow label="Customer">
                  <input
                    className="ae-input ae-input-emphasis"
                    style={receiptInputStyle}
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    placeholder="Name"
                  />
                </FormRow>

                <FormRow label="Location">
                  <Select
                    style={receiptInputStyle}
                    value={location}
                    onChange={(e) => handleDestinationChange(e.target.value, "single")}
                    required
                  >
                    <option value="" disabled>
                      Select destination…
                    </option>

                    {/* A location that no longer matches any active destination
                        (retired since, or renamed) still needs to render as a
                        valid selected option - otherwise an old receipt would
                        silently fall back to the blank placeholder and look
                        like its location was lost. */}
                    {location && !destinations.some((d) => d.name === location) && (
                      <option value={location}>{location}</option>
                    )}

                    {destinations.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}

                    <option value={ADD_DESTINATION_VALUE}>+ Add new destination…</option>
                  </Select>
                </FormRow>

                <FormRow label="Sales Rep">
                  <input
                    className="ae-input ae-input-emphasis"
                    style={receiptInputStyle}
                    value={salesRepName}
                    onChange={(e) => setSalesRepName(e.target.value)}
                    placeholder="Name"
                  />
                </FormRow>

                <Divider />

                {items.map((item, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    {/* Smart SKU input: type to search by SKU, name or category. */}
                    <SkuCombobox
                      aria-label={`Item ${i + 1} SKU`}
                      products={products}
                      value={item.productId}
                      onChange={(productId) => updateItem(i, { productId })}
                      style={{ width: "100%", boxSizing: "border-box", fontSize: 11, padding: "4px 8px", marginBottom: 4 }}
                    />

                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="number"
                        className="ae-input"
                        placeholder="Qty"
                        aria-label="Quantity"
                        value={item.quantity}
                        onChange={(e) => updateItem(i, { quantity: e.target.value })}
                        style={{ width: 56, flexShrink: 0, fontSize: 11, padding: "4px 4px", textAlign: "right" }}
                      />

                      <input
                        type="number"
                        className="ae-input"
                        placeholder="₱/unit"
                        aria-label="Unit price"
                        value={item.unitPrice}
                        min={0}
                        step="0.01"
                        onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                        style={{ width: 70, flexShrink: 0, fontSize: 11, padding: "4px 4px", textAlign: "right" }}
                      />

                      <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 11, color: colors.subtleInk, whiteSpace: "nowrap" }}>
                        {formatPeso((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)) || "—"}
                      </span>

                      <button
                        type="button"
                        onClick={() => removeItemRow(i)}
                        disabled={items.length === 1}
                        aria-label="Remove item"
                        className="ae-tap-target"
                        style={removeButtonStyle}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addItemRow}
                  style={{ width: "100%", marginBottom: 4 }}
                >
                  + Add item
                </Button>

                <Divider dashed />

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10.5,
                    color: colors.subtleInk,
                    marginBottom: 4,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={postToFulfillment}
                    onChange={(e) => toggleFulfillment(e.target.checked)}
                  />
                  Post to Online Fulfillment (Out)
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10.5,
                    color: colors.subtleInk,
                    marginBottom: 10,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={postToOfflineDelivery}
                    onChange={(e) => toggleOfflineDelivery(e.target.checked)}
                  />
                  Post to Offline Delivery (Out)
                </label>

                {/*
                 * Online and Offline are separate stock pools (Section 2.1) -
                 * this receipt tallies against exactly one of them (or
                 * neither), never both, so the note makes that explicit
                 * instead of leaving it implicit in the two checkboxes.
                 */}
                {!postToFulfillment && !postToOfflineDelivery && (
                  <p style={{ fontSize: 10, color: colors.subtleInk, margin: "-6px 0 10px" }}>
                    Not posted to Online or Offline - this receipt won't tally against either entry.
                  </p>
                )}

                {error && (
                  <p style={{ color: colors.danger, fontSize: 11, marginBottom: 8 }}>
                    {error}
                  </p>
                )}

                <Button type="submit" disabled={submitting} style={{ width: "100%", color: colors.yellow }}>
                  {submitting ? "Saving…" : "Save Receipt"}
                </Button>
              </ReceiptPaper>
            </form>

            <div style={{ marginTop: RECEIPT_COLUMN_TOP, flexShrink: 0 }}>
              <ReceiptCard receipt={previewReceipt} isPreview />
            </div>
          </div>
        </div>
      )}

      {/*
       * Recent receipts - shared between both entry modes, since either one
       * creates the exact same kind of record.
       */}
      <div style={{ marginTop: 4 }}>
        <h3 style={{ margin: "0 0 12px" }}>Recent Receipts</h3>

        {!receipts ? (
          <TableSkeleton
            headers={["Receipt #", "Date", "Customer", "Location", "Sales Rep", "Items", "Total Qty"]}
            minWidth={720}
            rows={6}
            label="Loading receipts…"
          />
        ) : visibleReceipts?.length === 0 ? (
          <p style={{ color: colors.subtleInk }}>
            {receipts.length === 0
              ? "No receipts logged yet."
              : "No receipts match your search."}
          </p>
        ) : (
          <div
            className="table-scroll"
            style={{
              maxHeight: RECEIPT_LIST_MAX_HEIGHT,
              overflow: "auto",
              border: `1px solid ${colors.border}`,
              borderRadius: 0,
            }}
          >
            <table className="ae-table ae-table--left" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Location</th>
                  <th>Sales Rep</th>
                  <th style={{ textAlign: "center" }}>Items</th>
                  <th style={{ textAlign: "center" }}>Total Qty</th>
                </tr>
              </thead>

              <tbody>
                {visibleReceipts?.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedReceipt(r)}
                    style={{ cursor: "pointer" }}
                    title="Click to preview and print"
                  >
                    <td>#{String(r.id).padStart(6, "0")}</td>
                    <td>{formatDateDisplay(r.orderDate.slice(0, 10))}</td>
                    <td>{r.customer || "—"}</td>
                    <td>{r.location || "—"}</td>
                    <td>{r.salesRepName || "—"}</td>
                    <td style={{ textAlign: "center", color: "var(--ae-num-text)" }}>{r.items.length}</td>
                    <td style={{ textAlign: "center", color: "var(--ae-num-text)" }}>
                      {r.items.reduce((sum, it) => sum + Number(it.quantity), 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addDestinationFor && (
        <AddDestinationModal existing={destinations} onClose={() => setAddDestinationFor(null)} onCreated={handleDestinationCreated} />
      )}

      {/*
       * ========================================================
       * RECEIPT PREVIEW / PRINT MODAL
       * ========================================================
       */}
      {selectedReceipt && (
        <Modal
          title={`Receipt #${String(selectedReceipt.id).padStart(6, "0")}`}
          onClose={() => setSelectedReceipt(null)}
          width={RECEIPT_CARD_WIDTH + 96}
        >
          {/*
           * Shown at full/normal size, same as the entry form and live
           * preview - this is for the encoder to review comfortably. The
           * thermal-paper-sized version only exists in the downloaded PDF
           * (see utils/receiptPdf.ts's "PDF" button below), so it never
           * affects what's shown on screen here.
           */}
          <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
            <ReceiptCard receipt={selectedReceipt} />
          </div>

          {/*
           * These controls are hidden when printing.
           */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 8,
              marginTop: 16,
            }}
            className="no-print"
          >
            <Select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as ThermalPaperSize)}
              style={{ fontSize: 11, padding: "4px 6px", marginRight: "auto" }}
              aria-label="Thermal paper size"
            >
              {Object.entries(THERMAL_PAPER_SIZES).map(([key, size]) => (
                <option key={key} value={key}>
                  {size.label}
                </option>
              ))}
            </Select>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedReceipt(null)}
            >
              Close
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => selectedReceipt && void progress.track(() => generateReceiptPdf(selectedReceipt, paperSize))}
              title="Print or save as PDF"
            >
              <PrinterIcon /> PDF
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/*
 * Receipt form row.
 */
function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        marginBottom: 5,
      }}
    >
      <span style={{ color: colors.subtleInk, flexShrink: 0 }}>{label}</span>
      <div style={{ maxWidth: 320, flex: 1 }}>{children}</div>
    </div>
  );
}

/*
 * Receipt input styling.
 */
const receiptInputStyle: CSSProperties = {
  width: "100%",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: 13,
  textAlign: "right",
  padding: "4px 6px",
};

/*
 * Remove-item button styling.
 */
const removeButtonStyle: CSSProperties = {
  width: 20,
  height: 20,
  flexShrink: 0,
  border: `1px solid ${colors.goldDark}`,
  borderRadius: 4,
  background: "transparent",
  color: colors.danger,
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};