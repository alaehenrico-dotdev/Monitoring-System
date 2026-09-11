import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getOfflineStockGrid, putOfflineStockEntry } from "../controllers/dailyOfflineStock.controller";

const router = Router();

// Section 3.2 - every role can view the Offline grid (Online Encoder is
// read-only here); only the Offline Encoder / Supervisor-Admin can write.
router.get("/", authenticate, asyncHandler(getOfflineStockGrid));
router.put(
  "/:productId",
  authenticate,
  authorize(ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(putOfflineStockEntry)
);

export default router;
