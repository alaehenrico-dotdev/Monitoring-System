import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getAuditSnapshotHandler, getAuditSnapshotStatesHandler, postRevertSnapshot, getManualCounts, getTrace, getVarianceReportHandler, patchCountRemarks, postPublish, putManualCount } from "../controllers/manualCounts.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getManualCounts));
router.get("/variance-report", authenticate, asyncHandler(getVarianceReportHandler));
// Who/when/what behind one count's variance (read-only, same audience as the grid).
router.get("/trace", authenticate, asyncHandler(getTrace));
// A published audit as it was released - what Audit History reopens (same audience as the grid).
// (before /:id so "states" is not read as an id)
router.get("/snapshots/states", authenticate, asyncHandler(getAuditSnapshotStatesHandler));
router.get("/snapshots/:id", authenticate, asyncHandler(getAuditSnapshotHandler));
// Reverting a published audit so it can be re-audited: the approval step's undo, so the same role as Publish.
router.post("/snapshots/:id/revert", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postRevertSnapshot));

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
  authorize(ROLES.SUPERVISOR_ADMIN, ROLES.ENCODER),
  asyncHandler(patchCountRemarks)
);

router.put(
  "/:productId",
  authenticate,
  authorize(ROLES.SUPERVISOR_ADMIN, ROLES.ENCODER),
  asyncHandler(putManualCount)
);

export default router;
