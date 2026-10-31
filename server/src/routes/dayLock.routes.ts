import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import {
  getClosures,
  getFinishInfo,
  getFinishThroughPreview,
  getReadiness,
  getUnlockRequest,
  getStatus,
  postClose,
  postFinish,
  postFinishThrough,
  postUnlock,
  postUnlockRequest,
} from "../controllers/dayLock.controller";

const router = Router();

router.get("/status", authenticate, asyncHandler(getStatus));
router.get("/finish-summary", authenticate, asyncHandler(getFinishInfo));
router.post(
  "/finish",
  authenticate,
  authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(postFinish),
);
router.get(
  "/finish-through/preview",
  authenticate,
  authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(getFinishThroughPreview),
);
router.post(
  "/finish-through",
  authenticate,
  authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(postFinishThrough),
);
router.get("/unlock-request", authenticate, asyncHandler(getUnlockRequest));
router.post(
  "/unlock-request",
  authenticate,
  authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(postUnlockRequest),
);
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getClosures));
router.get("/readiness", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getReadiness));
router.post("/close", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postClose));
router.post("/unlock", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postUnlock));

export default router;
