import type { NavLinkDef } from "../config/navigation";
import type { SettingsTabDef } from "../config/settingsTabs";
import type { Product, TotalStockRow } from "../types";
import { formatDateDisplay } from "./dateFormat";
import type { HandoffKey } from "./searchHandoff";

/**
 * The phone's search (the magnifier in the header, components/QuickJump.tsx). On a desktop the
 * palette is a keyboard launcher for pages and products (utils/quickJump.ts); on a phone it is
 * the one place to find anything, so it looks across the whole read-only system:
 *
 *   pages             by name or by what they are for ("stocks", "history", "graph")
 *   settings sections "password", "dark mode", "backup" -> that tab of Settings
 *   products          by name, SKU or category, each with today's remaining stock
 *   categories        with their product count and total
 *   dates             "nov 9", "11/9", "yesterday" -> the Daily Report for that day
 *   the Change Log    "search the Change Log for ..." with the text carried over
 *   actions           switch between dark and light
 *
 * Words may come in any order ("a sweet" finds SWEET A) and one slip per word is forgiven
 * ("vinegr", "pasword"). Pure and synchronous: a few hundred rows scanned per keystroke.
 *
 * Callers pass only what this role may open; nothing here decides access.
 */

export type PhoneSearchGroup = "Pages" | "Reports" | "Products" | "Categories" | "Settings" | "Actions" | "Change Log";

interface Base {
  /// Stable React key / active-descendant id.
  id: string;
  group: PhoneSearchGroup;
  label: string;
  /// Short text on the right of the row.
  hint: string;
  /// A second line under the label (a product's stock figures).
  detail?: string;
}

export interface PhoneLinkResult extends Base {
  kind: "link";
  to: string;
  /// A value for the page that opens (utils/searchHandoff.ts).
  handoff?: { key: HandoffKey; value: string };
}

export interface PhoneActionResult extends Base {
  kind: "action";
  action: "toggle-theme";
}

export type PhoneSearchResult = PhoneLinkResult | PhoneActionResult;

export interface PhoneSearchSources {
  /// The pages on this role's bottom bar (config/navigation.ts phoneNavPages).
  pages: NavLinkDef[];
  groupOf: (page: NavLinkDef) => string;
  /// The Settings sections this role sees.
  settings: SettingsTabDef[];
  products: Product[];
  /// Today's remaining stock by product id; null until it has loaded (or if it failed).
  stocks: ReadonlyMap<number, TotalStockRow> | null;
  /// The current business date, "YYYY-MM-DD".
  today: string;
  theme: "light" | "dark";
}

/// Other words for each page, so a search for what a page shows finds it.
const PAGE_KEYWORDS: Record<string, string> = {
  "/dashboard": "home overview graph chart stock flow weekly monthly monitoring summary",
  "/daily-report": "report pdf print today sheet",
  "/total-stocks": "stocks total remaining inventory balance online offline products count",
  "/daily-out": "out fulfillment delivery delivered rts backloads sold",
  "/change-log": "log history audit trail changes edits who changed activity",
  "/settings": "preferences options configuration account",
};

const LIMIT: Record<PhoneSearchGroup, number> = {
  Pages: 6,
  Reports: 2,
  Products: 8,
  Categories: 3,
  Settings: 4,
  Actions: 2,
  "Change Log": 1,
};

/// Where each group sits when two groups match equally well.
const GROUP_ORDER: PhoneSearchGroup[] = ["Pages", "Reports", "Products", "Categories", "Settings", "Actions", "Change Log"];

// ---- Matching ---------------------------------------------------------------------------

/// Lower-case, accents removed, every run of punctuation a single space: "Class A (Gallon)" ->
/// "class a gallon", "AFP-067" -> "afp 067".
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/// Edit distance with adjacent swaps counted as one slip ("vniegar"), cut off once it passes `max`.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const NO_MATCH = 99;

/// How well one typed word matches a text, best (0) to worst: a whole word, the start of a
/// word, inside a word, then a near miss. A near miss needs a typed word of `fuzzyFrom` letters
/// or more (two slips are allowed from eight), and is compared with the start of each word so it
/// works while typing.
function wordScore(token: string, words: string[], fuzzyFrom: number): number {
  let best = NO_MATCH;
  for (const w of words) {
    if (w === token) return 0;
    if (w.startsWith(token)) best = Math.min(best, 1);
    else if (w.includes(token)) best = Math.min(best, 2);
  }
  if (best !== NO_MATCH || token.length < fuzzyFrom) return best;
  const allowed = token.length >= 8 ? 2 : 1;
  for (const w of words) {
    for (const len of [token.length - 1, token.length, token.length + 1]) {
      if (len < 3 || len > w.length) continue;
      if (editDistance(token, w.slice(0, len), allowed) <= allowed) return 4;
    }
  }
  return NO_MATCH;
}

interface Field {
  words: string[];
  /// Added to every match in this field: a name beats a keyword.
  penalty: number;
  /// Shortest typed word that may be a near miss here.
  fuzzyFrom: number;
}

/// A name forgives a slip from four letters. A keyword list is a bag of loosely related words,
/// where a short near miss is usually a different word ("sweet" is not "sheet"), so it needs six.
const field = (text: string | null | undefined, penalty = 0): Field => ({
  words: normalizeSearch(text ?? "").split(" ").filter(Boolean),
  penalty,
  fuzzyFrom: penalty === 0 ? 4 : 6,
});

/// Total score for a query against a candidate's fields, or NO_MATCH unless every typed word
/// matches somewhere. Lower is better.
function score(tokens: string[], fields: Field[]): number {
  let total = 0;
  for (const t of tokens) {
    let best = NO_MATCH;
    for (const f of fields) {
      const s = wordScore(t, f.words, f.fuzzyFrom);
      if (s !== NO_MATCH && s + f.penalty < best) best = s + f.penalty;
    }
    if (best === NO_MATCH) return NO_MATCH;
    total += best;
  }
  // The whole phrase starting the name ("sweet a" for SWEET A) leads the rest.
  const phrase = tokens.join(" ");
  const name = fields[0]?.words.join(" ") ?? "";
  if (name === phrase) total -= 2;
  else if (name.startsWith(phrase)) total -= 1;
  return total;
}

// ---- Dates ------------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad = (n: number) => String(n).padStart(2, "0");

/// "YYYY-MM-DD" for real calendar days only (no Feb 30).
function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

function monthOf(word: string): number | null {
  if (word.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(word));
  return i === -1 ? null : i + 1;
}

/**
 * Reads a whole query as a day: "today", "yesterday", "2026-11-09", "11/9", "11/9/26",
 * "nov 9", "9 november 2026". Returns "YYYY-MM-DD", or null when the text is not a date or the
 * day has not happened yet. A date typed without a year means the most recent such day.
 */
export function parseSearchDate(query: string, today: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  if (q === "today") return today;
  if (q === "yesterday") {
    const d = new Date(Date.UTC(ty, tm - 1, td - 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  let hit: RegExpExecArray | null;
  if ((hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q))) {
    [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else if ((hit = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(q))) {
    [m, d] = [Number(hit[1]), Number(hit[2])];
    if (hit[3]) y = hit[3].length === 2 ? 2000 + Number(hit[3]) : Number(hit[3]);
  } else if ((hit = /^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(q))) {
    [m, d] = [monthOf(hit[1]), Number(hit[2])];
    if (hit[3]) y = Number(hit[3]);
  } else if ((hit = /^(\d{1,2})\s+([a-z]+)\.?(?:,?\s+(\d{4}))?$/.exec(q))) {
    [d, m] = [Number(hit[1]), monthOf(hit[2])];
    if (hit[3]) y = Number(hit[3]);
  }
  if (m === null || d === null) return null;

  if (y !== null) {
    const iso = isoDate(y, m, d);
    return iso !== null && iso <= today ? iso : null;
  }
  const thisYear = isoDate(ty, m, d);
  if (thisYear !== null && thisYear <= today) return thisYear;
  return isoDate(ty - 1, m, d);
}

/// A product's searchable fields, normalised once. The catalogue is the same objects on every
/// keystroke, so this turns hundreds of string clean-ups per key press into a lookup.
const productFieldCache = new WeakMap<Product, Field[]>();

function productFields(p: Product): Field[] {
  let fields = productFieldCache.get(p);
  if (!fields) {
    fields = [field(p.name), field(p.sku), field(p.category, 1)];
    productFieldCache.set(p, fields);
  }
  return fields;
}

// ---- Ranking ----------------------------------------------------------------------------

const figure = (n: number) => n.toLocaleString();

function stockLine(row: TotalStockRow | undefined): string | undefined {
  return row
    ? `Online ${figure(row.onlineRemainingStock)} · Offline ${figure(row.offlineRemainingStock)} · Total ${figure(row.totalRemainingStock)}`
    : undefined;
}

interface Scored {
  score: number;
  order: number;
  result: PhoneSearchResult;
}

/**
 * Everything on the phone that matches `query`, grouped (the best-matching group first) and
 * capped per group. An empty query lists the pages alone: the search opens as a launcher.
 */
export function rankPhoneSearch(query: string, src: PhoneSearchSources): PhoneSearchResult[] {
  const pageResult = (p: NavLinkDef): PhoneLinkResult => ({ kind: "link", id: `page:${p.to}`, group: "Pages", label: p.label, hint: src.groupOf(p), to: p.to });
  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return src.pages.map(pageResult);

  const hasPage = (to: string) => src.pages.some((p) => p.to === to);
  const scored: Scored[] = [];
  const add = (fields: Field[], order: number, result: PhoneSearchResult) => {
    const s = score(tokens, fields);
    if (s !== NO_MATCH) scored.push({ score: s, order, result });
  };

  src.pages.forEach((p, i) => add([field(p.label), field(PAGE_KEYWORDS[p.to], 1)], i, pageResult(p)));

  if (hasPage("/settings")) {
    src.settings.forEach((t, i) =>
      add([field(t.label), field(t.keywords, 1)], i, {
        kind: "link",
        id: `settings:${t.key}`,
        group: "Settings",
        label: t.label,
        hint: "Settings",
        to: "/settings",
        handoff: { key: "settings-tab", value: t.key },
      }),
    );
    add([field(`${src.theme === "dark" ? "light" : "dark"} mode`), field("theme switch night day dark light appearance", 1)], 0, {
      kind: "action",
      id: "action:theme",
      group: "Actions",
      label: `Switch to ${src.theme === "dark" ? "light" : "dark"} mode`,
      hint: "Action",
      action: "toggle-theme",
    });
  }

  if (hasPage("/total-stocks")) {
    src.products.forEach((p, i) =>
      add(productFields(p), i, {
        kind: "link",
        id: `product:${p.id}`,
        group: "Products",
        label: p.name,
        hint: p.sku ? `${p.sku} · ${p.category}` : p.category,
        detail: stockLine(src.stocks?.get(p.id)),
        to: "/total-stocks",
        // Consolidated's own search box, so the filter is visible there and one tap clears it.
        handoff: { key: "stocks-query", value: p.sku ?? p.name },
      }),
    );

    const categories = new Map<string, Product[]>();
    for (const p of src.products) categories.set(p.category, [...(categories.get(p.category) ?? []), p]);
    [...categories.entries()].forEach(([category, list], i) => {
      const total = src.stocks ? list.reduce((sum, p) => sum + (src.stocks?.get(p.id)?.totalRemainingStock ?? 0), 0) : null;
      add([field(category)], i, {
        kind: "link",
        id: `category:${category}`,
        group: "Categories",
        label: category || "Uncategorised",
        hint: `${list.length} product${list.length === 1 ? "" : "s"}`,
        detail: total === null ? undefined : `Total remaining ${figure(total)}`,
        to: "/total-stocks",
        handoff: { key: "stocks-category", value: category },
      });
    });
  }

  const date = hasPage("/daily-report") ? parseSearchDate(query, src.today) : null;
  if (date) {
    scored.push({
      // A query that reads as a date is a date before it is anything else.
      score: -10,
      order: 0,
      result: {
        kind: "link",
        id: `report:${date}`,
        group: "Reports",
        label: `Daily Report · ${formatDateDisplay(date)}`,
        hint: date === src.today ? "Today" : "Report",
        to: "/daily-report",
        handoff: { key: "report-date", value: date },
      },
    });
  }

  const groups = new Map<PhoneSearchGroup, Scored[]>();
  for (const s of scored.sort((a, b) => a.score - b.score || a.order - b.order)) {
    const list = groups.get(s.result.group) ?? [];
    if (list.length < LIMIT[s.result.group]) list.push(s);
    groups.set(s.result.group, list);
  }
  const ranked = [...groups.entries()]
    .sort(([ga, a], [gb, b]) => a[0].score - b[0].score || GROUP_ORDER.indexOf(ga) - GROUP_ORDER.indexOf(gb))
    .flatMap(([, list]) => list.map((s) => s.result));

  // Always offered last: the Change Log holds text nothing above can see (who, what changed).
  const text = query.trim();
  if (hasPage("/change-log") && text.length >= 2) {
    ranked.push({
      kind: "link",
      id: "changelog:search",
      group: "Change Log",
      label: `Search the Change Log for “${text}”`,
      hint: "History",
      to: "/change-log",
      handoff: { key: "changelog-query", value: text },
    });
  }
  return ranked;
}
