import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getCorrections, postApprove, postCorrection, postReject } from "../controllers/correction.controller";

const router = Router();

// Anyone who can see a figure can question it; only a Supervisor/Admin decides.
router.post("/", authenticate, asyncHandler(postCorrection));
router.get("/", authenticate, asyncHandler(getCorrections));
router.post("/:id/approve", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postApprove));
router.post("/:id/reject", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postReject));

export default router;
