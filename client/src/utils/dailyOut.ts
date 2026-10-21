import type { DailyOutEntry } from "../api/dailyOut";
import type { ComboPoint, ComboTooltip } from "./comboChartData";
import { fullNumber } from "./chartFormat";
import { formatDateDisplay } from "./dateFormat";
import { toCsv } from "./csv";

/// "2026-10-06" -> "Oct 6", for the axis. Built from the parts (not
/// `new Date("2026-10-06")`, which is UTC midnight and shows the previous day
/// in timezones behind UTC).
function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function describeDay(e: DailyOutEntry): string {
  const when = formatDateDisplay(e.date);
  if (e.totalOut === null) return `${when} — No entries recorded`;
  const side = (label: string, v: number | null) => `${label}: ${v === null ? "no entry" : fullNumber.format(v)}`;
  return `${when} — ${side("Online out", e.onlineOut)} · ${side("Offline out", e.offlineOut)} · Combined out: ${fullNumber.format(e.totalOut)}`;
}

function dayTooltip(e: DailyOutEntry): ComboTooltip {
  const title = formatDateDisplay(e.date);
  if (e.totalOut === null) return { title, empty: "No entries recorded" };
  const missing = [e.onlineOut === null && "Online", e.offlineOut === null && "Offline"].filter(Boolean);
  return {
    title,
    rows: [
      { label: "Combined out", value: e.totalOut },
      ...(e.onlineOut === null ? [] : [{ label: "Online out", value: e.onlineOut, series: "online" as const }]),
      ...(e.offlineOut === null ? [] : [{ label: "Offline out", value: e.offlineOut, series: "offline" as const }]),
    ],
    footer: missing.length ? { text: `No ${missing.join(" or ")} entry that day` } : undefined,
  };
}

/// The chart's points: the combined figure as the bar, the two pools as lines.
export function dailyOutPoints(rows: DailyOutEntry[], today: string): ComboPoint[] {
  return rows.map((e) => ({
    key: e.date,
    label: shortDate(e.date),
    ariaLabel: describeDay(e),
    bar: e.totalOut,
    online: e.onlineOut,
    offline: e.offlineOut,
    current: e.date === today,
    tooltip: dayTooltip(e),
  }));
}

export interface DailyOutTotals {
  onlineOut: number;
  offlineOut: number;
  totalOut: number;
  /// Days that have at least one entry - the days the figures are summed over.
  days: number;
}

export function dailyOutTotals(rows: DailyOutEntry[]): DailyOutTotals {
  const sum = (pick: (e: DailyOutEntry) => number | null) =>
    Math.round(rows.reduce((acc, e) => acc + (pick(e) ?? 0), 0) * 100) / 100;
  return {
    onlineOut: sum((e) => e.onlineOut),
    offlineOut: sum((e) => e.offlineOut),
    totalOut: sum((e) => e.totalOut),
    days: rows.filter((e) => e.totalOut !== null).length,
  };
}

export function dailyOutCsv(rows: DailyOutEntry[]): string {
  const cell = (v: number | null) => (v === null ? "" : v);
  return toCsv(
    ["Date", "Online Out", "Offline Out", "Combined Out"],
    rows.map((e) => [e.date, cell(e.onlineOut), cell(e.offlineOut), cell(e.totalOut)]),
  );
}
