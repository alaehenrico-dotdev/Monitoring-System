import { Router } from "express";

import authRoutes from "./auth.routes";
import usersRoutes from "./users.routes";
import productsRoutes from "./products.routes";
import dailyOnlineStockRoutes from "./dailyOnlineStock.routes";
import dailyOfflineStockRoutes from "./dailyOfflineStock.routes";
import manualCountsRoutes from "./manualCounts.routes";
import totalStocksRoutes from "./totalStocks.routes";
import reportsRoutes from "./reports.routes";
import changeLogRoutes from "./changeLog.routes";
import dataResetRoutes from "./dataReset.routes";
import backupRoutes from "./backup.routes";
import dashboardRoutes from "./dashboard.routes";
import syncRoutes from "./sync.routes";
import importBatchRoutes from "./importBatch.routes";
import reportHistoryRoutes from "./reportHistory.routes";
import systemLogRoutes from "./systemLog.routes";

/// Single mount point for every feature's router (Section 3 - the app is
/// organized around Daily Online Entry, Daily Offline Entry, Manual Count &
/// Variance, and Total Stocks, plus supporting Products/Users/Reports/
/// Change-Log endpoints).
const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/products", productsRoutes);
router.use("/online-stock", dailyOnlineStockRoutes);
router.use("/offline-stock", dailyOfflineStockRoutes);
router.use("/manual-counts", manualCountsRoutes);
router.use("/total-stocks", totalStocksRoutes);
router.use("/reports", reportsRoutes);
router.use("/change-log", changeLogRoutes);
router.use("/data-reset", dataResetRoutes);
router.use("/backup", backupRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/sync", syncRoutes);
router.use("/import-batches", importBatchRoutes);
router.use("/report-history", reportHistoryRoutes);
router.use("/system-log", systemLogRoutes);

export default router;
