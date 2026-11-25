/// Shared by the dashboard's AI card and the header search's AI answer.

/// Friendly names for the server's read-only lookups (server services/aiAsk.service.ts), for the
/// "Based on ..." line under an answer.
const TOOL_LABEL: Record<string, string> = {
  period_summary: "Period summary",
  variance_by_product: "Variance by product",
  days_of_stock: "Days of stock",
  open_issues: "Admin queue",
};

/// "2026-11-01 → 2026-11-14, search: soy" - the arguments a lookup was made with, so the person
/// can see which dates the answer covers.
export function describeArgs(args: Record<string, unknown>): string {
  const { from, to, ...rest } = args;
  const parts = [from && to ? `${from} → ${to}` : null, ...Object.entries(rest).map(([k, v]) => `${k}: ${String(v)}`)];
  return parts.filter(Boolean).join(", ");
}

/// "Based on Period summary (2026-11-01 → 2026-11-14) · Admin queue".
export function sourcesLine(sources: { tool: string; args: Record<string, unknown> }[]): string {
  return sources
    .map((s) => `${TOOL_LABEL[s.tool] ?? s.tool}${Object.keys(s.args).length > 0 ? ` (${describeArgs(s.args)})` : ""}`)
    .join(" · ");
}

const QUESTION_START = /^(what|which|how|why|who|when|where|show|list|compare|tell|give)\b/i;

/// Whether what was typed into the header search reads as a question for the AI rather than the
/// name of a page or product. Decides only whether "Ask AI" is listed FIRST (so Enter asks it) or
/// LAST (so Enter keeps jumping to the best page/product match, exactly as before) - a four-word
/// product name must never be hijacked. Ctrl+Enter asks the AI whatever was typed.
export function questionFirst(query: string): boolean {
  const q = query.trim();
  if (q.endsWith("?")) return true;
  return q.split(/\s+/).length >= 3 && QUESTION_START.test(q);
}
