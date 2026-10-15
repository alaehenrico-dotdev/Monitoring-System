import { prisma, type Db } from "../lib/prisma";
import { SNAPSHOT_TABLE } from "../repositories/changeLogRepository";
import { recordChange } from "./changeLog.service";

/**
 * The frozen Daily Report for a finished day (see DailyReportSnapshot in
 * schema.prisma). Kept apart from reports.service so the two can be used from
 * both directions (reports reads a snapshot; finishing a day builds one)
 * without importing each other.
 */

export interface SnapshotMeta {
  savedAt: Date;
  savedBy: { id: number; name: string } | null;
}

export async function saveSnapshot(entryDate: Date, report: unknown, userId: number | undefined, db: Db) {
  // Round-tripped through JSON so what is stored is exactly what the API
  // would have sent (Decimals as strings, dates as ISO strings), and what a
  // later read hands back is byte-for-byte that response.
  const payload = JSON.parse(JSON.stringify(report));
  const data = { payload, savedAt: new Date(), savedById: userId ?? null };
  const previous = await db.dailyReportSnapshot.findUnique({ where: { entryDate } });
  const saved = await db.dailyReportSnapshot.upsert({
    where: { entryDate },
    create: { entryDate, ...data },
    update: data,
  });
  // Backtrackable: every save is in the Change Log, and a re-save (after an
  // admin unlock) keeps the version it replaced in full, so an earlier state of
  // the day's report can always be recovered. The new payload is not copied
  // into the log - it is the live snapshot row.
  await recordChange(
    {
      tableName: SNAPSHOT_TABLE,
      recordId: saved.id,
      action: previous ? "UPDATE" : "CREATE",
      changedById: userId,
      oldValue: previous ?? undefined,
      newValue: { entryDate: entryDate.toISOString().slice(0, 10), savedAt: saved.savedAt, savedById: saved.savedById },
    },
    db,
  );
  return saved;
}

/**
 * The snapshot for `entryDate`, but only while the day is actually frozen:
 * every page (Online / Offline) of every shift that has saved rows for that
 * date is finished.
 * Anything else - no snapshot, an admin-unlocked shift, or a shift that has
 * entries but was never finished - means the numbers are still moving, so the
 * report must be read live instead.
 */
export async function findFrozenSnapshot(entryDate: Date, db: Db = prisma) {
  const snapshot = await db.dailyReportSnapshot.findUnique({
    where: { entryDate },
    include: { savedBy: { select: { id: true, name: true } } },
  });
  if (!snapshot) return null;

  const [closures, online, offline] = await Promise.all([
    db.dayClosure.findMany({ where: { entryDate }, select: { shift: true, onlineLocked: true, offlineLocked: true } }),
    db.dailyOnlineStock.groupBy({ by: ["shift"], where: { entryDate } }),
    db.dailyOfflineStock.groupBy({ by: ["shift"], where: { entryDate } }),
  ]);
  // Each page is finished on its own, so each shift's Online rows need its
  // Online page locked and its Offline rows need its Offline page locked.
  const onlineClosed = new Set(closures.filter((c) => c.onlineLocked).map((c) => c.shift));
  const offlineClosed = new Set(closures.filter((c) => c.offlineLocked).map((c) => c.shift));
  for (const r of online) if (!onlineClosed.has(r.shift)) return null;
  for (const r of offline) if (!offlineClosed.has(r.shift)) return null;
  return snapshot;
}

export function snapshotMeta(snapshot: { savedAt: Date; savedBy: { id: number; name: string } | null }) {
  return { savedAt: snapshot.savedAt.toISOString(), savedBy: snapshot.savedBy };
}

