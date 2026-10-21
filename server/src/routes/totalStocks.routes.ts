import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { getTotalStocks, getDailyOutflowHandler } from "../controllers/totalStocks.controller";

const router = Router();

// Read-only for every role (Section 4.5).
router.get("/", authenticate, asyncHandler(getTotalStocks));

// Daily Out tab: stock leaving the company per day. Same access as the grid
// beside it - it is a read-only view over the same entries.
router.get("/daily-out", authenticate, asyncHandler(getDailyOutflowHandler));

export default router;
