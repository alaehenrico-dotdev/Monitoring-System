import type { Request, Response } from "express";
import { parseDateOnly } from "../utils/date";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { getTotalStocksGrid } from "../services/totalStocks.service";
import { getDailyOutflow, MAX_OUTFLOW_DAYS } from "../services/dailyOutflow.service";
import { getStockFlow, MAX_FLOW_DAYS } from "../services/stockFlow.service";
import { getPeriodMonitoring, MAX_PERIOD_DAYS } from "../services/periodMonitoring.service";

export async function getTotalStocks(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  res.json(await getTotalStocksGrid(entryDate));
}

const dailyOutSchema = z.object({ from: z.string(), to: z.string() });

export async function getDailyOutflowHandler(req: Request, res: Response) {
  const parsed = dailyOutSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Expected `from` and `to` dates", parsed.error.flatten());
  const from = parseDateOnly(parsed.data.from);
  const to = parseDateOnly(parsed.data.to);
  if (to < from) throw HttpError.badRequest("`to` is before `from`");
  if ((to.getTime() - from.getTime()) / 86_400_000 >= MAX_OUTFLOW_DAYS) {
    throw HttpError.badRequest(`The range can span at most ${MAX_OUTFLOW_DAYS} days`);
  }
  res.json(await getDailyOutflow(from, to));
}

export async function getStockFlowHandler(req: Request, res: Response) {
  const parsed = dailyOutSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Expected `from` and `to` dates", parsed.error.flatten());
  const from = parseDateOnly(parsed.data.from);
  const to = parseDateOnly(parsed.data.to);
  if (to < from) throw HttpError.badRequest("`to` is before `from`");
  if ((to.getTime() - from.getTime()) / 86_400_000 >= MAX_FLOW_DAYS) {
    throw HttpError.badRequest(`The range can span at most ${MAX_FLOW_DAYS} days`);
  }
  res.json(await getStockFlow(from, to));
}

export async function getPeriodMonitoringHandler(req: Request, res: Response) {
  const parsed = dailyOutSchema.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest("Expected `from` and `to` dates", parsed.error.flatten());
  const from = parseDateOnly(parsed.data.from);
  const to = parseDateOnly(parsed.data.to);
  if (to < from) throw HttpError.badRequest("`to` is before `from`");
  if ((to.getTime() - from.getTime()) / 86_400_000 >= MAX_PERIOD_DAYS) {
    throw HttpError.badRequest(`The range can span at most ${MAX_PERIOD_DAYS} days`);
  }
  res.json(await getPeriodMonitoring(from, to));
}
