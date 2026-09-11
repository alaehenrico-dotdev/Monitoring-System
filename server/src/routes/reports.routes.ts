import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { getDailyReportHandler, getVarianceReportHandler } from "../controllers/reports.controller";

const router = Router();

// Section 4.8 - Daily Report and Variance Report, read-only for every role.
router.get("/daily", authenticate, asyncHandler(getDailyReportHandler));
router.get("/variance", authenticate, asyncHandler(getVarianceReportHandler));

export default router;
