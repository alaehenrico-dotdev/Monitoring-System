import { prisma } from "../lib/prisma";
import { getOrSet, invalidate } from "../lib/cache";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { logSystemEvent } from "./changeLog.service";

/**
 * Settings > Entry Rules: switches that change how the entry pages behave for
 * everyone. Stored one row per switch in `app_settings`; a missing row is the
 * built-in default, which is the behaviour the system always had.
 */
export interface EntryRules {
  /// Days are finished in order: an entry page stays read-only while an earlier
  /// day with saved entries is still unfinished. Off lets people fill in the
  /// present day while earlier days are still open. (Finish Day itself always
  /// goes in order, so the locks stay in sequence either way.)
  requireEarlierDaysFinished: boolean;
  /// Two shifts a day (Morning 7am-4pm, Night 4pm-1am), on unless an admin turns
  /// it off. Off, a day is one whole sheet: entries are saved as the Night sheet of the calendar date, however
  /// late it is, and the Morning sheet is not used. Days that were already
  /// entered by shift stay as they are and show combined, read-only.
  useShifts: boolean;
}

export const ENTRY_RULE_DEFAULTS: EntryRules = { requireEarlierDaysFinished: true, useShifts: true };

const KEYS = { requireEarlierDaysFinished: "entry.requireEarlierDaysFinished", useShifts: "entry.useShifts" } as const;
const CACHE_KEY = "app-settings:entry-rules";
/// Read on every entry save and every day-status lookup, so it is cached; a
/// change drops the cache at once, the TTL only covers a stale second instance.
const CACHE_TTL_MS = 10_000;

async function load(): Promise<EntryRules> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return {
    requireEarlierDaysFinished: value(KEYS.requireEarlierDaysFinished) !== "false",
    useShifts: value(KEYS.useShifts) !== "false",
  };
}

/// A failed read means "use the defaults", never "block saving": the safe
/// reading of an unreadable setting is the long-standing behaviour.
export async function getEntryRules(): Promise<EntryRules> {
  try {
    return await getOrSet(CACHE_KEY, CACHE_TTL_MS, load);
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", event: "app-settings-unreadable", message: err instanceof Error ? err.message : String(err) }));
    return ENTRY_RULE_DEFAULTS;
  }
}

/**
 * Settings > Google Drive > Daily Report PDF: what the PDF saved to Drive leaves
 * out. Both are off unless an admin turns them on, so by default the report lists
 * every product and every column, as it always has.
 */
export interface ReportOptions {
  /// Leave out products whose every figure is zero that day.
  hideEmptyRows: boolean;
  /// Leave out columns that are zero for every product that day.
  hideEmptyColumns: boolean;
}

export const REPORT_OPTION_DEFAULTS: ReportOptions = { hideEmptyRows: false, hideEmptyColumns: false };
const REPORT_KEYS = { hideEmptyRows: "report.hideEmptyRows", hideEmptyColumns: "report.hideEmptyColumns" } as const;

/// A failed read means "show everything" - the safe reading is the complete report.
export async function getReportOptions(): Promise<ReportOptions> {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(REPORT_KEYS) } } });
    const on = (key: string) => rows.find((r) => r.key === key)?.value === "true";
    return { hideEmptyRows: on(REPORT_KEYS.hideEmptyRows), hideEmptyColumns: on(REPORT_KEYS.hideEmptyColumns) };
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", event: "report-options-unreadable", message: err instanceof Error ? err.message : String(err) }));
    return REPORT_OPTION_DEFAULTS;
  }
}

export async function setReportOptions(patch: Partial<ReportOptions>, userId: number): Promise<ReportOptions> {
  for (const name of Object.keys(patch) as (keyof ReportOptions)[]) {
    const value = String(patch[name]);
    await prisma.appSetting.upsert({
      where: { key: REPORT_KEYS[name] },
      create: { key: REPORT_KEYS[name], value, updatedById: userId },
      update: { value, updatedById: userId },
    });
  }
  await logSystemEvent("report_options", { ...patch }, userId, "UPDATE");
  return getReportOptions();
}

export async function setEntryRules(patch: Partial<EntryRules>, userId: number): Promise<EntryRules> {
  for (const name of Object.keys(patch) as (keyof EntryRules)[]) {
    const value = String(patch[name]);
    await prisma.appSetting.upsert({
      where: { key: KEYS[name] },
      create: { key: KEYS[name], value, updatedById: userId },
      update: { value, updatedById: userId },
    });
  }
  invalidate(CACHE_KEY);
  await logSystemEvent("entry_rules", { ...patch }, userId, "UPDATE");
  // Open entry pages re-read their day status, so the change shows without a refresh.
  broadcastRealtimeEvent();
  return getEntryRules();
}
