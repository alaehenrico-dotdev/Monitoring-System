import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getManualCounts, getVarianceReportHandler, putManualCount } from "../controllers/manualCounts.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getManualCounts));
router.get("/variance-report", authenticate, asyncHandler(getVarianceReportHandler));

// Section 3.2 - "performs/approves the Manual Count entry" is a
// Supervisor-Admin action; encoders may also be delegated the entry per
// Section 4.4 ("the supervisor, or the encoder on duty").
router.put(
  "/:productId",
  authenticate,
  authorize(ROLES.SUPERVISOR_ADMIN, ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER),
  asyncHandler(putManualCount)
);

export default router;
