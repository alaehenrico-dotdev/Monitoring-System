import type { Request, Response } from "express";
import { StockLocation } from "@prisma/client";
import { parseDateOnly } from "../utils/date";
import { getDailyReport } from "../services/reports.service";
import { getVarianceReport } from "../services/manualCounts.service";

export async function getDailyReportHandler(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  res.json(await getDailyReport(entryDate));
}

export async function getVarianceReportHandler(req: Request, res: Response) {
  const startDate = parseDateOnly(req.query.startDate);
  const endDate = parseDateOnly(req.query.endDate);
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const location = req.query.location ? (req.query.location as StockLocation) : undefined;
  const flaggedOnly = req.query.flaggedOnly !== "false";

  res.json(await getVarianceReport({ startDate, endDate, productId, category, location, flaggedOnly }));
}
