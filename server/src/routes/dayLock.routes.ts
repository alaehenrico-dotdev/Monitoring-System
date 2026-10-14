import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getClosures, getFinishInfo, getReadiness, getStatus, postClose, postFinish, postUnlock } from "../controllers/dayLock.controller";

const router = Router();

router.get("/status", authenticate, asyncHandler(getStatus));
router.get("/finish-summary", authenticate, asyncHandler(getFinishInfo));
router.post(
  "/finish",
  authenticate,
  authorize(ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(postFinish),
);
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getClosures));
router.get("/readiness", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getReadiness));
router.post("/close", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postClose));
router.post("/unlock", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postUnlock));

export default router;
