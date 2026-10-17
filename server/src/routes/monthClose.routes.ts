import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getMonth, getMonths, getReadiness, postCloseMonth, postUnlockMonth } from "../controllers/monthClose.controller";

const router = Router();

router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getMonths));
router.get("/:yearMonth", authenticate, asyncHandler(getMonth));
router.get("/:yearMonth/readiness", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getReadiness));
router.post("/:yearMonth/close", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postCloseMonth));
router.post("/:yearMonth/unlock", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postUnlockMonth));

export default router;
