import { prisma } from "../lib/prisma";
import { toNum } from "../utils/stockMath";
import { toDateOnlyString } from "../utils/date";
import { getTotalStocksGrid } from "./totalStocks.service";
import { backupHealth } from "./backupVerify.service";
import { countPendingCorrections } from "./correction.service";

/// How far back the queue looks for missing entries and unexplained variances.
/// Older history is still in the reports; the queue is for what can still be fixed.
const LOOKBACK_DAYS = 7;
const VARIANCE_LOOKBACK_DAYS = 30;
const LOW_STOCK_LIMIT = 100;
/// The shop's wall clock is UTC+8; "today" and "has this period ended" follow it.
const LOCAL_UTC_OFFSET_HOURS = 8;

type ShiftName = "MORNING" | "NIGHT";
const SHIFTS: ShiftName[] = ["MORNING", "NIGHT"];

function localToday(now: Date): Date {
  const local = new Date(now.getTime() + LOCAL_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const key = (d: Date, s: string) => `${toDateOnlyString(d)}|${s}`;

export interface QueueItem {
  id: string;
  kind: "variance" | "low-stock" | "missing-entry" | "backup" | "correction";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /// In-app route that opens the record needing attention.
  link: string;
}

export async function getActionQueue(now = new Date()) {
  const today = localToday(now);
  const from = addDays(today, -LOOKBACK_DAYS);
  const varianceFrom = addDays(today, -VARIANCE_LOOKBACK_DAYS);
  const yesterday = addDays(today, -1);

  const [online, offline, manual, variances, stockRows, health, pending, pendingCount] = await Promise.all([
    prisma.dailyOnlineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: { gte: from, lte: yesterday } }, _count: { _all: true } }),
    prisma.dailyOfflineStock.groupBy({ by: ["entryDate", "shift"], where: { entryDate: { gte: from, lte: yesterday } }, _count: { _all: true } }),
    prisma.manualCount.groupBy({ by: ["entryDate", "shift"], where: { entryDate: { gte: from, lte: yesterday } }, _count: { _all: true } }),
    // A variance with no remark is unexplained; writing the reason is what resolves it.
    prisma.manualCount.groupBy({
      by: ["entryDate", "shift"],
      where: {
        entryDate: { gte: varianceFrom, lte: today },
        isOpeningBalance: false,
        NOT: { variance: 0 },
        OR: [{ remarks: null }, { remarks: "" }],
      },
      _count: { _all: true },
    }),
    getTotalStocksGrid(today),
    backupHealth(now),
    prisma.correctionRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { id: "asc" },
      take: 20,
      select: { id: true, tableName: true, field: true, beforeValue: true, proposedValue: true, requestedAt: true, requestedBy: { select: { name: true } } },
    }),
    countPendingCorrections(),
  ]);

  const items: QueueItem[] = [];

  // Unresolved variance, one row per sheet.
  for (const v of [...variances].sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())) {
    const date = toDateOnlyString(v.entryDate);
    items.push({
      id: `variance:${date}:${v.shift}`,
      kind: "variance",
      severity: "high",
      title: `${v._count._all} unexplained variance${v._count._all === 1 ? "" : "s"} - ${date} ${v.shift.toLowerCase()}`,
      detail: "Counts that differ from the system and have no remark yet.",
      link: `/variance-report?date=${date}`,
    });
  }

  // Missing daily entries: a finished period where a sheet has no saved rows.
  const has = {
    online: new Set(online.map((r) => key(r.entryDate, r.shift))),
    offline: new Set(offline.map((r) => key(r.entryDate, r.shift))),
    manual: new Set(manual.map((r) => key(r.entryDate, r.shift))),
  };
  const missing: { date: string; shift: ShiftName; sheets: string[] }[] = [];
  for (let d = yesterday; d >= from; d = addDays(d, -1)) {
    for (const shift of SHIFTS) {
      const k = key(d, shift);
      const sheets = [
        ...(has.online.has(k) ? [] : ["Online"]),
        ...(has.offline.has(k) ? [] : ["Offline"]),
        ...(has.manual.has(k) ? [] : ["Manual count"]),
      ];
      if (sheets.length) missing.push({ date: toDateOnlyString(d), shift, sheets });
    }
  }
  for (const m of missing) {
    const first = m.sheets[0];
    const route = first === "Online" ? "/online" : first === "Offline" ? "/offline" : "/manual-count";
    items.push({
      id: `missing:${m.date}:${m.shift}`,
      kind: "missing-entry",
      severity: m.sheets.length === 3 ? "high" : "medium",
      title: `No ${m.sheets.join(" / ")} entry - ${m.date} ${m.shift.toLowerCase()}`,
      detail: "Nothing was saved for this period.",
      link: `${route}?date=${m.date}&shift=${m.shift}`,
    });
  }

  // Low / negative stock, as of today.
  const alerts = stockRows
    .map((row) => {
      const remaining = toNum(row.totalRemainingStock);
      const threshold = row.product.lowStockThreshold === null ? null : toNum(row.product.lowStockThreshold);
      if (remaining < 0) return { row, remaining, kind: "negative" as const };
      if (threshold !== null && remaining <= threshold) return { row, remaining, kind: remaining === 0 ? ("out" as const) : ("low" as const) };
      return null;
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => a.remaining - b.remaining);
  for (const a of alerts.slice(0, LOW_STOCK_LIMIT)) {
    items.push({
      id: `stock:${a.row.product.id}`,
      kind: "low-stock",
      severity: a.kind === "low" ? "medium" : "high",
      title: `${a.row.product.name} - ${a.kind === "negative" ? "negative" : a.kind === "out" ? "out of stock" : "low stock"} (${a.remaining})`,
      detail: a.row.product.lowStockThreshold === null ? "Below zero." : `Alert level ${toNum(a.row.product.lowStockThreshold)} ${a.row.product.unit}.`,
      link: "/total-stocks",
    });
  }

  // Backups.
  if (health.failedSince) {
    items.push({
      id: "backup:failed",
      kind: "backup",
      severity: "high",
      title: `A backup failed or was invalid (${health.failedSince.fileName})`,
      detail: health.failedSince.error ?? "No good backup has been taken since.",
      link: "/settings",
    });
  }
  if (health.overdue) {
    items.push({
      id: "backup:overdue",
      kind: "backup",
      severity: "high",
      title: health.lastBackupAt ? `Backup overdue - last one ${health.lastBackupAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No backup has ever been taken",
      detail: `Expected at least every ${health.overdueHours} hours.`,
      link: "/settings",
    });
  }

  // Corrections waiting for a decision.
  for (const c of pending) {
    items.push({
      id: `correction:${c.id}`,
      kind: "correction",
      severity: "medium",
      title: `Correction to review: ${c.field} ${c.beforeValue} -> ${c.proposedValue}`,
      detail: `Requested by ${c.requestedBy?.name ?? "a removed user"}.`,
      link: "/corrections",
    });
  }

  const counts = {
    variance: variances.reduce((n, v) => n + v._count._all, 0),
    lowStock: alerts.length,
    missingEntries: missing.length,
    backup: (health.failedSince ? 1 : 0) + (health.overdue ? 1 : 0),
    corrections: pendingCount,
  };
  return {
    generatedAt: now.toISOString(),
    total: counts.variance + counts.lowStock + counts.missingEntries + counts.backup + counts.corrections,
    counts,
    items,
  };
}
