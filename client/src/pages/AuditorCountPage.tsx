import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listProducts } from "../api/products";
import { EDITED_BY_AUDITOR, type CountLocation } from "../api/countSubmissions";
import { AuditorHistoryModal } from "../components/AuditorHistoryModal";
import type { Product } from "../types";
import { useAuth } from "../context/AuthContext";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { PageHeader } from "../components/PageHeader";
import { BarButton, PageToolbar } from "../components/PageToolbar";
import { FilterSlot } from "../components/FilterSlot";
import { CategoryFilter } from "../components/CategoryFilter";
import { Dropdown } from "../components/Dropdown";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { TableSkeleton } from "../components/Skeleton";
import { Toast } from "../components/Toast";
import { SaveStatus } from "../components/SaveStatus";
import { HeaderCalculator } from "../components/Calculator";
import { Button } from "../components/ui";
import { CheckIcon, ChevronIcon, CollapseAllIcon, ExpandAllIcon, HistoryIcon, NoteIcon, PrinterIcon, SubmitIcon } from "../components/icons";
import { useCategoryReveal } from "../hooks/useCategoryReveal";
import { consumeQuickJump, requestQuickJump, subscribeQuickJump } from "../utils/quickJumpTarget";
import { useBusyAction } from "../hooks/useBusyAction";
import { useAuditorDraft } from "../hooks/useAuditorDraft";
import { EMPTY_LINE, QTY_PATTERN, countedAt, lineKey, parseQty, type Line } from "../utils/auditorDraft";
import { formatClock, formatDateDisplay, formatDateLong } from "../utils/dateFormat";
import { filterNotes, formatCount, pdfFileName, type PdfRow } from "../utils/pdfTables";
import { downloadTablePdf } from "../utils/tablePdf";
import { getCurrentShiftAndDate, isWholeDayMode, SHIFT_SHORT_LABELS, shiftWithWord } from "../utils/shift";
import type { Shift } from "../types";
import { colors } from "../theme";
import "../styles/auditor-count.css";

type RowFilter = "all" | "todo" | "done";

const LOCATIONS: CountLocation[] = ["ONLINE", "OFFLINE"];
const LOCATION_LABEL: Record<CountLocation, string> = { ONLINE: "Online", OFFLINE: "Offline" };
const MAX_NOTE = 500;
/// Same height the Total Stocks table uses: where a category bar's own sticky offset starts, so it
/// sits right under the header row.
const HEADER_ROW_HEIGHT = 26;

interface CountRowProps {
  product: Product;
  line: Line;
  collapsed: boolean;
  /// The category-reveal class (the same fade the other tables use when a category opens or closes).
  revealClass: string;
  /// Submitted: the sheet is locked until an admin sends it back.
  readOnly: boolean;
  onQty: (productId: number, qty: string) => void;
  onNote: (product: Product) => void;
  onFocusRow: (productId: number) => void;
  onBlurRow: () => void;
  onEnter: (input: HTMLInputElement) => void;
}

/// One product row. Memoised, and every prop is stable between keystrokes except the row's own
/// `line`, so typing in one box re-renders that row alone - not the 100+ others.
const CountRow = memo(function CountRow({ product, line, collapsed, revealClass, readOnly, onQty, onNote, onFocusRow, onBlurRow, onEnter }: CountRowProps) {
  const value = parseQty(line.qty);
  const invalid = line.qty !== "" && value === null;
  return (
    <tr id={`ae-ac-row-${product.id}`} className={(collapsed ? "ae-cat-row ae-row-collapsed" : "ae-cat-row") + revealClass}>
      <td className="ae-cell-sku">{product.sku ?? "—"}</td>
      <td className="ae-cell-name ae-ac-name">
        {product.name}
        <span className="ae-ac-sub">{product.unit}</span>
        {line.note && <span className="ae-ac-sub ae-ac-note">{line.note}</span>}
      </td>
      <td>
        <div className="ae-ac-count">
          <input
            // Same cell as the Online/Offline entry grids: a staged (typed, not yet sent) figure takes
            // their gold "edited" fill, an unusable one their invalid mark.
            className={`ae-input ae-input-cell ae-ac-input${value !== null ? " ae-input-cell--edited" : ""}${invalid ? " ae-input-cell--invalid" : ""}`}
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            placeholder="–"
            aria-label={`Count for ${product.name}`}
            aria-invalid={invalid || undefined}
            value={line.qty}
            readOnly={readOnly}
            onFocus={(e) => {
              e.currentTarget.select();
              onFocusRow(product.id);
            }}
            onBlur={onBlurRow}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (QTY_PATTERN.test(v)) onQty(product.id, v);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              onEnter(e.currentTarget);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ae-ac-btn"
            aria-pressed={line.qty === "0"}
            aria-label={line.qty === "0" ? `Clear the zero for ${product.name}` : `Count ${product.name} as zero`}
            title="Count as zero (none on the shelf)"
            disabled={readOnly}
            onClick={() => onQty(product.id, line.qty === "0" ? "" : "0")}
          >
            0
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`ae-ac-btn${line.note ? " ae-ac-btn--on" : ""}`}
            aria-label={line.note ? `Edit the note for ${product.name}` : `Add a note for ${product.name}`}
            title={line.note ? "Edit note" : "Add a note (damaged, found elsewhere...)"}
            disabled={readOnly && !line.note}
            onClick={() => onNote(product)}
          >
            <NoteIcon />
          </Button>
        </div>
      </td>
    </tr>
  );
});

/**
 * The auditor's count sheet - the blind physical count, done on a phone. It shows only what is
 * needed to find a product (SKU, name, unit) and a place to type what is on the shelf: no system
 * figure, no variance, no opening stock. Online and Offline are counted separately.
 *
 * Built from the same parts as Total Stocks and the Audit page (PageHeader + PageToolbar, the
 * shared table and category bars, the entry grids' cell styles, TableSkeleton, Toast), so it
 * follows every theme, the phone layout and the motion settings without styles of its own beyond
 * the count cell.
 *
 * The count is kept on this phone and on the server (hooks/useAuditorDraft.ts), where the admin's
 * Audit page reads it. Submit sends Online and Offline together - with a warning when one of them
 * has nothing counted - and locks the sheet until an admin sends it back.
 */
export function AuditorCountPage() {
  // The sheet being counted: the current shift and date, unless one is opened from "My counts". The
  // sheet below is remounted per sheet, so each one loads its own count (and backup) from scratch.
  const [current] = useState(() => getCurrentShiftAndDate());
  const [sheet, setSheet] = useState(current);
  return <AuditorCountSheet key={`${sheet.date}|${sheet.shift}`} sheet={sheet} isCurrent={sheet.date === current.date && sheet.shift === current.shift} onOpenSheet={(date, shift) => setSheet({ date, shift })} onBackToCurrent={() => setSheet(current)} />;
}

function AuditorCountSheet({ sheet, isCurrent, onOpenSheet, onBackToCurrent }: { sheet: { date: string; shift: Shift }; isCurrent: boolean; onOpenSheet: (date: string, shift: Shift) => void; onBackToCurrent: () => void }) {
  const { user } = useAuth();
  const realtimeVersion = useRealtimeVersion();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [location, setLocation] = useState<CountLocation>("ONLINE");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [category, setCategory] = useState("");
  // Categories start collapsed, like every other table; a search jump or "Next blank" opens one.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const reveal = useCategoryReveal();
  const [noteFor, setNoteFor] = useState<Product | null>(null);
  const [noteText, setNoteText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // The box being typed in. While a "Not counted" / "Counted" filter is on, that row is kept in view
  // until the cursor leaves it - otherwise typing the first digit would make the row vanish.
  const [held, setHeld] = useState<number | null>(null);
  const focusedId = useRef<number | null>(null);

  // The count: on this phone as a backup and on the server for the admin (see the hook). Submitted
  // means locked; a reopened count comes back editable with the admin's note.
  const { draft, edit, meta, readOnly, saveState, savedAt, pending, retry, submit, reopenForEdit } = useAuditorDraft(user?.id, sheet.date, sheet.shift, realtimeVersion);

  useEffect(() => {
    let cancelled = false;
    listProducts()
      .then((list) => !cancelled && setProducts(list.filter((p) => p.isActive)))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the product list"));
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // Read by the stable handlers below, so they never change identity (which would re-render every row).
  const locationRef = useRef(location);
  const rowFilterRef = useRef(rowFilter);
  const draftRef = useRef(draft);
  useEffect(() => {
    locationRef.current = location;
    rowFilterRef.current = rowFilter;
    draftRef.current = draft;
  });

  const categories = useMemo(() => [...new Set((products ?? []).map((p) => p.category))], [products]);
  const lineOf = (productId: number): Line => draft[lineKey(location, productId)] ?? EMPTY_LINE;
  const isCounted = (productId: number) => parseQty(lineOf(productId).qty) !== null;

  const setQty = useCallback((productId: number, qty: string) => edit(lineKey(locationRef.current, productId), { qty }), [edit]);
  const setNote = useCallback((productId: number, note: string) => edit(lineKey(locationRef.current, productId), { note }), [edit]);

  // Both locations are sent together, so Submit looks at both.
  const countedByLocation = { ONLINE: countedAt(draft, "ONLINE"), OFFLINE: countedAt(draft, "OFFLINE") };
  const countedBoth = countedByLocation.ONLINE + countedByLocation.OFFLINE;
  const emptyLocations = LOCATIONS.filter((l) => countedByLocation[l] === 0);
  const submitting = useBusyAction();

  const editing = useBusyAction();
  async function handleEdit() {
    try {
      await editing.run(reopenForEdit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen the count for editing");
    }
  }

  async function handleSubmit() {
    try {
      await submitting.run(() => submit(emptyLocations.length > 0));
      setConfirmOpen(false);
      setDone("Count submitted. The admin can see it now.");
    } catch (e) {
      setConfirmOpen(false);
      setError(e instanceof Error ? e.message : "Could not submit the count");
    }
  }

  const total = products?.length ?? 0;
  const counted = (products ?? []).filter((p) => isCounted(p.id)).length;
  const todo = total - counted;
  const percent = total === 0 ? 0 : Math.round((counted / total) * 100);

  const visible = useMemo(
    () =>
      (products ?? []).filter((p) => {
        if (category && p.category !== category) return false;
        if (rowFilter === "all" || p.id === held) return true;
        const done = parseQty(draft[lineKey(location, p.id)]?.qty ?? "") !== null;
        return rowFilter === "done" ? done : !done;
      }),
    [products, category, rowFilter, draft, location, held],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of visible) {
      const list = map.get(p.category);
      if (list) list.push(p);
      else map.set(p.category, [p]);
    }
    return [...map.entries()];
  }, [visible]);
  // "3/12" on each category bar: counted / products, regardless of the filters.
  const perCategory = useMemo(() => {
    const out = new Map<string, { done: number; all: number }>();
    for (const p of products ?? []) {
      const c = out.get(p.category) ?? { done: 0, all: 0 };
      c.all++;
      if (parseQty(draft[lineKey(location, p.id)]?.qty ?? "") !== null) c.done++;
      out.set(p.category, c);
    }
    return out;
  }, [products, draft, location]);

  const allExpanded = groups.length > 0 && groups.every(([c]) => expanded[c]);

  /// Opens the category (so the row is on screen), then scrolls to the row and puts the cursor in its box.
  const revealProduct = useCallback((product: Product) => {
    setExpanded((e) => (e[product.category] ? e : { ...e, [product.category]: true }));
    window.setTimeout(() => {
      const row = document.getElementById(`ae-ac-row-${product.id}`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }, 120);
  }, []);

  // The header search (Ctrl+K / the magnifier) picks a product, and so does "Next blank" below.
  useEffect(() => {
    if (!products) return;
    function tryJump() {
      const id = consumeQuickJump((pid) => (products ?? []).some((p) => p.id === pid));
      const product = id === null ? undefined : (products ?? []).find((p) => p.id === id);
      if (!product) return;
      setRowFilter("all");
      setCategory("");
      revealProduct(product);
    }
    tryJump();
    return subscribeQuickJump(tryJump);
  }, [products, revealProduct]);

  /// Reloads the product list (and clears an earlier failure so the table shows its loading state again).
  function reload() {
    setError(null);
    setRefreshTick((t) => t + 1);
  }

  const blank = useMemo(() => visible.filter((p) => parseQty(draft[lineKey(location, p.id)]?.qty ?? "") === null), [visible, draft, location]);
  function nextBlank() {
    if (blank.length === 0) return;
    const at = focusedId.current === null ? -1 : visible.findIndex((p) => p.id === focusedId.current);
    const after = at < 0 ? blank[0] : (visible.slice(at + 1).find((p) => blank.includes(p)) ?? blank[0]);
    requestQuickJump(after.id);
  }

  const onFocusRow = useCallback((id: number) => {
    focusedId.current = id;
    if (rowFilterRef.current !== "all") setHeld(id);
  }, []);
  const onBlurRow = useCallback(() => setHeld(null), []);
  const tableRef = useRef<HTMLTableElement>(null);
  /// Enter on the keypad moves to the next count box, so a shelf can be counted without touching the list.
  const onEnter = useCallback((from: HTMLInputElement) => {
    const inputs = [...(tableRef.current?.querySelectorAll<HTMLInputElement>("tr:not(.ae-row-collapsed) input.ae-ac-input") ?? [])];
    inputs[inputs.indexOf(from) + 1]?.focus();
  }, []);
  const openNote = useCallback((p: Product) => {
    setNoteFor(p);
    // Read from the ref the draft is mirrored into: this callback is stable, so a `draft` closed over
    // here would be the one from the first render.
    setNoteText(draftRef.current[lineKey(locationRef.current, p.id)]?.note ?? "");
  }, []);

  /// The sheet as filtered on screen: SKU, product, unit, what was counted ("-" where nothing is
  /// typed yet, 0 where zero was) and any note. No system figure - this is the blind sheet. Kept out
  /// of the Google Drive exports folder (driveCopy): that upload is an admin endpoint.
  const pdf = useBusyAction();
  async function handlePdf() {
    const rows: PdfRow[] = [];
    for (const [cat, list] of groups) {
      rows.push({ kind: "group", cells: [cat] });
      for (const p of list) {
        const line = draft[lineKey(location, p.id)] ?? EMPTY_LINE;
        const value = parseQty(line.qty);
        rows.push({ kind: "data", cells: [p.sku ?? "—", p.name, p.unit, value === null ? "—" : formatCount(value), line.note] });
      }
    }
    try {
      await downloadTablePdf({
        filename: pdfFileName("count-sheet", location, sheet.date, wholeDay ? null : sheet.shift),
        title: `Count Sheet - ${LOCATION_LABEL[location]}`,
        subtitle: `${formatDateDisplay(sheet.date)}${wholeDay ? "" : ` - ${shiftWithWord(sheet.shift)}`}`,
        notes: [`${counted} of ${total} counted`, ...filterNotes({ category }), ...(rowFilter === "all" ? [] : [`Showing: ${rowFilter === "todo" ? "not counted" : "counted"} only`])],
        sections: [{ columns: [{ header: "SKU" }, { header: "Product" }, { header: "Unit" }, { header: "Count", align: "right" }, { header: "Note" }], rows, emptyMessage: "Nothing to show." }],
        driveCopy: false,
      });
    } catch (e) {
      setError(e instanceof Error ? `Could not make the PDF: ${e.message}` : "Could not make the PDF");
    }
  }

  function setAllExpanded(on: boolean) {
    setExpanded(Object.fromEntries(categories.map((c) => [c, on])));
  }

  const wholeDay = isWholeDayMode();
  const notesFor = noteFor ? lineOf(noteFor.id).note : "";

  return (
    <div className="ae-ac-page">
      <PageHeader
        title={`Count - ${formatDateLong(sheet.date)}${wholeDay ? "" : ` - ${SHIFT_SHORT_LABELS[sheet.shift]}`}`}
        badges={
          // Submit sits beside the title, where the other pages show their status chip. It sends
          // Online and Offline together. Unavailable (not just greyed) until something is counted,
          // and once the count is sent it reads "Submitted" until an admin sends it back.
          <Button
            type="button"
            size="sm"
            className="ae-ac-submit"
            aria-disabled={readOnly || countedBoth === 0 || undefined}
            title={readOnly ? "Already submitted - an admin can send it back for a recount" : countedBoth === 0 ? "Count at least one product first" : "Send this count (Online and Offline together)"}
            onClick={() => !readOnly && countedBoth > 0 && setConfirmOpen(true)}
          >
            {readOnly ? <CheckIcon /> : <SubmitIcon />}
            {readOnly ? "Submitted" : "Submit"}
          </Button>
        }
      >
        <PageToolbar
          label="Count"
          activeFilters={(category !== "" ? 1 : 0) + (rowFilter !== "all" ? 1 : 0)}
          onClearFilters={() => {
            setCategory("");
            setRowFilter("all");
          }}
          filters={
            <>
              <Dropdown
                aria-label="Where you are counting"
                value={location}
                onChange={(v) => setLocation(v as CountLocation)}
                options={[
                  { value: "ONLINE", label: "Online" },
                  { value: "OFFLINE", label: "Offline" },
                ]}
              />
              <FilterSlot active={rowFilter !== "all"} label="Rows">
                <Dropdown
                  aria-label="Filter rows"
                  value={rowFilter}
                  onChange={(v) => setRowFilter(v as RowFilter)}
                  options={[
                    { value: "all", label: "All rows", shortLabel: "All" },
                    { value: "todo", label: `Not counted (${todo})`, shortLabel: "Not counted" },
                    { value: "done", label: `Counted (${counted})`, shortLabel: "Counted" },
                  ]}
                />
              </FilterSlot>
              <FilterSlot active={category !== ""} label="Category">
                <CategoryFilter categories={categories} value={category} onChange={setCategory} />
              </FilterSlot>
              {/* Quick sums while counting (3 boxes x 12 + 5). It never touches the sheet. */}
              <HeaderCalculator allowOnPhone />
            </>
          }
          // No menus on this page: a menu makes the toolbar add its "..." overflow button, and there is
          // nothing here to put in one. Both actions are plain buttons (icon only on a phone).
          actions={
            <>
              {/* Opens every category; once they are all open it closes them again. (Not "collapse as soon as
                  one is open", as the other tables do: with one category open that would make opening the
                  rest a collapse-then-expand.) */}
              <BarButton
                label={allExpanded ? "Collapse all categories" : "Expand all categories"}
                icon={allExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />}
                title={allExpanded ? "Close every category" : "Open every category"}
                disabledReason={!products ? "The product list is still loading" : groups.length === 0 ? "No categories to show" : undefined}
                onClick={() => setAllExpanded(!allExpanded)}
              />
              <BarButton label="History" icon={<HistoryIcon />} title="Your recent counts" onClick={() => setHistoryOpen(true)} />
              <BarButton
                label="PDF"
                icon={<PrinterIcon />}
                title="Save this sheet as a PDF (what is on screen, with the counts typed so far)"
                disabledReason={!products ? "The product list is still loading" : pdf.busy ? "Building the PDF…" : visible.length === 0 ? "Nothing to export with these filters" : undefined}
                onClick={() => void pdf.run(handlePdf)}
              />
            </>
          }
        />
      </PageHeader>

      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
      <Toast message={done} onDismiss={() => setDone(null)} variant="success" />

      {!isCurrent && (
        <p className="ae-ac-banner ae-ac-banner--attention" role="status">
          This is an earlier sheet, not today&apos;s.
          <button type="button" className="ae-rv-who ae-rv-who--btn ae-ac-banner-action" onClick={onBackToCurrent}>
            Back to today
          </button>
        </p>
      )}
      {readOnly && meta.submittedAt && (
        <p className="ae-ac-banner" role="status">
          Submitted at {formatClock(Date.parse(meta.submittedAt))}. The admin has your count. You can still edit it until they publish it.
          <Button type="button" size="sm" variant="secondary" className="ae-ac-banner-action" loading={editing.busy} loadingLabel="Opening…" onClick={() => void handleEdit()}>
            Edit
          </Button>
        </p>
      )}
      {!readOnly && meta.reopenedAt && (
        <p className="ae-ac-banner ae-ac-banner--attention" role="status">
          {meta.reopenReason === EDITED_BY_AUDITOR
            ? "You are editing your submitted count. Change what needs it, then submit again."
            : `The admin sent this count back for a recount${meta.reopenReason ? `: ${meta.reopenReason}` : ""}. Change what needs it, then submit again.`}
        </p>
      )}

      {total > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 6px", padding: "0 2px", fontSize: "calc(12px * var(--ae-fs, 1))", color: colors.subtleInk }}
        >
          <span>
            <span style={{ color: colors.ink, fontWeight: 600 }}>{counted}</span> / {total} counted · {LOCATION_LABEL[location]}
            {todo === 0 ? " · all done" : ` · ${todo} left`}
          </span>
          <span aria-hidden="true" style={{ flex: "1 1 80px", maxWidth: 160, height: 2, borderRadius: 1, background: colors.border, overflow: "hidden" }}>
            <span style={{ display: "block", width: `${percent}%`, height: "100%", background: colors.green, transition: "width 160ms ease-out" }} />
          </span>
          {!readOnly && <SaveStatus state={saveState} savedAt={savedAt} onRetry={() => void retry()} />}
          {!readOnly && pending > 0 && saveState === "idle" && <span>Not sent yet</span>}
          {todo > 0 && !readOnly && (
            <Button type="button" variant="ghost" size="sm" onClick={nextBlank} disabled={blank.length === 0} title={blank.length === 0 ? "The products left are hidden by a filter" : "Jump to the next product not counted yet"}>
              Next blank
            </Button>
          )}
        </div>
      )}

      {!products ? (
        error ? (
          <div style={{ display: "grid", justifyItems: "start", gap: 10, padding: "8px 2px" }}>
            <span style={{ color: colors.subtleInk, fontSize: "calc(13px * var(--ae-fs, 1))" }}>The product list could not be loaded.</span>
            <Button onClick={reload}>Try again</Button>
          </div>
        ) : (
          <TableSkeleton headers={["SKU", "Product", "Count"]} minWidth={320} label="Loading products…" />
        )
      ) : (
        <div className="ae-grid-fill">
          <RowGlowScroll focusStorageKey={`ala-eh-focus:auditor-count:${sheet.date}:${sheet.shift}`}>
            <table ref={tableRef} className="ae-table ae-table--center-head ae-table--compact ae-table--fit ae-ac-table">
              <thead>
                <tr>
                  <th className="ae-col-id">SKU</th>
                  <th className="ae-col-id">Product</th>
                  <th>{LOCATION_LABEL[location]} Count</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([cat, rows]) => {
                  const isCollapsed = !expanded[cat];
                  const c = perCategory.get(cat) ?? { done: 0, all: rows.length };
                  return (
                    <Fragment key={cat}>
                      <tr>
                        <td colSpan={3} style={{ padding: 0, position: "sticky", top: HEADER_ROW_HEIGHT, zIndex: 2 }}>
                          <button
                            type="button"
                            // Blue once anything in it is counted (the same "edited" bar as the entry grids), open or collapsed.
                            className={`ae-cat-toggle${c.done > 0 ? " ae-cat-toggle--edited" : ""}`}
                            aria-expanded={!isCollapsed}
                            title={`${isCollapsed ? "Expand" : "Collapse"} ${cat}${c.done > 0 ? ` (${c.done} counted)` : ""}`}
                            onClick={() => reveal.toggle(cat, !isCollapsed, true, () => setExpanded((e) => ({ ...e, [cat]: isCollapsed })))}
                          >
                            <span className="ae-cat-label">
                              <span
                                style={{
                                  display: "inline-flex",
                                  transform: isCollapsed || reveal.closing(cat) ? "rotate(-90deg)" : "none",
                                  transition: "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)",
                                }}
                              >
                                <ChevronIcon />
                              </span>
                              {cat}
                            </span>
                            <span className="ae-ac-cat-count" aria-label={`${c.done} of ${c.all} counted`}>
                              {c.done}/{c.all}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {rows.map((p) => (
                        <CountRow
                          key={p.id}
                          product={p}
                          line={draft[lineKey(location, p.id)] ?? EMPTY_LINE}
                          collapsed={isCollapsed}
                          revealClass={reveal.rowClass(cat)}
                          readOnly={readOnly}
                          onQty={setQty}
                          onNote={openNote}
                          onFocusRow={onFocusRow}
                          onBlurRow={onBlurRow}
                          onEnter={onEnter}
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {groups.length === 0 && (
              <p style={{ margin: 0, padding: "24px 12px", textAlign: "center", color: colors.subtleInk, fontSize: "calc(13px * var(--ae-fs, 1))" }}>
                {total === 0 ? "No products to count." : rowFilter === "todo" ? "Everything here is counted." : "Nothing matches these filters."}
              </p>
            )}
          </RowGlowScroll>
        </div>
      )}

      {noteFor && (
        <Modal title={`Note - ${noteFor.name}`} width={400} onClose={() => setNoteFor(null)}>
          <form
            style={{ display: "grid", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              setNote(noteFor.id, noteText.trim());
              setNoteFor(null);
            }}
          >
            <textarea
              className="ae-input ae-ac-note-field"
              autoFocus
              maxLength={MAX_NOTE}
              placeholder="Damaged, found in another aisle, label missing..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {notesFor && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setNote(noteFor.id, "");
                    setNoteFor(null);
                  }}
                >
                  Remove note
                </Button>
              )}
              <Button type="submit">Save note</Button>
            </div>
          </form>
        </Modal>
      )}

      {historyOpen && (
        <AuditorHistoryModal
          currentDate={sheet.date}
          currentShift={sheet.shift}
          onClose={() => setHistoryOpen(false)}
          onOpen={(date, shift) => {
            setHistoryOpen(false);
            if (date !== sheet.date || shift !== sheet.shift) onOpenSheet(date, shift);
          }}
        />
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Submit this count?"
          confirmLabel={emptyLocations.length > 0 ? "Submit anyway" : "Submit"}
          busy={submitting.busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void handleSubmit()}
        >
          <p style={{ margin: "0 0 8px" }}>Online and Offline are sent together.</p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {LOCATIONS.map((l) => (
              <li key={l}>
                {LOCATION_LABEL[l]}: {countedByLocation[l]} of {total} counted
              </li>
            ))}
          </ul>
          {emptyLocations.length > 0 && (
            <p style={{ margin: "0 0 8px", color: colors.warningText, fontWeight: 600 }}>
              {emptyLocations.map((l) => LOCATION_LABEL[l]).join(" and ")} has nothing counted. If that is right, submit anyway; otherwise go back and count it first.
            </p>
          )}
          <p style={{ margin: 0 }}>Products you left empty are recorded as not counted, not as zero.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
