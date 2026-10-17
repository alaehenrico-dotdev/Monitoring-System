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
import importBatchRoutes from "./importBatch.routes";
import reportHistoryRoutes from "./reportHistory.routes";
import dayLockRoutes from "./dayLock.routes";
import extraColumnLabelsRoutes from "./extraColumnLabels.routes";
import clientErrorRoutes from "./clientError.routes";
import correctionRoutes from "./correction.routes";
import actionQueueRoutes from "./actionQueue.routes";
import orderTemplatesRoutes from "./orderTemplates.routes";
import pendingReleaseRoutes from "./pendingRelease.routes";
import monthCloseRoutes from "./monthClose.routes";
import { idempotency } from "../middleware/idempotency";

/// Single mount point for every feature's router (Section 3 - the app is
/// organized around Daily Online Entry, Daily Offline Entry, Manual Count &
/// Variance, and Total Stocks, plus supporting Products/Users/Reports/
/// Change-Log endpoints).
const router = Router();

// Saves are retry-safe: a request carrying an Idempotency-Key is run once and
// replayed after that (middleware/idempotency.ts). Not applied to auth, the
// raw-stream restore, or read-only routers.
const retrySafe = [idempotency];

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/products", retrySafe, productsRoutes);
router.use("/online-stock", retrySafe, dailyOnlineStockRoutes);
router.use("/offline-stock", retrySafe, dailyOfflineStockRoutes);
router.use("/manual-counts", retrySafe, manualCountsRoutes);
router.use("/total-stocks", totalStocksRoutes);
router.use("/reports", reportsRoutes);
router.use("/change-log", changeLogRoutes);
router.use("/data-reset", dataResetRoutes);
router.use("/backup", backupRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/import-batches", retrySafe, importBatchRoutes);
router.use("/report-history", retrySafe, reportHistoryRoutes);
router.use("/day-closures", retrySafe, dayLockRoutes);
router.use("/month-closures", retrySafe, monthCloseRoutes);
router.use("/pending-releases", retrySafe, pendingReleaseRoutes);
router.use("/extra-labels", retrySafe, extraColumnLabelsRoutes);
router.use("/corrections", retrySafe, correctionRoutes);
router.use("/action-queue", actionQueueRoutes);
router.use("/order-templates", retrySafe, orderTemplatesRoutes);
router.use("/client-errors", clientErrorRoutes);

export default router;
