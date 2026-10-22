import type { PeriodMonitoring, PeriodTotals } from "../api/periodMonitoring";
import { toCsv } from "./csv";
import { formatDateDisplay } from "./dateFormat";

export type PeriodKind = "week" | "month";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/// Built from the parts (not `new Date("YYYY-MM-DD")`, which is UTC midnight and
/// lands on the previous day in timezones behind UTC).
function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/// The window `anchor` falls in: a Monday-to-Sunday week, or the calendar month.
export function periodRange(kind: PeriodKind, anchor: string): { from: string; to: string } {
  const d = parse(anchor);
  if (kind === "month") {
    return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }
  const sinceMonday = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday);
  return { from: iso(monday), to: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
}

/// A date inside the period `steps` before (negative) or after (positive) the one `anchor` is in.
export function shiftPeriod(kind: PeriodKind, anchor: string, steps: number): string {
  const d = parse(anchor);
  return iso(kind === "month" ? new Date(d.getFullYear(), d.getMonth() + steps, 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + steps * 7));
}

export function periodTitle(kind: PeriodKind, from: string, to: string): string {
  if (kind === "month") return parse(from).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `${formatDateDisplay(from)} – ${formatDateDisplay(to)}`;
}

export interface Delta {
  diff: number;
  /// Null when the previous figure was 0 (a percentage of nothing).
  pct: number | null;
}

export function deltaOf(current: number, previous: number | undefined): Delta | null {
  if (previous === undefined) return null;
  const diff = Math.round((current - previous) * 100) / 100;
  return { diff, pct: previous === 0 ? null : Math.round((diff / Math.abs(previous)) * 1000) / 10 };
}

/// Backloads as a share of everything that went out - a raw count says little
/// on its own. Null when nothing went out.
export function backloadRate(t: PeriodTotals): number | null {
  const gross = t.totalOut + t.backloads;
  return gross > 0 ? Math.round((t.backloads / gross) * 1000) / 10 : null;
}

export function periodCsv(data: PeriodMonitoring): string {
  const t = data.totals;
  return toCsv(
    ["Category", "SKU", "Product", "Unit", "Online Out", "Offline Out", "Total Out", "Backloads", "RTS", "Production In", "Net Variance", "Absolute Variance"],
    [
      ...data.products.map((p) => [p.category, p.sku ?? "", p.name, p.unit, p.onlineOut, p.offlineOut, p.totalOut, p.backloads, p.rts, p.productionIn, p.netVariance, p.absVariance]),
      ["", "", "TOTAL", "", t.onlineOut, t.offlineOut, t.totalOut, t.backloads, t.rts, t.productionIn, t.netVariance, t.absVariance],
    ],
  );
}
