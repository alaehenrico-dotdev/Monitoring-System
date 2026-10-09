/// Local-time calendar helpers shared by DatePicker and DateRangePicker.

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Built from the parts (never `new Date("YYYY-MM-DD")`, which is UTC midnight
// and shows the previous day in timezones behind UTC) - same reason as
// utils/dateFormat.ts.
export function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/// Clamps the day so Jan 31 + 1 month is Feb 28/29, not a spill into March.
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const fmtLong = (d: Date, year: boolean) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
const fmtShort = (d: Date) => d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });

/// Trigger text for the current range, long and compact forms.
export function rangeLabels(from: string, to: string): { long: string; short: string } {
  const a = parseISO(from);
  const b = parseISO(to);
  if (!a && !b) return { long: "Any date", short: "Any date" };
  if (a && b && sameDay(a, b)) return { long: fmtLong(a, true), short: fmtShort(a) };
  if (a && b) {
    const sameYear = a.getFullYear() === b.getFullYear();
    return { long: `${fmtLong(a, !sameYear)} – ${fmtLong(b, true)}`, short: `${fmtShort(a)} – ${fmtShort(b)}` };
  }
  if (a) return { long: `From ${fmtLong(a, true)}`, short: `From ${fmtShort(a)}` };
  return { long: `Until ${fmtLong(b!, true)}`, short: `Until ${fmtShort(b!)}` };
}
