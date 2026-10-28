import { CorrectionStatus } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { toNum } from "../utils/stockMath";
import { recordChange } from "./changeLog.service";
import { CORRECTIONS_TABLE_FOR } from "./heldTransfers.service";
import type { EntryLocation } from "./dayLock.service";

/**
 * A change to an earlier period moves every opening stock after it - an entry
 * save, or publishing an applied audit (a re-audit). When one of those later
 * periods is already finished, it must not be rewritten quietly:
 * the carry-forward stops there and files a pending request for that row's
 * opening stock instead. An admin approves it (or not) per day, in order, and
 * each approval continues the walk to the next locked day.
 *
 * It rides on correction_requests like a held transfer does, so it shows up in
 * the same Corrections queue with the same audit trail. `field` is
 * STALE_OPENING_FIELD; the figure it asks for is re-derived at approval time
 * (never replayed from `proposedValue`), because more changes may have landed
 * in between - and an opening typed into a row would wrongly pin it as manual.
 */

export const STALE_OPENING_FIELD = "openingStock";

const REASON =
  "Held for approval: an earlier period changed, so this finished day's opening stock no longer matches what was carried forward.";

/// Files (or refreshes) the pending request for one finished row. A row that
/// already has one keeps that request, now showing the newer figures, rather
/// than stacking a second.
export async function holdStaleOpening(
  location: EntryLocation,
  row: { id: number; openingStock: unknown },
  proposedOpening: number,
  userId: number | undefined,
  db: Db,
  causedById?: number,
): Promise<void> {
  const tableName = CORRECTIONS_TABLE_FOR[location];
  const before = toNum(row.openingStock as never);
  const pending = await db.correctionRequest.findFirst({
    where: { tableName, recordId: row.id, field: STALE_OPENING_FIELD, status: CorrectionStatus.PENDING },
  });
  if (pending) {
    if (pending.beforeValue === String(before) && pending.proposedValue === String(proposedOpening)) return;
    const updated = await db.correctionRequest.update({
      where: { id: pending.id },
      data: { beforeValue: String(before), proposedValue: String(proposedOpening), requestedById: userId ?? null },
    });
    await recordChange(
      { tableName: "correction_requests", recordId: updated.id, action: "UPDATE", changedById: userId, oldValue: pending, newValue: updated, causedById },
      db,
    );
    return;
  }
  const created = await db.correctionRequest.create({
    data: {
      tableName,
      recordId: row.id,
      field: STALE_OPENING_FIELD,
      beforeValue: String(before),
      proposedValue: String(proposedOpening),
      reason: REASON,
      requestedById: userId ?? null,
      events: { create: { event: "REQUESTED", byId: userId ?? null, note: REASON } },
    },
  });
  await recordChange(
    { tableName: "correction_requests", recordId: created.id, action: "CREATE", changedById: userId, newValue: created, causedById },
    db,
  );
}
