import { createHash } from "node:crypto";
import { env } from "../config/env";
import { getOrSet } from "../lib/cache";
import { generate, requireAi, textOf } from "../lib/gemini";
import { HttpError } from "../utils/HttpError";
import { localToday } from "./actionQueue.service";
import { getPeriodMonitoring, type PeriodMonitoring } from "./periodMonitoring.service";

/// Dashboard > "What changed?": this window of days against the window of the same length
/// right before it ("today vs yesterday", "this week vs last week", ...).
///
/// The comparison is computed here, deterministically, from the same grouped totals the
/// Weekly/Monthly Monitoring card uses. Gemini only turns the finished numbers into a few
/// sentences - it is never asked to add, subtract or compare, so it cannot produce a
/// figure that is not in `facts`. The dashboard shows `facts` next to the sentences, so
/// anything the AI says can be checked against the numbers right there.
///
/// Only aggregates leave the server (product names, SKUs and quantities): no people.

export const WHAT_CHANGED_DAYS = [1, 7, 14, 30] as const;
const CACHE_TTL_MS = 30 * 60_000;
const TOP_MOVERS = 5;

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface Delta {
  previous: number;
  current: number;
  change: number;
  /// Null when the previous figure was 0 (a percentage of nothing is not a number).
  changePct: number | null;
}
export interface Mover {
  sku: string | null;
  name: string;
  unit: string;
  previous: number;
  current: number;
  change: number;
}
export interface ChangeFacts {
  days: number;
  current: { from: string; to: string };
  previous: { from: string; to: string };
  /// The current window ends on the latest business day, which may still be mid-shift.
  currentWindowMayBePartial: boolean;
  /// False when the earlier window has no outflow at all - there is nothing to compare to.
  enoughHistory: boolean;
  totals: {
    totalOut: Delta;
    onlineOut: Delta;
    offlineOut: Delta;
    backloads: Delta;
    rts: Delta;
    productionIn: Delta;
    /// Sum of |counted - system| over the window's audits.
    absVariance: Delta;
    flaggedProducts: Delta;
  };
  /// Products whose total outflow rose the most / fell the most.
  outflowUp: Mover[];
  outflowDown: Mover[];
  /// Products whose audit discrepancy grew the most.
  varianceUp: Mover[];
}

function delta(previous: number, current: number): Delta {
  const change = round2(current - previous);
  return { previous: round2(previous), current: round2(current), change, changePct: previous === 0 ? null : round1((change / previous) * 100) };
}

/// Pure: two period reports in, the comparison out. Tested without a database or a model.
export function buildChangeFacts(current: PeriodMonitoring, previous: PeriodMonitoring, partial: boolean): ChangeFacts {
  const t = (k: keyof PeriodMonitoring["totals"]) => delta(previous.totals[k], current.totals[k]);

  const before = new Map(previous.products.map((p) => [p.productId, p]));
  const after = new Map(current.products.map((p) => [p.productId, p]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const movers = (pick: (p: PeriodMonitoring["products"][number]) => number): Mover[] =>
    [...ids].map((id) => {
      const a = after.get(id);
      const b = before.get(id);
      const info = a ?? b!;
      const prev = b ? pick(b) : 0;
      const cur = a ? pick(a) : 0;
      return { sku: info.sku, name: info.name, unit: info.unit, previous: round2(prev), current: round2(cur), change: round2(cur - prev) };
    });

  const out = movers((p) => p.totalOut).filter((m) => m.change !== 0);
  const variance = movers((p) => p.absVariance).filter((m) => m.change > 0);
  return {
    days: current.days,
    current: { from: current.from, to: current.to },
    previous: { from: previous.from, to: previous.to },
    currentWindowMayBePartial: partial,
    enoughHistory: previous.totals.totalOut > 0,
    totals: {
      totalOut: t("totalOut"),
      onlineOut: t("onlineOut"),
      offlineOut: t("offlineOut"),
      backloads: t("backloads"),
      rts: t("rts"),
      productionIn: t("productionIn"),
      absVariance: t("absVariance"),
      flaggedProducts: t("flaggedProducts"),
    },
    outflowUp: out.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, TOP_MOVERS),
    outflowDown: out.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, TOP_MOVERS),
    varianceUp: variance.sort((a, b) => b.change - a.change).slice(0, TOP_MOVERS),
  };
}

const SYSTEM_PROMPT = [
  "You write a short 'what changed' note for the supervisor of a small stock-room operation.",
  "You are given JSON comparing the current window of days with the window of the same length just before it.",
  "Write 3 to 5 plain sentences. Lead with the biggest change. Name at most 3 products. Say what is worth checking, not what to do.",
  "Rules: use ONLY numbers present in the JSON; never calculate new figures; changePct null means the earlier figure was 0, so say 'new' instead of a percentage;",
  "if currentWindowMayBePartial is true, mention that the latest day may be incomplete; variance means counted minus system stock, and 'absVariance' is the total size of discrepancies;",
  "if nothing changed much, say so plainly. No markdown, no bullet points, no greeting.",
].join(" ");

export async function whatChanged(days: number, anchor: Date = localToday(new Date()), now: Date = new Date()) {
  if (!WHAT_CHANGED_DAYS.includes(days as (typeof WHAT_CHANGED_DAYS)[number])) {
    throw HttpError.badRequest(`Choose ${WHAT_CHANGED_DAYS.join(", ")} days`);
  }
  requireAi();

  const currentFrom = addDays(anchor, -(days - 1));
  const previousTo = addDays(currentFrom, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  const [current, previous] = await Promise.all([
    getPeriodMonitoring(currentFrom, anchor),
    getPeriodMonitoring(previousFrom, previousTo),
  ]);
  const facts = buildChangeFacts(current, previous, iso(anchor) >= iso(localToday(now)));

  // Nothing to compare against: say so without spending a model call.
  if (!facts.enoughHistory) return { facts, explanation: null, unavailable: null, model: env.geminiModel };

  // Same numbers -> same words, free. New saves change the facts and so the key.
  const key = `ai-what-changed:${createHash("sha1").update(JSON.stringify(facts)).digest("hex").slice(0, 20)}`;
  // If the AI cannot answer (Google slow, busy or down) the comparison is still true and still useful:
  // it goes back without the sentences, with `unavailable` saying why, instead of failing the request.
  let explanation: string | null = null;
  let unavailable: string | null = null;
  try {
    explanation = await getOrSet(key, CACHE_TTL_MS, async () => {
    const reply = await generate({
      system: SYSTEM_PROMPT,
      contents: [{ role: "user", parts: [{ text: JSON.stringify(facts) }] }],
      event: "ai-what-changed",
    });
    const text = textOf(reply);
    if (!text) throw new HttpError(502, "The AI service returned no summary. Try again.");
    return text;
  });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    unavailable = err.message;
  }
  return { facts, explanation, unavailable, model: env.geminiModel };
}
