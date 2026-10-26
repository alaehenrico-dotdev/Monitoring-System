import { CorrectionStatus } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { toNum } from "../utils/stockMath";
import type { Shift } from "@prisma/client";
import { recordChange } from "./changeLog.service";
import { isCounterpartLocked, type EntryLocation } from "./dayLock.service";
import { totalsFromExtras, type StockExtraInput } from "../utils/stockExtras";

/**
 * Online and Offline are finished separately, but a transfer is one real-world
 * event that lives on both pages: Online's Stocks In/Out are mirrored onto
 * Offline's and the other way round. So once the OTHER page of a shift is
 * finished, changing a transfer figure on this one would quietly rewrite a
 * locked page. Such a change is not applied; it becomes a pending request in the
 * admin's Corrections queue, and applies to both pages if an admin approves it.
 * Every other figure on the same save goes through as usual.
 */

export const CORRECTIONS_TABLE_FOR: Record<EntryLocation, string> = {
  ONLINE: "daily_online_stock",
  OFFLINE: "daily_offline_stock",
};

/// The figures on each page that are mirrored onto the other one.
const TRANSFER_FIELDS: Record<EntryLocation, readonly string[]> = {
  ONLINE: ["stockInOffToOl", "stockOutOlToOff"],
  OFFLINE: ["stockInOlToOff", "stockOutOffToOl"],
};

export interface HeldTransfer {
  field: string;
  before: number;
  proposed: number;
}

interface SaveInput {
  extras?: StockExtraInput[];
  clearExtraColumns?: string[];
}

/// Splits a save into what can be applied now and the transfer changes that
/// have to wait for an admin. With nothing to hold (the other page is open, or
/// no transfer figure actually changes) the input comes back untouched.
export async function holdLockedTransfers<I extends object>(
  location: EntryLocation,
  input: I,
  existing: object | null | undefined,
  entryDate: Date,
  shift: Shift,
  db: Db,
): Promise<{ input: I; held: HeldTransfer[] }> {
  const fields = TRANSFER_FIELDS[location];
  const { extras = [], clearExtraColumns = [] } = input as SaveInput;
  const fromExtras = totalsFromExtras(extras);
  const current = (existing ?? {}) as Record<string, unknown>;
  const typed = input as Record<string, unknown>;

  const changes: HeldTransfer[] = [];
  for (const field of fields) {
    const proposed = fromExtras[field] ?? (typed[field] as number | undefined);
    if (proposed === undefined) continue;
    const before = toNum(current[field] as never);
    if (proposed !== before) changes.push({ field, before, proposed });
  }
  if (changes.length === 0 || !(await isCounterpartLocked(entryDate, shift, location, db))) return { input, held: [] };

  const heldFields = new Set(changes.map((c) => c.field));
  const rest: Record<string, unknown> = { ...typed };
  for (const field of heldFields) delete rest[field];
  rest.extras = extras.filter((e) => !heldFields.has(e.columnKey));
  rest.clearExtraColumns = clearExtraColumns.filter((k) => !heldFields.has(k));
  return { input: rest as unknown as I, held: changes };
}

/// Files the held changes as pending requests against the saved row. A figure
/// that already has a pending request keeps that request, now asking for the
/// newer value, rather than stacking a second one.
export async function requestHeldTransfers(
  location: EntryLocation,
  recordId: number,
  held: HeldTransfer[],
  userId: number | undefined,
  db: Db,
): Promise<void> {
  const tableName = CORRECTIONS_TABLE_FOR[location];
  const here = location === "ONLINE" ? "Online" : "Offline";
  const there = location === "ONLINE" ? "Offline" : "Online";
  const reason = `Held for approval: ${there} is already finished for this shift, and this ${here} transfer also changes ${there}.`;

  for (const h of held) {
    const pending = await db.correctionRequest.findFirst({
      where: { tableName, recordId, field: h.field, status: CorrectionStatus.PENDING },
    });
    if (pending) {
      const updated = await db.correctionRequest.update({
        where: { id: pending.id },
        data: { beforeValue: String(h.before), proposedValue: String(h.proposed), reason, requestedById: userId ?? null },
      });
      await recordChange({ tableName: "correction_requests", recordId: updated.id, action: "UPDATE", changedById: userId, oldValue: pending, newValue: updated }, db);
      continue;
    }
    const created = await db.correctionRequest.create({
      data: {
        tableName,
        recordId,
        field: h.field,
        beforeValue: String(h.before),
        proposedValue: String(h.proposed),
        reason,
        requestedById: userId ?? null,
        events: { create: { event: "REQUESTED", byId: userId ?? null, note: reason } },
      },
    });
    await recordChange({ tableName: "correction_requests", recordId: created.id, action: "CREATE", changedById: userId, newValue: created }, db);
  }
}
