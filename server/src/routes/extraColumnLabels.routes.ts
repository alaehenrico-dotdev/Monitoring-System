import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getExtraLabels, putExtraLabel } from "../controllers/extraColumnLabels.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getExtraLabels));
// Encoders and the admin may both rename columns on either grid.
router.put("/", authenticate, authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(putExtraLabel));

export default router;
