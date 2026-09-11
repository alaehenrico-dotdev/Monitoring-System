import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { getTotalStocks } from "../controllers/totalStocks.controller";

const router = Router();

// Read-only for every role (Section 4.5).
router.get("/", authenticate, asyncHandler(getTotalStocks));

export default router;
