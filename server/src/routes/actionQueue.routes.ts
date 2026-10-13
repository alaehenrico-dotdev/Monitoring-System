import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getActionQueue } from "../services/actionQueue.service";

const router = Router();

// Everything an admin has to look at, in one response (SUPERVISOR_ADMIN only).
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(async (_req, res) => {
  res.json(await getActionQueue());
}));

export default router;
