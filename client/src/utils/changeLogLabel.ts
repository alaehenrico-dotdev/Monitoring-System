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

/// The readable stand-in for the old "#4821" Record column, e.g.
/// "AFP007 · Soy Sauce 1L · Oct 9 · Night · Online". Parts that don't apply
/// (a SKU row has no date or shift) or that are unknown are left out.
export function recordLabel(context: ChangeLogContext | null | undefined, recordId: number, now = new Date()): string {
  if (!context) return `#${recordId}`;
  const parts = [
    context.sku,
    context.productName,
    context.entryDate ? shortDate(context.entryDate, now) : null,
    context.shift ? SHIFT[context.shift] : null,
    context.location ? LOCATION[context.location] : null,
  ].filter((p): p is string => !!p);
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
