/// Short forms of the wording on filters and titles, for the phone view
/// (hooks/useReadOnlyPhone.ts) where every character counts. Only recognised
/// patterns are shortened: a product or category name is data, and cutting it
/// to a word could make two different ones look the same.
///
/// The full text stays in the menu a filter opens, in tooltips and in the
/// accessible name; this is only what the closed control shows.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function phoneLabel(text: string): string {
  const t = text.trim();
  if (t === "Online + Offline") return "Both";
  if (/^Full Report\b/i.test(t)) return "Full";
  const last = /^Last (\d+) days?$/i.exec(t);
  if (last) return `${last[1]}d`;
  // "All categories", "Both shifts", "Any date" -> "Categories", "Shifts", "Date".
  const lead = /^(?:All|Both|Any)\s+(\S+)$/i.exec(t);
  if (lead) return cap(lead[1]);
  return t;
}

/// A page title without its date or bracketed detail: "Consolidated (Online +
/// Offline) - November 10, 2026" -> "Consolidated". Pages show the date in
/// their toolbar already.
export function phoneTitle(title: string): string {
  return title.replace(/\s+-\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "").trim() || title;
}
