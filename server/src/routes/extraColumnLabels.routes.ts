import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { getExtraLabels, putExtraLabel } from "../controllers/extraColumnLabels.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getExtraLabels));
// Role (per grid) is checked in the controller, since it depends on the body.
router.put("/", authenticate, asyncHandler(putExtraLabel));

export default router;
