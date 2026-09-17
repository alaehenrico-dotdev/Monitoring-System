import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { postReset, postVerifyPasscode } from "../controllers/dataReset.controller";

const router = Router();

// Section Admin - Data Reset. SUPERVISOR_ADMIN-only, enforced here (not just
// by the client-side route guard around DataResetPage).
router.post("/verify-passcode", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postVerifyPasscode));
router.post("/reset", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postReset));

export default router;
