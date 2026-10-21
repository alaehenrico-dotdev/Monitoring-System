import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getEntryRulesHandler, patchEntryRulesHandler } from "../controllers/appSettings.controller";

const router = Router();

// Settings > Entry Rules. SUPERVISOR_ADMIN only, enforced here and not just by
// the client-side route guard. Entry pages learn the effect of these rules from
// the day status they already fetch, so they never call this.
router.get("/entry-rules", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getEntryRulesHandler));
router.patch("/entry-rules", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(patchEntryRulesHandler));

export default router;
