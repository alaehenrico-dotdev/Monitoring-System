import type { Request, Response } from "express";
import { parseDateOnly } from "../utils/date";
import { getTotalStocksGrid } from "../services/totalStocks.service";

export async function getTotalStocks(req: Request, res: Response) {
  const entryDate = parseDateOnly(req.query.date);
  res.json(await getTotalStocksGrid(entryDate));
}
