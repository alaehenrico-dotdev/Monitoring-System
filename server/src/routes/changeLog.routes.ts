import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getChangeLog } from "../controllers/changeLog.controller";

const router = Router();

// Section 3.2 - only the Supervisor/Admin reviews the log.
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getChangeLog));

export default router;
