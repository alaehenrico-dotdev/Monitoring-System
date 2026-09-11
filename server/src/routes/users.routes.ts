import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize, ROLES } from "../middleware/auth";
import { getUsers, patchUserActive, postUser } from "../controllers/users.controller";

const router = Router();

// Section 3.2 - only the Supervisor/Admin manages accounts.
router.use(authenticate, authorize(ROLES.SUPERVISOR_ADMIN));
router.get("/", asyncHandler(getUsers));
router.post("/", asyncHandler(postUser));
router.patch("/:id/active", asyncHandler(patchUserActive));

export default router;
