import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { deleteProduct, getProducts, patchProduct, postProduct } from "../controllers/products.controller";

const router = Router();

// All authenticated roles can read the master list (it drives every grid).
router.get("/", authenticate, asyncHandler(getProducts));

// Only the Supervisor/Admin manages the master list (Section 3.2, 4.1).
router.post("/", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(postProduct));
router.patch("/:id", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(patchProduct));
router.delete("/:id", authenticate, authorize(ROLES.SUPERVISOR_ADMIN), asyncHandler(deleteProduct));

export default router;
