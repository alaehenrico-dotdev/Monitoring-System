import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getMonthlyOverview } from "../services/dashboardAnalytics.service";

const CURRENT_YEAR = new Date().getUTCFullYear();

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(CURRENT_YEAR + 1).default(CURRENT_YEAR),
});

export async function getMonthlyOverviewHandler(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Invalid `year` query parameter", parsed.error.flatten());
  res.json(await getMonthlyOverview(parsed.data.year));
}
