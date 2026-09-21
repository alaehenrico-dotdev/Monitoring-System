import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { passcodeLimiter } from "../middleware/rateLimit";
import { postReset, postVerifyPasscode } from "../controllers/dataReset.controller";

const router = Router();

// Section Admin - Data Reset. SUPERVISOR_ADMIN-only, enforced here (not just
// by the client-side route guard around DataResetPage). The passcode is a
// short human-typed code, not a real password - passcodeLimiter guards it
// from being brute-forced the way authLimiter guards login.
router.post("/verify-passcode", passcodeLimiter, authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postVerifyPasscode));
router.post("/reset", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postReset));

export default router;
