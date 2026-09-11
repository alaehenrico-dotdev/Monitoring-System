import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getReceipt, getReceipts, postReceipt } from "../controllers/receipts.controller";

const router = Router();

router.get("/", authenticate, asyncHandler(getReceipts));
router.get("/:id", authenticate, asyncHandler(getReceipt));

// Section 4.7 / 6 step 4 - Sales Rep / Online Encoder logs receipts.
router.post("/", authenticate, authorize(ROLES.ONLINE_ENCODER, ROLES.SUPERVISOR_ADMIN), asyncHandler(postReceipt));

export default router;
