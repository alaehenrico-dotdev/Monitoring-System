import { useCallback, useEffect, useState } from "react";
import {
  cancelPendingRelease,
  createPendingRelease,
  listPendingReleases,
  releasePendingRelease,
  updatePendingRelease,
  type PendingRelease,
  type ReleaseLocation,
  type ReleaseStatus,
} from "../api/pendingReleases";
import { listProducts } from "../api/products";
import type { Product, Shift } from "../types";
import { useAuth } from "../context/AuthContext";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { PageHeader } from "../components/PageHeader";
import { Button, Field, Select, TextInput } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Modal } from "../components/Modal";
import { Pager } from "../components/Pager";
import { Toast } from "../components/Toast";
import { InlineLoading } from "../components/Spinner";
import { usePagedList } from "../hooks/usePagedList";
import { formatDateDisplay } from "../utils/dateFormat";
import { getCurrentShiftAndDate, SHIFT_LABELS } from "../utils/shift";
import { colors } from "../theme";

const FILTERS: { key: ReleaseStatus | "ALL"; label: string }[] = [
  { key: "AWAITING", label: "Awaiting" },
  { key: "RELEASED", label: "Released" },
  { key: "CANCELLED", label: "Written off" },
  { key: "ALL", label: "All" },
];

const TONE: Record<ReleaseStatus, string> = { AWAITING: "progress", RELEASED: "done", CANCELLED: "idle" };
const STATUS_LABEL: Record<ReleaseStatus, string> = { AWAITING: "awaiting", RELEASED: "released", CANCELLED: "written off" };
const PAGE_LABEL: Record<ReleaseLocation, string> = { ONLINE: "Online", OFFLINE: "Offline" };

/// Goods waiting longer than this are worth chasing.
const STALE_AFTER_DAYS = 3;

const qty = (v: string) => String(Number(v));

type Dialog =
  | { kind: "add" }
  | { kind: "release"; item: PendingRelease }
  | { kind: "edit"; item: PendingRelease }
  | { kind: "cancel"; item: PendingRelease };

/**
 * Awaiting release: finished goods that exist but cannot be sold yet - no label,
 * no sticker. They are not stock, so they stay out of the night's entries and
 * counts (a finishing day is never held up by a few unlabeled items) and are
 * listed here so they cannot be forgotten. Releasing one adds it to Production
 * (In) on the CURRENT shift - never an earlier one - so no finished day changes.
 */
export function AwaitingReleasePage() {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === "SUPERVISOR_ADMIN";
  // Encoders record and edit items on either page; releasing and writing off are the admin's approval.

  const [status, setStatus] = useState<ReleaseStatus | "ALL">("AWAITING");
  const [location, setLocation] = useState<ReleaseLocation | "ALL">("ALL");
  const fetchPage = useCallback(
    (offset: number, limit: number) =>
      listPendingReleases({ status: status === "ALL" ? undefined : status, location: location === "ALL" ? undefined : location }, offset, limit),
    [status, location],
  );
  const pager = usePagedList(fetchPage, 20);
  const rows = pager.data?.items ?? null;

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realtimeVersion = useRealtimeVersion();

  const { reload } = pager;
  useEffect(() => {
    if (realtimeVersion > 0) reload();
  }, [realtimeVersion, reload]);

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    pager.reload();
  }

  return (
    <div>
      <PageHeader
        title="Awaiting release"
        subtitle="Finished goods that can't be sold yet (no label, no sticker). They are not stock until released."
      />
      <div style={{ width: "100%", maxWidth: 1280, margin: "0 auto" }}>
        <p style={{ fontSize: "calc(13px * var(--ae-fs, 1))", lineHeight: 1.55, color: colors.subtleInk, margin: "0 0 10px" }}>
          Leave these out of the night's entries and count, and record them here instead - the day can finish without them. When they're labeled, the admin releases them:
          the quantity is added to Production (In) on the shift they become sellable, so nothing already reported changes.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <div className="ae-subtabs" role="tablist" aria-label="Status" style={{ margin: 0 }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={f.key === status} className="ae-subtab" onClick={() => setStatus(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <Select aria-label="Page" value={location} onChange={(e) => setLocation(e.target.value as ReleaseLocation | "ALL")} style={{ width: "auto" }}>
            <option value="ALL">Online &amp; Offline</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
          </Select>
          <Button size="sm" onClick={() => setDialog({ kind: "add" })}>
            Add item
          </Button>
        </div>

        {!rows ? (
          pager.error ? (
            <p role="alert" style={{ color: colors.danger }}>
              {pager.error}
            </p>
          ) : (
            <InlineLoading label="Loading…" />
          )
        ) : rows.length === 0 ? (
          <p style={{ color: colors.subtleInk }}>
            {status === "AWAITING" ? "Nothing is waiting for release." : "Nothing here."}
          </p>
        ) : (
          <div className="ae-panel">
            {rows.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onRelease={() => setDialog({ kind: "release", item })}
                onEdit={() => setDialog({ kind: "edit", item })}
                onCancel={() => setDialog({ kind: "cancel", item })}
              />
            ))}
          </div>
        )}
        <Pager
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          onPage={pager.goToPage}
          onPageSize={pager.setPageSize}
          loading={pager.loading}
          label="Awaiting release pages"
        />
      </div>

      {dialog?.kind === "add" && <AddDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "release" && <ReleaseDialog item={dialog.item} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "edit" && <EditDialog item={dialog.item} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "cancel" && <CancelDialog item={dialog.item} onClose={() => setDialog(null)} onDone={done} />}

      <Toast message={notice} onDismiss={() => setNotice(null)} variant="success" duration={6000} />
      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />
    </div>
  );
}

function ItemRow({
  item,
  isAdmin,
  onRelease,
  onEdit,
  onCancel,
}: {
  item: PendingRelease;
  isAdmin: boolean;
  onRelease: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const awaiting = item.status === "AWAITING";
  const stale = awaiting && item.ageDays >= STALE_AFTER_DAYS;
  return (
    <div style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.border}`, fontSize: "calc(13px * var(--ae-fs, 1))", color: colors.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={`ae-dash-chip ae-dash-chip--${TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
        <strong>
          {item.product.name}
          {item.product.sku ? ` (${item.product.sku})` : ""}
        </strong>
        <span>
          <strong>{qty(item.quantity)}</strong> {item.product.unit}
        </span>
        <span style={{ color: colors.subtleInk }}>{PAGE_LABEL[item.location]}</span>
        <span style={{ flex: 1 }} />
        {awaiting && (
          <>
            {isAdmin && (
              <Button className="ae-btn-solid" size="sm" onClick={onRelease}>
                Release…
              </Button>
            )}
            <Button className="ae-btn-solid" size="sm" onClick={onEdit}>
              Edit
            </Button>
          </>
        )}
        {awaiting && isAdmin && (
          <Button className="ae-btn-solid" size="sm" onClick={onCancel}>
            Write off…
          </Button>
        )}
      </div>
      <div style={{ color: colors.subtleInk, marginTop: 4 }}>
        Made {formatDateDisplay(item.madeDate)} · {SHIFT_LABELS[item.madeShift]}
        {awaiting && (
          <span style={{ color: stale ? colors.warningText : undefined, fontWeight: stale ? 600 : undefined }}>
            {" "}
            · waiting {item.ageDays === 0 ? "since today" : `${item.ageDays} day${item.ageDays === 1 ? "" : "s"}`}
          </span>
        )}
        {" "}· {item.reason}
        {item.createdBy ? ` · added by ${item.createdBy.name}` : ""}
      </div>
      {item.status === "RELEASED" && item.releasedEntryDate && item.releasedShift && (
        <div style={{ color: colors.subtleInk, marginTop: 2 }}>
          Released into {formatDateDisplay(item.releasedEntryDate)} · {SHIFT_LABELS[item.releasedShift]}
          {item.releasedBy ? ` by ${item.releasedBy.name}` : ""}
          {item.resolutionNote ? ` - ${item.resolutionNote}` : ""}
        </div>
      )}
      {item.status === "CANCELLED" && (
        <div style={{ color: colors.subtleInk, marginTop: 2 }}>
          Written off{item.releasedBy ? ` by ${item.releasedBy.name}` : ""}
          {item.resolutionNote ? ` - ${item.resolutionNote}` : ""}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- dialogs */

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

function DialogButtons({
  onClose,
  onConfirm,
  confirmLabel,
  busyLabel,
  busy,
  disabled,
}: {
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button variant="primary" onClick={onConfirm} disabled={disabled} loading={busy} loadingLabel={busyLabel}>
        {confirmLabel}
      </Button>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" style={{ color: colors.danger, fontSize: "calc(13px * var(--ae-fs, 1))", margin: "12px 0 0" }}>
      {message}
    </p>
  ) : null;
}

function AddDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const now = getCurrentShiftAndDate();
  const [location, setLocation] = useState<ReleaseLocation>("OFFLINE");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [madeDate, setMadeDate] = useState(now.date);
  const [madeShift, setMadeShift] = useState<Shift>(now.shift);
  const [reason, setReason] = useState("No label yet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listProducts()
      .then((p) => current && setProducts(p))
      .catch((e) => current && setError(errorText(e, "Couldn't load the products")));
    return () => {
      current = false;
    };
  }, []);

  const amount = Number(quantity);
  const valid = productId !== "" && amount > 0 && reason.trim().length >= 3;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await createPendingRelease({ location, productId: Number(productId), quantity: amount, madeDate, madeShift, reason: reason.trim() });
      onDone("Added to awaiting release. It is not part of any stock until released.");
    } catch (e) {
      setError(errorText(e, "Couldn't add that"));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add an item awaiting release" onClose={busy ? () => {} : onClose} width={480}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Page">
          <Select value={location} onChange={(e) => setLocation(e.target.value as ReleaseLocation)}>
            <option value="OFFLINE">Offline</option>
            <option value="ONLINE">Online</option>
          </Select>
        </Field>
        <Field label="Product">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!products}>
            <option value="">{products ? "Choose a product…" : "Loading…"}</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.sku ? ` (${p.sku})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity">
          <TextInput type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" />
        </Field>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Field label="Made on">
            <DatePicker value={madeDate} onChange={setMadeDate} todayValue={now.date} aria-label="Made on" />
          </Field>
          <Field label="Shift">
            <Select value={madeShift} onChange={(e) => setMadeShift(e.target.value as Shift)} aria-label="Shift">
              <option value="MORNING">{SHIFT_LABELS.MORNING}</option>
              <option value="NIGHT">{SHIFT_LABELS.NIGHT}</option>
            </Select>
          </Field>
        </div>
        <Field label="Why can't it be sold yet?">
          <TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        </Field>
      </div>
      <FormError message={error} />
      <DialogButtons onClose={onClose} onConfirm={() => void save()} confirmLabel="Add" busyLabel="Adding…" busy={busy} disabled={!valid} />
    </Modal>
  );
}

function ReleaseDialog({ item, onClose, onDone }: { item: PendingRelease; onClose: () => void; onDone: (message: string) => void }) {
  const now = getCurrentShiftAndDate();
  const [date, setDate] = useState(now.date);
  const [shift, setShift] = useState<Shift>(now.shift);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release() {
    setBusy(true);
    setError(null);
    try {
      await releasePendingRelease(item.id, date, shift, note.trim() || undefined);
      onDone(`Released ${qty(item.quantity)} ${item.product.unit} of ${item.product.name} into ${PAGE_LABEL[item.location]} Production (In).`);
    } catch (e) {
      setError(errorText(e, "Couldn't release that"));
      setBusy(false);
    }
  }

  return (
    <Modal title="Release into stock" onClose={busy ? () => {} : onClose} width={460}>
      <p style={{ fontSize: "calc(13.5px * var(--ae-fs, 1))", lineHeight: 1.55, margin: "0 0 12px" }}>
        Adds <strong>{qty(item.quantity)}</strong> {item.product.unit} of <strong>{item.product.name}</strong> to {PAGE_LABEL[item.location]} Production (In) for the shift below. It
        counts as stock from that shift on. It can only go into the current shift: a day that was already reported is never changed.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <Field label="Date">
          <DatePicker value={date} onChange={setDate} todayValue={now.date} aria-label="Release date" />
        </Field>
        <Field label="Shift">
          <Select value={shift} onChange={(e) => setShift(e.target.value as Shift)} aria-label="Release shift">
            <option value="MORNING">{SHIFT_LABELS.MORNING}</option>
            <option value="NIGHT">{SHIFT_LABELS.NIGHT}</option>
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)">
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      </Field>
      <FormError message={error} />
      <DialogButtons onClose={onClose} onConfirm={() => void release()} confirmLabel="Release" busyLabel="Releasing…" busy={busy} />
    </Modal>
  );
}

function EditDialog({ item, onClose, onDone }: { item: PendingRelease; onClose: () => void; onDone: (message: string) => void }) {
  const [quantity, setQuantity] = useState(qty(item.quantity));
  const [reason, setReason] = useState(item.reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(quantity);
  const changed = amount !== Number(item.quantity) || reason.trim() !== item.reason;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updatePendingRelease(item.id, {
        ...(amount !== Number(item.quantity) ? { quantity: amount } : {}),
        ...(reason.trim() !== item.reason ? { reason: reason.trim() } : {}),
      });
      onDone("Updated.");
    } catch (e) {
      setError(errorText(e, "Couldn't update that"));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit · ${item.product.name}`} onClose={busy ? () => {} : onClose} width={440}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Quantity">
          <TextInput type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" />
        </Field>
        <Field label="Why can't it be sold yet?">
          <TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        </Field>
      </div>
      <FormError message={error} />
      <DialogButtons onClose={onClose} onConfirm={() => void save()} confirmLabel="Save" busyLabel="Saving…" busy={busy} disabled={!changed || !(amount > 0) || reason.trim().length < 3} />
    </Modal>
  );
}

function CancelDialog({ item, onClose, onDone }: { item: PendingRelease; onClose: () => void; onDone: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function writeOff() {
    setBusy(true);
    setError(null);
    try {
      await cancelPendingRelease(item.id, note.trim());
      onDone("Written off.");
    } catch (e) {
      setError(errorText(e, "Couldn't write that off"));
      setBusy(false);
    }
  }

  return (
    <Modal title="Write off" onClose={busy ? () => {} : onClose} width={440}>
      <p style={{ fontSize: "calc(13.5px * var(--ae-fs, 1))", lineHeight: 1.55, margin: "0 0 12px" }}>
        {qty(item.quantity)} {item.product.unit} of <strong>{item.product.name}</strong> will never be released into stock (spoiled, never finished, merged elsewhere). It stays in the history with
        your reason.
      </p>
      <Field label="Reason">
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Reason for writing off" />
      </Field>
      <FormError message={error} />
      <DialogButtons onClose={onClose} onConfirm={() => void writeOff()} confirmLabel="Write off" busyLabel="Writing off…" busy={busy} disabled={note.trim().length < 3} />
    </Modal>
  );
}
