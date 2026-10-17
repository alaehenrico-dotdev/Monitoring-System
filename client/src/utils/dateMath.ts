/// Moves a "YYYY-MM-DD" business date by whole days. Built from the date's own
/// parts (local calendar arithmetic), never `new Date("YYYY-MM-DD")`: that parses
/// as UTC midnight, which is the previous day for the first hours of every day in
/// this app's Asia/Manila timezone.
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const moved = new Date(y, m - 1, d + days);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}-${pad(moved.getDate())}`;
}

/// "YYYY-MM" of a "YYYY-MM-DD" date.
export const yearMonthOf = (iso: string): string => iso.slice(0, 7);

/// The calendar month before a "YYYY-MM".
export function previousMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const moved = new Date(y, m - 2, 1);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, "0")}`;
}
