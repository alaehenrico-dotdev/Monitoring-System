import { Shift, StockLocation } from "@prisma/client";
import { importBatchRepository } from "../repositories/importBatchRepository";
import { changeLogRepository } from "../repositories/changeLogRepository";
import { deleteManualCount, saveManualCount } from "./manualCounts.service";
import { HttpError } from "../utils/HttpError";

const MANUAL_COUNTS_TABLE = "manual_counts";

export function createImportBatch(data: { location: StockLocation; entryDate: Date; shift: Shift; fileName: string }, userId?: number) {
  return importBatchRepository.create({ ...data, importedById: userId });
}

export async function finalizeImportBatch(id: number, rowCount: number) {
  const batch = await importBatchRepository.findById(id);
  if (!batch) throw HttpError.notFound("Import batch not found");
  return importBatchRepository.updateRowCount(id, rowCount);
}

export function listImportBatches(location?: StockLocation) {
  return importBatchRepository.findMany({ location });
}

/// A manual_counts change_log row's old/new value as the service that wrote
/// it shaped them (see manualCounts.service.ts's saveManualCount) - stored as
/// JSON, so Decimal/Date fields come back as strings, not the original types.
interface ManualCountSnapshot {
  id: number;
  productId: number;
  entryDate: string;
  shift: Shift;
  location: StockLocation;
  manualCount: string | number;
}

/// Deleting an Import History entry reverts exactly the writes it made, then
/// removes the summary row - see the ChangeLog.importBatchId doc comment on
/// why the audit trail itself survives that removal.
///
/// Per-row safety: a row is only reverted if the import's own change_log
/// entry for it is STILL the latest one for that record. A row someone
/// touched again since (a manual correction, a second import) is left alone
/// and counted as "skipped" instead - deleting an old import must never
/// silently overwrite a newer, legitimate edit.
export async function revertImportBatch(id: number, userId?: number) {
  const batch = await importBatchRepository.findById(id);
  if (!batch) throw HttpError.notFound("Import batch not found");

  const logs = await changeLogRepository.findByImportBatch(id);
  let reverted = 0;
  let skipped = 0;

  for (const log of logs) {
    if (log.tableName !== MANUAL_COUNTS_TABLE) continue; // nothing else is ever tagged with a batch today

    const latest = await changeLogRepository.findLatestForRecord(log.tableName, log.recordId);
    if (!latest || latest.id !== log.id) {
      skipped++;
      continue;
    }

    const current = log.newValue as unknown as ManualCountSnapshot;
    if (log.action === "CREATE") {
      await deleteManualCount(current.productId, new Date(current.entryDate), current.shift, current.location, userId);
    } else {
      const prior = log.oldValue as unknown as ManualCountSnapshot | null;
      if (!prior) {
        skipped++;
        continue;
      }
      await saveManualCount(current.productId, new Date(current.entryDate), current.shift, current.location, Number(prior.manualCount), userId);
    }
    reverted++;
  }

  await importBatchRepository.delete(id);
  return { reverted, skipped };
}
