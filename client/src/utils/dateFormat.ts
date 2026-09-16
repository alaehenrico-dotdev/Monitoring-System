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

/// "3m ago" / "2h ago" / "5d ago" for a recent-activity feed (Dashboard) -
/// falls back to a plain date once something is old enough that a relative
/// label stops being useful ("just now" is more informative than "4w ago").
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
