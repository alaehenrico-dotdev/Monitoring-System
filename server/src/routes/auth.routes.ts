import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { getMe, postLogin } from "../controllers/auth.controller";

const router = Router();

router.post("/login", asyncHandler(postLogin));
router.get("/me", authenticate, asyncHandler(getMe));

export default router;
