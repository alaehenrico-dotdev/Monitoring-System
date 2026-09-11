import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getOnlineStockGrid, putOnlineStockEntry } from "../controllers/dailyOnlineStock.controller";

const router = Router();

// Section 3.2 - every role can view the Online grid (Offline Encoder is
// read-only here); only the Online Encoder / Supervisor-Admin can write.
router.get("/", authenticate, asyncHandler(getOnlineStockGrid));
router.put(
  "/:productId",
  authenticate,
  authorize(ROLES.ONLINE_ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(putOnlineStockEntry)
);

export default router;
