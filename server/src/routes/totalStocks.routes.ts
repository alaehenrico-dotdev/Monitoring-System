import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getTotalStocks, getDailyOutflowHandler, getPeriodMonitoringHandler, getStockFlowHandler } from "../controllers/totalStocks.controller";

const router = Router();

// Read-only for every role (Section 4.5).
router.get("/", authenticate, asyncHandler(getTotalStocks));

// Daily Out tab: stock leaving the company per day. Same access as the grid
// beside it - it is a read-only view over the same entries.
router.get("/daily-out", authenticate, asyncHandler(getDailyOutflowHandler));

// Dashboard stock-flow chart: production, Online fulfilled, Offline delivered
// per day. Read-only over the same entries, same access as Daily Out.
router.get("/stock-flow", authenticate, asyncHandler(getStockFlowHandler));

// Weekly / Monthly Monitoring: totals over a window, including audit variance.
// Management figures, so Supervisor/Admin only (unlike the daily views above).
router.get("/period-monitoring", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getPeriodMonitoringHandler));

export default router;
