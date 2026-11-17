import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getMonthlyOverview } from "../services/dashboardAnalytics.service";
import { getDaysOfStock } from "../services/daysOfStock.service";
import { getOrSet } from "../lib/cache";
import { parseDateOnly, toDateOnlyString } from "../utils/date";
import { env } from "../config/env";
import { aiConfigured, geminiConfigured } from "../lib/gemini";
import { WHAT_CHANGED_DAYS, whatChanged } from "../services/aiWhatChanged.service";
import { askData, MAX_QUESTION_LENGTH } from "../services/aiAsk.service";

// Built fresh on every request (not a module-level constant) - this server
// process can stay up for a long time (pm2 only restarts it on a crash, not
// on a schedule), and a `const` computed once at module load would freeze at
// whatever year the process happened to start in, silently going stale the
// next time the real calendar year rolls over.
function querySchema() {
  const currentYear = new Date().getUTCFullYear();
  return z.object({
    year: z.coerce.number().int().min(2000).max(currentYear + 1).default(currentYear),
  });
}

export async function getMonthlyOverviewHandler(req: Request, res: Response) {
  const parsed = querySchema().safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid `year` query parameter", parsed.error.flatten());
  res.json(await getMonthlyOverview(parsed.data.year));
}

/**
 * Short TTL on the days-left aggregate.
 *
 * It scans a fortnight of both stock tables, so it's the most expensive
 * thing the dashboard asks for, while the figure itself is a 14-day average
 * that cannot meaningfully move within a minute. Long enough that a
 * dashboard left open (or several supervisors opening it at once) doesn't
 * re-run the aggregate repeatedly; short enough that it still reflects
 * today's encoding well within a shift.
 */
const DAYS_OF_STOCK_TTL_MS = 60_000;

const daysOfStockSchema = z.object({
  date: z.string().optional(),
});

export async function getDaysOfStockHandler(req: Request, res: Response) {
  const parsed = daysOfStockSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid days-of-stock query", parsed.error.flatten());

  const asOf = parsed.data.date ? parseDateOnly(parsed.data.date) : new Date();
  const key = `days-of-stock:${toDateOnlyString(asOf)}`;
  res.json(await getOrSet(key, DAYS_OF_STOCK_TTL_MS, () => getDaysOfStock(asOf)));
}

/// GET /dashboard/ai/status - whether the AI helpers are set up, so the dashboard can leave their
/// cards out entirely (rather than show buttons that only say "not set up").
export function getAiStatusHandler(_req: Request, res: Response) {
  res.json({ enabled: aiConfigured(), model: !aiConfigured() ? null : geminiConfigured() ? env.geminiModel : env.openrouterModel, windows: WHAT_CHANGED_DAYS });
}

const whatChangedSchema = z.object({ days: z.coerce.number().int().default(7) });

/// POST /dashboard/ai/what-changed?days=7 - this window against the one before it (numbers + AI summary).
export async function postWhatChangedHandler(req: Request, res: Response) {
  const parsed = whatChangedSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid days", parsed.error.flatten());
  res.json(await whatChanged(parsed.data.days));
}

const askSchema = z.object({ question: z.string().min(1).max(MAX_QUESTION_LENGTH) });

/// POST /dashboard/ai/ask - a question answered from the app's own reports through fixed read-only tools.
export async function postAskHandler(req: Request, res: Response) {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(`Keep the question under ${MAX_QUESTION_LENGTH} characters.`, parsed.error.flatten());
  res.json(await askData(parsed.data.question));
}
