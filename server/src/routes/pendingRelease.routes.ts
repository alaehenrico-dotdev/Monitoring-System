import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import {
  getPendingReleases,
  getPendingSummary,
  patchPendingRelease,
  postCancel,
  postPendingRelease,
  postRelease,
} from "../controllers/pendingRelease.controller";

const router = Router();

// Anyone signed in can see what is waiting; the encoders (own page) and the
// admin record, edit and release it. Writing an item off is the admin's call.
router.get("/", authenticate, asyncHandler(getPendingReleases));
router.get("/summary", authenticate, asyncHandler(getPendingSummary));
router.post("/", authenticate, authorize(ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(postPendingRelease));
router.patch("/:id", authenticate, authorize(ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(patchPendingRelease));
router.post("/:id/release", authenticate, authorize(ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(postRelease));
router.post("/:id/cancel", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postCancel));

export default router;
