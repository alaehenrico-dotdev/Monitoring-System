import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import {
  getAiStatusHandler,
  getDaysOfStockHandler,
  getMonthlyOverviewHandler,
  postAskHandler,
  postWhatChangedHandler,
} from "../controllers/dashboardAnalytics.controller";
import { aiAskLimiter, aiChangesLimiter } from "../middleware/rateLimit";

const router = Router();

// Dashboard > Monthly Monitoring. Same access as the Dashboard page itself
// (SUPERVISOR_ADMIN-only, see App.tsx's ProtectedRoute around /dashboard).
router.get("/monthly-overview", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getMonthlyOverviewHandler));

// Dashboard > "Needs restock" / "Lowest days left". Same access as the
// Dashboard page itself.
router.get("/days-of-stock", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getDaysOfStockHandler));

// Dashboard AI helpers (Gemini). Supervisor/Admin only; the two that spend money are rate-limited per user.
// POST because each call is a paid request - nothing should prefetch or cache them.
router.get("/ai/status", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), getAiStatusHandler);
router.post("/ai/what-changed", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), aiChangesLimiter, asyncHandler(postWhatChangedHandler));
router.post("/ai/ask", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), aiAskLimiter, asyncHandler(postAskHandler));

export default router;
