import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getOnlineStockGrid, putOnlineStockEntry } from "../controllers/dailyOnlineStock.controller";

const router = Router();

// Section 3.2 - every role can view the Online grid; Encoders and the
// Admin can write.
router.get("/", authenticate, asyncHandler(getOnlineStockGrid));
router.put(
  "/:productId",
  authenticate,
  authorize(ROLES.ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(putOnlineStockEntry)
);

export default router;
