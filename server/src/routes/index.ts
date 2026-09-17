import { Router } from "express";

import authRoutes from "./auth.routes";
import usersRoutes from "./users.routes";
import productsRoutes from "./products.routes";
import dailyOnlineStockRoutes from "./dailyOnlineStock.routes";
import dailyOfflineStockRoutes from "./dailyOfflineStock.routes";
import manualCountsRoutes from "./manualCounts.routes";
import totalStocksRoutes from "./totalStocks.routes";
import receiptsRoutes from "./receipts.routes";
import reportsRoutes from "./reports.routes";
import changeLogRoutes from "./changeLog.routes";
import dataResetRoutes from "./dataReset.routes";

/// Single mount point for every feature's router (Section 3 - the app is
/// organized around Daily Online Entry, Daily Offline Entry, Manual Count &
/// Variance, Total Stocks, and the Receipt/Order page, plus supporting
/// Products/Users/Reports/Change-Log endpoints).
const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/products", productsRoutes);
router.use("/online-stock", dailyOnlineStockRoutes);
router.use("/offline-stock", dailyOfflineStockRoutes);
router.use("/manual-counts", manualCountsRoutes);
router.use("/total-stocks", totalStocksRoutes);
router.use("/receipts", receiptsRoutes);
router.use("/reports", reportsRoutes);
router.use("/change-log", changeLogRoutes);
router.use("/data-reset", dataResetRoutes);

export default router;
