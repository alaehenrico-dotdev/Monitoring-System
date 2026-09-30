import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getMonthlyOverview } from "../services/dashboardAnalytics.service";

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
