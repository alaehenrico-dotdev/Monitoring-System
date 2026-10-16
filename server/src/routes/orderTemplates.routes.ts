import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getOrderTemplates, postOrderTemplate, removeOrderTemplate } from "../controllers/orderTemplates.controller";

const router = Router();

// Templates arrange the shared product list, which only the Supervisor/Admin manages.
router.get("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(getOrderTemplates));
router.post("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postOrderTemplate));
router.delete("/:id", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(removeOrderTemplate));

export default router;
