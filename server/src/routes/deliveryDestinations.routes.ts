import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import {
  deleteDeliveryDestination,
  getDeliveryDestinations,
  patchDeliveryDestination,
  postDeliveryDestination,
} from "../controllers/deliveryDestinations.controller";

const router = Router();

// All authenticated roles can read the destination list (it drives the
// Offline entry's per-destination delivery picker).
router.get("/", authenticate, asyncHandler(getDeliveryDestinations));

// Only the Supervisor/Admin manages the destination list, same as Products.
router.post("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postDeliveryDestination));
router.patch("/:id", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(patchDeliveryDestination));
router.delete("/:id", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(deleteDeliveryDestination));

export default router;
