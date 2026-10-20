import type { Shift } from "@prisma/client";
import { changeLogRepository } from "../repositories/changeLogRepository";

/// The sheets that keep a version history, and the stock table behind each.
export const SHEET_TABLES = {
  online: "daily_online_stock",
  offline: "daily_offline_stock",
  manual: "manual_counts",
} as const;
export type SheetKind = keyof typeof SHEET_TABLES;

/// Edits by the same person closer together than this belong to one version,
/// the way Google Sheets folds a stretch of typing into a single entry.
const VERSION_GAP_MS = 10 * 60 * 1000;

type Row = Awaited<ReturnType<typeof changeLogRepository.findForSheet>>[number];

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/// Bookkeeping columns that are not part of what a sheet shows. delivery1..5
/// are the storage behind Delivery (Out)'s first five added columns, which the
/// snapshot also carries as deliveryOut__x1..5 - showing both would list every
/// Delivery amount twice under two different names.
const HIDDEN_FIELDS = new Set([
  "id",
  "productId",
  "entryDate",
  "shift",
  "createdAt",
  "updatedAt",
  "publishedById",
  "countedById",
  "location",
  "delivery1",
  "delivery2",
  "delivery3",
  "delivery4",
  "delivery5",
]);

export interface SheetVersion {
  /// Pass as `upTo` to see the sheet as it stood when this version ended.
  upTo: number;
  /// Pass as `after` to see what this version changed.
  after: number;
  startedAt: Date;
  endedAt: Date;
  user: { id: number; name: string } | null;
  changes: number;
  products: number;
}

/// Newest-first versions of one sheet, grouped from its change_log rows.
export async function listSheetVersions(kind: SheetKind, entryDate: string, shift: Shift): Promise<SheetVersion[]> {
  const rows = await changeLogRepository.findForSheet(SHEET_TABLES[kind], entryDate, shift);
  const versions: (SheetVersion & { recordIds: Set<number> })[] = [];
  let prevId = 0;
  for (const r of rows) {
    const last = versions[versions.length - 1];
    const sameUser = (last?.user?.id ?? null) === (r.changedBy?.id ?? null);
    if (last && sameUser && r.changedAt.getTime() - last.endedAt.getTime() <= VERSION_GAP_MS) {
      last.endedAt = r.changedAt;
      last.upTo = r.id;
      last.changes += 1;
      last.recordIds.add(r.recordId);
    } else {
      versions.push({
        upTo: r.id,
        after: prevId,
        startedAt: r.changedAt,
        endedAt: r.changedAt,
        user: r.changedBy,
        changes: 1,
        products: 0,
        recordIds: new Set([r.recordId]),
      });
    }
    prevId = r.id;
  }
  return versions.reverse().map(({ recordIds, ...v }) => ({ ...v, products: recordIds.size }));
}

export interface SheetVersionRow {
  recordId: number;
  productId: number | null;
  sku: string | null;
  name: string | null;
  values: Record<string, string | number | boolean | null>;
  /// Fields that differ from the sheet as it stood at `after`.
  changed: string[];
}

/// Replays the sheet's rows up to a change id: the latest snapshot of each
/// record wins, and a DELETE removes it.
function stateAt(rows: Row[], upTo: number) {
  const state = new Map<number, Record<string, unknown>>();
  for (const r of rows) {
    if (r.id > upTo) break;
    if (r.action === "DELETE") state.delete(r.recordId);
    else state.set(r.recordId, asObject(r.newValue));
  }
  return state;
}

/// The raw snapshots (one per record) of a sheet as it stood at change `upTo` -
/// what restoring a version replays. Null when `upTo` is not a change on this
/// sheet, so a stale or made-up id can never restore an empty sheet.
export async function getSheetStateAt(kind: SheetKind, entryDate: string, shift: Shift, upTo: number) {
  const rows = await changeLogRepository.findForSheet(SHEET_TABLES[kind], entryDate, shift);
  if (!rows.some((r) => r.id === upTo)) return null;
  return stateAt(rows, upTo);
}

/// The sheet as it stood at `upTo`, with the cells that differ from `after`
/// flagged - what a click on a version in the history panel shows.
export async function getSheetVersion(kind: SheetKind, entryDate: string, shift: Shift, upTo: number, after = 0) {
  const rows = await changeLogRepository.findForSheet(SHEET_TABLES[kind], entryDate, shift);
  const now = stateAt(rows, upTo);
  const before = stateAt(rows, after);

  const productIds = [...new Set([...now.values()].map((v) => v.productId).filter((p): p is number => typeof p === "number"))];
  const products = new Map((await changeLogRepository.findProductsByIds(productIds)).map((p) => [p.id, p]));

  const out: SheetVersionRow[] = [];
  for (const [recordId, snap] of now) {
    const prior = before.get(recordId);
    const values: SheetVersionRow["values"] = {};
    const changed: string[] = [];
    for (const [k, v] of Object.entries(snap)) {
      if (HIDDEN_FIELDS.has(k) || (v !== null && typeof v === "object")) continue;
      values[k] = v as SheetVersionRow["values"][string];
      if (!prior || prior[k] !== v) changed.push(k);
    }
    const product = typeof snap.productId === "number" ? products.get(snap.productId) : undefined;
    out.push({ recordId, productId: product?.id ?? null, sku: product?.sku ?? null, name: product?.name ?? null, values, changed });
  }
  out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return { upTo, after, rows: out };
}

export interface PublishEvent {
  publishedAt: string;
  /// The newest change id of the publish - open the sheet as published with it.
  upTo: number;
  user: { id: number; name: string } | null;
  counts: number;
  appliedToOpening: boolean;
}

/// Newest-first publishes of a Manual Count sheet. A publish stamps every
/// pending count with the same publishedAt, so rows that moved a count from
/// unpublished to that timestamp are one publish.
export async function listPublishHistory(entryDate: string, shift: Shift): Promise<PublishEvent[]> {
  const rows = await changeLogRepository.findForSheet(SHEET_TABLES.manual, entryDate, shift);
  const byStamp = new Map<string, PublishEvent>();
  for (const r of rows) {
    const next = asObject(r.newValue);
    const prev = asObject(r.oldValue);
    const stamp = typeof next.publishedAt === "string" ? next.publishedAt : null;
    if (!stamp || prev.publishedAt === stamp) continue;
    const e = byStamp.get(stamp);
    if (e) {
      e.counts += 1;
      e.upTo = r.id;
      e.appliedToOpening ||= next.appliedToOpening === true;
    } else {
      byStamp.set(stamp, { publishedAt: stamp, upTo: r.id, user: r.changedBy, counts: 1, appliedToOpening: next.appliedToOpening === true });
    }
  }
  return [...byStamp.values()].sort((a, b) => b.upTo - a.upTo);
}
