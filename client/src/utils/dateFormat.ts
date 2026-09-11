/// Formats a "YYYY-MM-DD" string for display (e.g. "September 11, 2026").
/// Built from the date-string parts rather than `new Date(dateStr)` +
/// `toLocaleDateString()` directly - parsing a bare "YYYY-MM-DD" string
/// produces a UTC midnight Date, and formatting that in a timezone behind
/// UTC (most of the Americas) would display the previous day.
export function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
