import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getLastCustomers, getReceipt, getReceipts, postReceipt, postReceiptsBatch } from "../controllers/receipts.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getReceipts));
// Must come before "/:id" - otherwise Express's :id param would swallow
// this literal path (matching id="last-customers") instead of ever
// reaching this route.
router.get("/last-customers", authenticate, asyncHandler(getLastCustomers));
router.get("/:id", authenticate, asyncHandler(getReceipt));

// Section 4.7 / 6 step 4 - Sales Rep / Online Encoder logs receipts.
router.post(
  "/",
  authenticate,
  authorize(ROLES.ONLINE_ENCODER, ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(postReceipt),
);

// Section 4.7's Consolidated Receipt bulk entry - Offline-only (see
// createReceiptsBatch), so Online Encoders have no reason to reach it.
router.post(
  "/batch",
  authenticate,
  authorize(ROLES.OFFLINE_ENCODER, ROLES.SUPERVISOR_ADMIN),
  asyncHandler(postReceiptsBatch),
);

export default router;
