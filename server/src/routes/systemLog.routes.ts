import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getSystemLog, postSystemLog } from "../controllers/systemLog.controller";

const router = Router();

// Any logged-in role's desktop app can report its own auto-update - it's not
// an admin action, just a fact about whichever installed copy just updated.
router.post("/", authenticate, asyncHandler(postSystemLog));
// Viewing the log is Supervisor/Admin only, same as Change Log.
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getSystemLog));

export default router;
