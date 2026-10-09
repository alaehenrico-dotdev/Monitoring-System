import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getDaysOfStockHandler, getMonthlyOverviewHandler } from "../controllers/dashboardAnalytics.controller";

const router = Router();

// Dashboard > Monthly Monitoring. Same access as the Dashboard page itself
// (SUPERVISOR_ADMIN-only, see App.tsx's ProtectedRoute around /dashboard).
router.get("/monthly-overview", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getMonthlyOverviewHandler));

// Dashboard > "Needs restock" / "Lowest days left". Same access as the
// Dashboard page itself.
router.get("/days-of-stock", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getDaysOfStockHandler));

export default router;
