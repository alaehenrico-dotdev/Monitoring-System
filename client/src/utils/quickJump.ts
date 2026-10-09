import type { NavLinkDef } from "../config/navigation";
import type { Product } from "../types";

export interface PageResult {
  kind: "page";
  /// Stable React key / active-descendant id.
  id: string;
  label: string;
  to: string;
  /// The ribbon group this page sits in ("Reports"), shown as the row's hint.
  hint: string;
}

export interface ProductResult {
  kind: "product";
  id: string;
  label: string;
  hint: string;
  productId: number;
}

export type QuickJumpResult = PageResult | ProductResult;

/**
 * Match tiers, best first. "Prefix matches rank first" is the stated rule,
 * but a bare prefix/contains split puts "Sweet A" (contains "ee") level with
 * "Green Mango" when someone types "ee" - so a match that starts a *word*
 * sits between the two. That's what makes typing "man" surface "Green
 * Mango" above "Permanent Marker", which a plain contains-anywhere scan
 * would order arbitrarily.
 */
const EXACT = 0;
const PREFIX = 1;
const WORD_PREFIX = 2;
const CONTAINS = 3;
const NO_MATCH = 99;

/// How well one field matches, as a tier above. Case-insensitive; both sides
/// are expected pre-lowercased by the callers below.
function tierOf(field: string, q: string): number {
  if (!field) return NO_MATCH;
  if (field === q) return EXACT;
  if (field.startsWith(q)) return PREFIX;
  // Any non-alphanumeric run counts as a word break, so "Class A (Gallon)"
  // matches "gal" at WORD_PREFIX rather than falling through to CONTAINS.
  if (new RegExp(`[^a-z0-9]${escapeRe(q)}`).test(field)) return WORD_PREFIX;
  return field.includes(q) ? CONTAINS : NO_MATCH;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// Best tier across several fields - a product matching on its SKU alone is
/// as good a hit as one matching on its name.
function bestTier(fields: (string | null | undefined)[], q: string): number {
  let best = NO_MATCH;
  for (const f of fields) {
    const t = tierOf((f ?? "").toLowerCase(), q);
    if (t < best) best = t;
    if (best === EXACT) break;
  }
  return best;
}

/**
 * Cap on rendered rows. The palette is a keyboard target, not a browser -
 * nobody arrows to the 80th result, and an uncapped list of several hundred
 * products is what would make filtering feel slow enough to need debouncing
 * in the first place. Matches are already ordered best-first, so the cap
 * only ever drops the least relevant tail.
 */
export const QUICK_JUMP_LIMIT = 40;

/**
 * Ranks pages and products against one query for the Ctrl+K palette.
 *
 * `pages` must already be filtered to what this user's role can open (see
 * config/navigation.ts `pagesForRole`) - this function deliberately knows
 * nothing about roles, so there is exactly one place that decides access.
 *
 * An empty query lists the pages alone, in their ribbon order: the palette
 * opens as a launcher, and dumping the entire product catalogue into it
 * before a single character is typed is noise, not a starting point.
 */
export function rankQuickJump(
  query: string,
  pages: NavLinkDef[],
  products: Product[],
  groupOf: (page: NavLinkDef) => string = () => "Page",
): QuickJumpResult[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return pages.map((p) => ({
      kind: "page" as const,
      id: `page:${p.to}`,
      label: p.label,
      to: p.to,
      hint: groupOf(p),
    }));
  }

  const scored: { tier: number; order: number; result: QuickJumpResult }[] = [];

  pages.forEach((p, i) => {
    const tier = bestTier([p.label], q);
    if (tier === NO_MATCH) return;
    scored.push({
      tier,
      // Pages sort ahead of products at the same tier (the -1000 below), and
      // among themselves keep ribbon order rather than alphabetising.
      order: i - 1000,
      result: {
        kind: "page",
        id: `page:${p.to}`,
        label: p.label,
        to: p.to,
        hint: groupOf(p),
      },
    });
  });

  products.forEach((p, i) => {
    const tier = bestTier([p.name, p.sku], q);
    if (tier === NO_MATCH) return;
    scored.push({
      tier,
      order: i,
      result: {
        kind: "product",
        id: `product:${p.id}`,
        label: p.name,
        hint: p.sku ? `${p.sku} · ${p.category}` : p.category,
        productId: p.id,
      },
    });
  });

  return scored
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
    .slice(0, QUICK_JUMP_LIMIT)
    .map((s) => s.result);
}
