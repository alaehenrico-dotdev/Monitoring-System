import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getClosures, getReadiness, getStatus, postClose, postUnlock } from "../controllers/dayLock.controller";

const router = Router();

router.get("/status", authenticate, asyncHandler(getStatus));
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getClosures));
router.get("/readiness", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getReadiness));
router.post("/close", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postClose));
router.post("/unlock", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postUnlock));

export default router;
