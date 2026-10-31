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

// Anyone signed in can see what is waiting. Encoders and the admin record and edit
// it; releasing it into the entry grids and writing it off are the admin's call.
router.get("/", authenticate, asyncHandler(getPendingReleases));
router.get("/summary", authenticate, asyncHandler(getPendingSummary));
router.post("/", authenticate, authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(postPendingRelease));
router.patch("/:id", authenticate, authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(patchPendingRelease));
router.post("/:id/release", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postRelease));
router.post("/:id/cancel", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postCancel));

export default router;
