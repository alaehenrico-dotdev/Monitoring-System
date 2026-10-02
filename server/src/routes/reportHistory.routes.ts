import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getReportHistory, postReportHistory } from "../controllers/reportHistory.controller";

const router = Router();

// Any logged-in role can record that it generated a report - Daily Report
// itself is open to every role (see dailyReport routes), not just
// Supervisor/Admin.
router.post("/", authenticate, asyncHandler(postReportHistory));
// Viewing the history list is Supervisor/Admin only - both history pages
// (and the Variance Report itself) are already gated the same way client-side
// (App.tsx); this is the server-side half of that same restriction.
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getReportHistory));

export default router;
