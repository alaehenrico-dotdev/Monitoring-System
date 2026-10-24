import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { authLimiter, loginIpLimiter } from "../middleware/rateLimit";
import { getMe, postLogin } from "../controllers/auth.controller";

const router = Router();

router.post("/login", loginIpLimiter, authLimiter, asyncHandler(postLogin));
router.get("/me", authenticate, asyncHandler(getMe));

export default router;
