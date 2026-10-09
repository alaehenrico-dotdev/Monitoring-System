import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import {
  getReportHistory,
  postReportHistory,
} from "../controllers/reportHistory.controller";

const router = Router();

// Any logged-in role can record that it generated a report - Daily Report
// itself is open to every role (see dailyReport routes), not just
// Supervisor/Admin.
router.post("/", authenticate, asyncHandler(postReportHistory));
// Viewing the history list is Supervisor/Admin only (the Daily/Variance
// history pages are gated the same way client-side in App.tsx), except for
// the "Audit Report" type, which every role may read - that check lives in
// getReportHistory.
router.get("/", authenticate, asyncHandler(getReportHistory));

export default router;
