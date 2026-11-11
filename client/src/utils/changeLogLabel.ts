import type { ChangeLogContext } from "../types";

const SHIFT = { MORNING: "Morning", NIGHT: "Night" } as const;
const LOCATION = { ONLINE: "Online", OFFLINE: "Offline", TOTAL: "Total" } as const;

/// "Oct 9", or "Oct 9, 2025" when it isn't this year. Built from the parts
/// of the "YYYY-MM-DD" string so no timezone can shift the day.
export function shortDate(dateStr: string, now = new Date()): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const label = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return y === now.getFullYear() ? label : `${label}, ${y}`;
}

export interface RecordParts {
  sku: string | null;
  name: string | null;
  date: string | null;
  shift: string | null;
  location: (typeof LOCATION)[keyof typeof LOCATION] | null;
}

/// The pieces of a record label, kept apart so the Change Log can set each in its own
/// column. Null when there is nothing to show but the id.
export function recordParts(context: ChangeLogContext | null | undefined, now = new Date()): RecordParts | null {
  if (!context) return null;
  const parts: RecordParts = {
    sku: context.sku || null,
    name: context.productName || null,
    date: context.entryDate ? shortDate(context.entryDate, now) : null,
    shift: context.shift ? SHIFT[context.shift] : null,
    location: context.location ? LOCATION[context.location] : null,
  };
  return Object.values(parts).some(Boolean) ? parts : null;
}

/// The readable stand-in for the old "#4821" Record column, e.g.
/// "AFP007 · Soy Sauce 1L · Oct 9 · Night · Online". Parts that don't apply
/// (a SKU row has no date or shift) or that are unknown are left out.
export function recordLabel(context: ChangeLogContext | null | undefined, recordId: number, now = new Date()): string {
  const p = recordParts(context, now);
  if (!p) return `#${recordId}`;
  const parts = [p.sku, p.name, p.date, p.shift, p.location].filter((x): x is string => !!x);
  // Product gone and nothing else to go on: the id is all that's left.
  return parts.length ? parts.join(" · ") : `#${recordId}`;
}

/// Local start of the picked day, as an ISO timestamp for the API.
export function startOfDayIso(dateStr: string): string | undefined {
  const [y, m, d] = dateStr.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d).toISOString() : undefined;
}

/// Local last millisecond of the picked day.
export function endOfDayIso(dateStr: string): string | undefined {
  const [y, m, d] = dateStr.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() : undefined;
}
