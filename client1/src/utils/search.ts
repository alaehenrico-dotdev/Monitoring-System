/// Multi-term "smart" search: every space-separated word in the query must
/// appear somewhere across the given fields (case-insensitive), in any
/// order - so "gallon sweet" matches "Sweet A" in category "Class A
/// (Gallon)" even though the words appear in reverse order across two
/// different fields. An empty query matches everything.
export function matchesSearch(fields: (string | number | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = fields.filter((f) => f !== null && f !== undefined).join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}
