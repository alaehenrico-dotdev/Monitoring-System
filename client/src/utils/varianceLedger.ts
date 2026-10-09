import { toCsv } from "./csv";

/// One saved manual count, as GET /reports/variance returns it.
export interface LedgerCount {
  id: number;
  entryDate: string;
  location: string;
  shift?: string;
  systemRemainingStock: string | number;
  manualCount: string | number;
  variance: string | number;
  remarks?: string | null;
  product: { id: number; sku: string | null; name: string; category: string };
  countedBy: { name: string } | null;
}

export interface LedgerRow {
  productId: number;
  sku: string | null;
  name: string;
  category: string;
  /// Counts taken in the period (zero variances included).
  counts: number;
  /// How many of them were off.
  flagged: number;
  /// Signed total: positive = the system said more than was there (shortage).
  net: number;
  /// Total size of the discrepancies, ignoring direction - the honest measure
  /// of how unreliable a SKU is, since a +5 and a -5 do not cancel out.
  absolute: number;
  largest: number;
  lastFlaggedDate: string | null;
  /// The person who counted this SKU most often, and how often.
  topCounter: { name: string; times: number } | null;
  /// Flagged counts that carry an explanation.
  explained: number;
  /// Off two or more times in the period.
  recurring: boolean;
  /// Every count behind the totals, newest first.
  entries: LedgerCount[];
}

const num = (v: string | number) => Number(v) || 0;

/**
 * Rolls a period's counts up per SKU: how often each one was off, by how much,
 * who was counting, and whether anyone said why - the "which SKUs keep going
 * wrong, and is it the same person or the same place" view. Sorted worst
 * first (largest total discrepancy, then most flagged counts).
 */
export function buildVarianceLedger(counts: LedgerCount[]): LedgerRow[] {
  const byProduct = new Map<number, LedgerCount[]>();
  for (const c of counts) {
    const list = byProduct.get(c.product.id);
    if (list) list.push(c);
    else byProduct.set(c.product.id, [c]);
  }

  const rows: LedgerRow[] = [];
  for (const [productId, list] of byProduct) {
    const entries = [...list].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id);
    const off = entries.filter((e) => num(e.variance) !== 0);

    const counters = new Map<string, number>();
    for (const e of entries) {
      const name = e.countedBy?.name;
      if (name) counters.set(name, (counters.get(name) ?? 0) + 1);
    }
    const top = [...counters.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

    const p = entries[0].product;
    rows.push({
      productId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      counts: entries.length,
      flagged: off.length,
      net: round2(off.reduce((s, e) => s + num(e.variance), 0)),
      absolute: round2(off.reduce((s, e) => s + Math.abs(num(e.variance)), 0)),
      largest: off.reduce((m, e) => Math.max(m, Math.abs(num(e.variance))), 0),
      lastFlaggedDate: off.length ? off[0].entryDate.slice(0, 10) : null,
      topCounter: top ? { name: top[0], times: top[1] } : null,
      explained: off.filter((e) => (e.remarks ?? "").trim() !== "").length,
      recurring: off.length >= 2,
      entries,
    });
  }
  return rows.sort((a, b) => b.absolute - a.absolute || b.flagged - a.flagged || a.name.localeCompare(b.name));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const HEADERS = ["SKU", "Product", "Category", "Counts", "Off", "Net variance", "Total discrepancy", "Largest", "Last off", "Counted most by", "Explained"];

/// The ledger as CSV text. Text cells starting with = + - @ are prefixed so a
/// stored value cannot run as a spreadsheet formula.
export function varianceLedgerCsv(rows: LedgerRow[]): string {
  const safe = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v);
  return toCsv(
    HEADERS,
    rows.map((r) => [
      safe(r.sku ?? ""),
      safe(r.name),
      safe(r.category),
      r.counts,
      r.flagged,
      r.net,
      r.absolute,
      r.largest,
      r.lastFlaggedDate ?? "",
      safe(r.topCounter ? `${r.topCounter.name} (${r.topCounter.times})` : ""),
      `${r.explained}/${r.flagged}`,
    ]),
  );
}
