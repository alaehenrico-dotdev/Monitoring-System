import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getManualCounts, getTrace, getVarianceReportHandler, patchCountRemarks, postPublish, putManualCount } from "../controllers/manualCounts.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getManualCounts));
router.get("/variance-report", authenticate, asyncHandler(getVarianceReportHandler));
// Who/when/what behind one count's variance (read-only, same audience as the grid).
router.get("/trace", authenticate, asyncHandler(getTrace));

// Section 3.2 - "performs/approves the Manual Count entry" is a
// Supervisor-Admin action; encoders may also be delegated the entry per
// Section 4.4 ("the supervisor, or the encoder on duty").
// Publishing is the approval step: only a Supervisor/Admin releases a sheet's
// counts to the next shift's opening stock (entering a count stays open to the
// encoders, per Section 4.4).
router.post("/publish", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postPublish));

// Remarks (why a count differs) - same roles as entering the count itself.
router.patch(
  "/:productId/remarks",
  authenticate,
  authorize(ROLES.SUPERVISOR_ADMIN, ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER),
  asyncHandler(patchCountRemarks)
);

router.put(
  "/:productId",
  authenticate,
  authorize(ROLES.SUPERVISOR_ADMIN, ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER),
  asyncHandler(putManualCount)
);

export default router;
